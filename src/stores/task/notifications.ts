/**
 * @fileoverview Task lifecycle notification scanner.
 *
 * Encapsulates the duplicate-detection logic for task error/completion
 * events. Extracted from TaskStore.fetchList to reduce store file size
 * and isolate this pure-logic concern for independent unit testing.
 *
 * Usage:
 *   const notifier = createTaskNotifier()
 *   // Inside fetchList polling loop:
 *   notifier.scanTasks(tasksToScan, { onTaskError, onTaskComplete, onSharingComplete })
 */
import { TASK_STATUS } from '@shared/constants'
import { getTaskSharingKind, type TaskSharingKind } from '@shared/utils'
import { logger } from '@shared/logger'
import type { Aria2Task } from '@shared/types'

interface ScanCallbacks {
  onTaskError?: ((task: Aria2Task) => void) | null
  onTaskComplete?: ((task: Aria2Task) => void) | null
  /** Fires when a P2P task first enters shared-upload state. */
  onSharingComplete?: ((task: Aria2Task, kind: TaskSharingKind) => void) | null
}

export interface TaskNotifier {
  /** Scan a batch of tasks for new errors/completions and fire callbacks. */
  scanTasks: (tasks: Aria2Task[], callbacks: ScanCallbacks) => void
  /** Clear all seen GIDs and reset the initial scan flag. */
  reset: () => void
}

/**
 * Creates an isolated notification scanner with its own deduplication state.
 *
 * The scanner suppresses callbacks during the first (initial) scan to avoid
 * ghost notifications for tasks that were already in a terminal state before
 * the app started monitoring.
 */
export function createTaskNotifier(): TaskNotifier {
  const notifiedErrorGids = new Set<string>()
  const notifiedCompleteGids = new Set<string>()
  const notifiedSharingKeys = new Set<string>()
  const restoredSharingKeys = new Set<string>()
  let scanCount = 0

  function initialScanDone(): boolean {
    return scanCount > 0
  }

  function sharingCompletionKey(task: Aria2Task, kind: TaskSharingKind): string {
    if (kind === 'bt') return `bt:${task.infoHash || task.gid}`
    return `ed2k:${task.ed2k?.hash || task.gid}`
  }

  function sharingRestoreKeys(task: Aria2Task, kind: TaskSharingKind): string[] {
    if (kind === 'bt') return task.infoHash ? [`bt:${task.gid}`, `bt:${task.infoHash}`] : [`bt:${task.gid}`]
    return task.ed2k?.hash ? [`ed2k:${task.gid}`, `ed2k:${task.ed2k.hash}`] : [`ed2k:${task.gid}`]
  }

  function initialSharingKind(task: Aria2Task): TaskSharingKind | null {
    if (task.bittorrent) return 'bt'
    if (task.ed2k) return 'ed2k'
    return null
  }

  function isRestoredSharing(task: Aria2Task, kind: TaskSharingKind): boolean {
    return sharingRestoreKeys(task, kind).some((key) => restoredSharingKeys.has(key))
  }

  function scanTasks(tasks: Aria2Task[], callbacks: ScanCallbacks): void {
    const { onTaskError, onTaskComplete, onSharingComplete } = callbacks

    // Detect newly errored tasks
    if (onTaskError) {
      for (const task of tasks) {
        if (
          task.status === TASK_STATUS.ERROR &&
          task.errorCode &&
          task.errorCode !== '0' &&
          !notifiedErrorGids.has(task.gid)
        ) {
          notifiedErrorGids.add(task.gid)
          if (initialScanDone()) {
            onTaskError(task)
          }
        }
      }
    }

    // Detect newly completed tasks (HTTP/FTP downloads)
    if (onTaskComplete) {
      for (const task of tasks) {
        if (task.status === 'complete' && !notifiedCompleteGids.has(task.gid)) {
          notifiedCompleteGids.add(task.gid)
          if (initialScanDone()) {
            onTaskComplete(task)
          }
        }
      }
    }

    // Detect P2P tasks entering shared-upload state.
    if (onSharingComplete) {
      for (const task of tasks) {
        const initialKind = initialSharingKind(task)
        if (!initialScanDone() && initialKind) {
          for (const key of sharingRestoreKeys(task, initialKind)) {
            restoredSharingKeys.add(key)
          }
        }

        const kind = getTaskSharingKind(task)
        if (kind) {
          const key = sharingCompletionKey(task, kind)
          if (!notifiedSharingKeys.has(key)) {
            notifiedSharingKeys.add(key)
            if (initialScanDone() && !isRestoredSharing(task, kind)) {
              onSharingComplete(task, kind)
            }
          }
        }
      }
    }

    // Mark initial scan as done AFTER all callbacks — unconditionally.
    if (!initialScanDone()) {
      logger.debug('TaskNotifier.initialScan', `suppressed notifications for ${tasks.length} pre-existing task(s)`)
    }
    scanCount = Math.min(scanCount + 1, Number.MAX_SAFE_INTEGER)
  }

  function reset(): void {
    notifiedErrorGids.clear()
    notifiedCompleteGids.clear()
    notifiedSharingKeys.clear()
    restoredSharingKeys.clear()
    scanCount = 0
  }

  return { scanTasks, reset }
}
