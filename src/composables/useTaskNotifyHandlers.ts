/**
 * @fileoverview Extracted notification handlers for task lifecycle events.
 *
 * These handlers are registered by MainLayout as callbacks on the lifecycle
 * service. Extracted here as pure functions for independent unit testing —
 * following the same pattern as useTaskLifecycle.ts.
 *
 * **Notification architecture:**
 * - In-app toast (Naive UI message) — always fires for immediate feedback.
 * - OS-level completion/error notification is sent by Rust's task monitor so
 *   lightweight mode works after the WebView is destroyed.
 *
 * When `onOpenFile` / `onShowInFolder` callbacks are provided in deps,
 * the in-app toast renders inline action buttons so the user can open
 * the downloaded file or reveal it in the system file manager directly
 * from the notification — without navigating through the task list.
 */
import type { VNodeChild } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Aria2Task } from '@shared/types'
import { getTaskDisplayName, isM3u8SegmentTask } from '@shared/utils'
import type { TaskSharingKind } from '@shared/utils/task'
import { logger } from '@shared/logger'
import { isMetadataTask } from '@/composables/useTaskLifecycle'
import { renderCompletionToast } from '@/composables/useNotificationToast'

/** Dependency interface for testability. */
export interface NotifyDeps {
  messageSuccess: (content: string | (() => VNodeChild)) => void
  messageError: (content: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
  /** Optional: open the downloaded file with the default application. */
  onOpenFile?: (task: Aria2Task) => void
  /** Optional: reveal the downloaded file in the system file manager. */
  onShowInFolder?: (task: Aria2Task) => void
}

/**
 * Handle a completed HTTP/FTP download.
 * Always sends in-app toast. Native OS notification is sent by Rust monitor.
 *
 * When action callbacks are provided, the toast includes inline buttons
 * for "Open File" and "Show in Folder".
 */
export function handleTaskComplete(task: Aria2Task, deps: NotifyDeps): void {
  if (isMetadataTask(task)) return
  if (isM3u8SegmentTask(task)) {
    logger.debug('TaskNotify.complete', `gid=${task.gid} suppressed (m3u8 segment)`)
    return
  }

  const taskName = getTaskDisplayName(task)
  const body = deps.t('task.download-complete-message', { taskName })

  const toastContent = renderCompletionToast({
    body,
    t: deps.t,
    onOpenFile: deps.onOpenFile ? () => deps.onOpenFile!(task) : undefined,
    onShowInFolder: deps.onShowInFolder ? () => deps.onShowInFolder!(task) : undefined,
  })
  deps.messageSuccess(toastContent)
  logger.info('TaskNotify.complete', `gid=${task.gid} name="${taskName}"`)
}

/**
 * Handle a P2P download entering shared-upload state.
 * Always sends in-app toast. Native OS notification is sent by Rust monitor.
 *
 * When action callbacks are provided, the toast includes inline buttons
 * for "Open File" and "Show in Folder".
 */
export function handleSharingComplete(task: Aria2Task, kind: TaskSharingKind, deps: NotifyDeps): void {
  if (isM3u8SegmentTask(task)) {
    logger.debug('TaskNotify.sharingComplete', `gid=${task.gid} suppressed (m3u8 segment)`)
    return
  }
  const taskName = getTaskDisplayName(task)
  const bodyKey = kind === 'bt' ? 'task.bt-download-complete-message' : 'task.ed2k-download-complete-message'
  const body = deps.t(bodyKey, { taskName })

  const toastContent = renderCompletionToast({
    body,
    t: deps.t,
    onOpenFile: deps.onOpenFile ? () => deps.onOpenFile!(task) : undefined,
    onShowInFolder: deps.onShowInFolder ? () => deps.onShowInFolder!(task) : undefined,
  })
  deps.messageSuccess(toastContent)
  logger.info('TaskNotify.sharingComplete', `gid=${task.gid} kind=${kind} name="${taskName}"`)
}

/**
 * Handle a download error.
 * Always sends in-app toast. Native OS notification is sent by Rust monitor.
 */
export function handleTaskError(task: Aria2Task, reason: string, deps: NotifyDeps): void {
  if (isM3u8SegmentTask(task)) {
    logger.debug('TaskNotify.error', `gid=${task.gid} suppressed (m3u8 segment)`)
    return
  }
  const taskName = getTaskDisplayName(task, { defaultName: 'Unknown' })
  const body = deps.t('task.download-fail-message', { taskName, reason })
  deps.messageError(body)
  logger.warn('TaskNotify.error', `gid=${task.gid} error="${body}"`)
}

// ── m3u8 group-level notifications ─────────────────────────────────

/**
 * Dependencies for m3u8 group-level notifications (merge complete + failure).
 *
 * Unlike per-segment events (suppressed by {@link isM3u8SegmentTask} in the
 * lifecycle handlers above), these fire once per playlist. The in-app toast is
 * shown immediately and the native OS notification is sent through the
 * `send_app_system_notification` command (localized by the frontend).
 */
export interface M3u8NotifyDeps {
  messageSuccess: (content: string) => void
  messageError: (content: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}

/**
 * Notify that an m3u8 playlist has been fully downloaded and merged into a
 * single output file. Shows a success toast and a native OS notification that
 * includes the final output path.
 */
export function handleM3u8MergeComplete(taskName: string, outputPath: string, deps: M3u8NotifyDeps): void {
  const body = deps.t('task.m3u8-merge-complete-message', { taskName, path: outputPath })
  deps.messageSuccess(body)
  Promise.resolve(
    invoke('send_app_system_notification', {
      title: deps.t('task.m3u8-merge-complete-title'),
      body,
    }),
  ).catch((error) => logger.debug('TaskNotify.m3u8Merge', `native notification failed: ${error}`))
  logger.info('TaskNotify.m3u8Merge', `path="${outputPath}"`)
}

/**
 * Notify that an m3u8 download failed permanently (segments exhausted their
 * retries, or the ffmpeg merge failed). Shows an error toast and a native OS
 * notification.
 */
export function handleM3u8Failure(taskName: string, reason: string, deps: M3u8NotifyDeps): void {
  const body = deps.t('task.m3u8-failed-message', { taskName, reason })
  deps.messageError(body)
  Promise.resolve(
    invoke('send_app_system_notification', {
      title: deps.t('task.m3u8-failed-title'),
      body,
    }),
  ).catch((error) => logger.debug('TaskNotify.m3u8Error', `native notification failed: ${error}`))
  logger.warn('TaskNotify.m3u8Error', `taskName="${taskName}" reason="${reason}"`)
}

// ── Download-start notification ─────────────────────────────────────

/** Dependency interface for start notification — minimal subset. */
export interface StartNotifyDeps {
  messageInfo: (content: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}

/**
 * Handle download submission success — send start notification.
 *
 * For single tasks:  "Downloading: movie.mp4"
 * For batch tasks:   "Downloading: movie.mp4 and 2 other task(s)"
 *
 * Toast always fires; OS notification is delegated to Rust so lightweight mode
 * uses the same backend-owned native path as completion/error notifications.
 */
export function handleTaskStart(taskNames: string[], deps: StartNotifyDeps): void {
  if (taskNames.length === 0) return

  const firstName = taskNames[0]
  const body =
    taskNames.length === 1
      ? deps.t('task.download-start-message', { taskName: firstName })
      : deps.t('task.download-batch-start-message', {
          taskName: firstName,
          count: taskNames.length - 1,
        })

  deps.messageInfo(body)
  Promise.resolve(invoke('send_task_start_notification', { taskNames })).catch((error) =>
    logger.debug('TaskNotify.start', `native notification failed: ${error}`),
  )
  logger.info('TaskNotify.start', `count=${taskNames.length} first="${firstName}"`)
}
