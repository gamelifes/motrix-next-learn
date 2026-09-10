/** @fileoverview Synthetic "main task" rows that aggregate m3u8 segment groups in the task list. */
import { M3U8_MAIN_GID_PREFIX, TASK_STATUS } from '@shared/constants'
import type { Aria2Task, M3u8Group, TaskStatus } from '@shared/types'

/**
 * GID of the synthetic main-task row for a group.
 * `m3u8:{groupId}` can never collide with real aria2 gids (hexadecimal).
 */
export function m3u8MainGidFor(groupId: string): string {
  return `${M3U8_MAIN_GID_PREFIX}${groupId}`
}

/** Returns true when the gid identifies a synthetic m3u8 main-task row. */
export function isM3u8MainGid(gid?: string): boolean {
  return !!gid && gid.startsWith(M3U8_MAIN_GID_PREFIX)
}

/** Extracts the m3u8 group id from a synthetic main-task gid. */
export function getGroupIdFromM3u8MainGid(gid: string): string {
  return gid.slice(M3U8_MAIN_GID_PREFIX.length)
}

/** Returns the underlying group id when `task` is a synthetic m3u8 main row, else null. */
export function getM3u8GroupIdFromTask(task: { gid: string }): string | null {
  return isM3u8MainGid(task.gid) ? getGroupIdFromM3u8MainGid(task.gid) : null
}

/** Returns true when `task` is a synthetic m3u8 main-task row (not an aria2 task). */
export function isM3u8MainTask(task: { gid: string }): boolean {
  return isM3u8MainGid(task.gid)
}

/** Collects every registered segment aria2 gid across the given groups. */
export function segmentGidSetFor(groups: readonly M3u8Group[]): Set<string> {
  const set = new Set<string>()
  for (const group of groups) {
    for (const gid of group.segmentGids) {
      if (gid) set.add(gid)
    }
  }
  return set
}

type TaskTab = 'active' | 'stopped' | 'all'

const ACTIVE_GROUP_STATUSES = new Set<M3u8Group['status']>(['downloading', 'merging', 'partial'])
const STOPPED_GROUP_STATUSES = new Set<M3u8Group['status']>(['completed', 'failed'])

/** Maps an m3u8 group status onto an aria2 task status for card rendering. */
function mapGroupStatusToTaskStatus(status: M3u8Group['status']): TaskStatus {
  switch (status) {
    case 'completed':
      return TASK_STATUS.COMPLETE as TaskStatus
    case 'failed':
      return TASK_STATUS.ERROR as TaskStatus
    case 'merging':
      return TASK_STATUS.WAITING as TaskStatus
    default:
      return TASK_STATUS.ACTIVE as TaskStatus
  }
}

/**
 * Builds the synthetic Aria2Task that represents an m3u8 group as a single
 * list row. Lengths are aggregated from per-segment progress; live speeds are
 * summed from the real aria2 tasks referenced by `liveTasks` (when provided).
 * The row's `files[0].path` is the group final output path so the card shows
 * `videoName.mp4` and open-file/folder resolve to the merged file.
 */
export function buildM3u8MainTask(group: M3u8Group, liveTasks?: ReadonlyMap<string, Aria2Task>): Aria2Task {
  let totalLength = 0
  let completedLength = 0
  for (const segment of group.segments) {
    totalLength += segment.totalBytes
    completedLength += segment.bytesDownloaded
  }
  if (group.status === 'completed') completedLength = totalLength

  let downloadSpeed = 0
  let uploadSpeed = 0
  if (liveTasks) {
    for (const gid of group.segmentGids) {
      const live = gid ? liveTasks.get(gid) : undefined
      if (!live) continue
      const running = live.status === TASK_STATUS.ACTIVE || live.status === TASK_STATUS.WAITING
      if (running) {
        downloadSpeed += Number(live.downloadSpeed) || 0
        uploadSpeed += Number(live.uploadSpeed) || 0
      }
    }
  }

  const segmentCount = group.segmentGids.filter(Boolean).length
  return {
    gid: m3u8MainGidFor(group.groupId),
    status: mapGroupStatusToTaskStatus(group.status),
    totalLength: String(totalLength),
    completedLength: String(completedLength),
    uploadLength: '0',
    downloadSpeed: String(downloadSpeed),
    uploadSpeed: String(uploadSpeed),
    connections: String(segmentCount),
    dir: group.tempDir,
    files: [
      {
        index: '1',
        path: group.finalPath,
        length: String(totalLength),
        completedLength: String(completedLength),
        selected: 'true',
        uris: [],
      },
    ],
    errorCode: undefined,
    errorMessage: undefined,
  }
}

/**
 * Builds one main-task row per group matching the requested tab:
 * - active  → downloading / merging / partial
 * - stopped → completed / failed
 * - all     → every group
 */
export function collectM3u8MainTasks(
  groups: readonly M3u8Group[],
  tab: TaskTab,
  liveTasks?: ReadonlyMap<string, Aria2Task>,
): Aria2Task[] {
  const wanted = tab === 'active' ? ACTIVE_GROUP_STATUSES : tab === 'stopped' ? STOPPED_GROUP_STATUSES : null
  const rows: Aria2Task[] = []
  for (const group of groups) {
    if (wanted && !wanted.has(group.status)) continue
    rows.push(buildM3u8MainTask(group, liveTasks))
  }
  return rows
}
