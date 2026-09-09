/** @fileoverview Shared task-card display model for full and compact task rows. */
import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { TASK_STATUS } from '@shared/constants'
import { useM3u8GroupStore } from '@/stores/task/m3u8Group'
import {
  bytesToSize,
  calcProgress,
  checkTaskIsSharing,
  getTaskCompletedLength,
  getTaskDisplayName,
  getTaskSharingKind,
  isBtMetadataTask,
  timeFormat,
  timeRemaining,
} from '@shared/utils'
import { buildTaskTransferSummary } from '@/composables/useTaskDetailSummary'
import type { Aria2Task } from '@shared/types'

export interface TaskCardStatusBadge {
  key: string
  label: string
  tone: 'success' | 'error' | 'muted' | 'waiting'
}

interface TaskCardModel {
  taskFullName: ComputedRef<string>
  sharingKind: ComputedRef<'bt' | 'ed2k' | null>
  isSharing: ComputedRef<boolean>
  sharingLabel: ComputedRef<string>
  isMetadataFetching: ComputedRef<boolean>
  statusBadge: ComputedRef<TaskCardStatusBadge | null>
  taskStatus: ComputedRef<string>
  isActive: ComputedRef<boolean>
  completedLengthValue: ComputedRef<number>
  percent: ComputedRef<number>
  completedSize: ComputedRef<string>
  totalSize: ComputedRef<string>
  hasSizeInfo: ComputedRef<boolean>
  downloadSpeed: ComputedRef<string>
  uploadSpeed: ComputedRef<string>
  remaining: ComputedRef<number>
  remainingText: ComputedRef<string>
  transferSummary: ComputedRef<ReturnType<typeof buildTaskTransferSummary>>
}

export function useTaskCardModel(task: ComputedRef<Aria2Task>): TaskCardModel {
  const { t } = useI18n()
  const m3u8GroupStore = useM3u8GroupStore()

  const taskFullName = computed(() =>
    getTaskDisplayName(task.value, { defaultName: t('task.get-task-name') || 'Unknown' }),
  )
  const sharingKind = computed(() => getTaskSharingKind(task.value))
  const isSharing = computed(() => checkTaskIsSharing(task.value))
  const sharingLabel = computed(() => {
    if (sharingKind.value === 'bt') return t('task.seeding') || 'Seeding'
    if (sharingKind.value === 'ed2k') return t('task.sharing') || 'Sharing'
    return ''
  })
  const isMetadataFetching = computed(() => isBtMetadataTask(task.value))

  /** True if this aria2 task is one segment of an m3u8 group. */
  const m3u8GroupRef = computed(() => {
    const gid = task.value.gid
    if (!gid) return null
    for (const group of Object.values(m3u8GroupStore.groups)) {
      if (group.segmentGids.includes(gid)) return group
    }
    return null
  })
  const isM3u8Segment = computed(() => !!m3u8GroupRef.value)

  const taskStatus = computed(() => (isSharing.value ? TASK_STATUS.SHARING : task.value.status))
  const statusBadge = computed<TaskCardStatusBadge | null>(() => {
    if (isM3u8Segment.value) {
      const group = m3u8GroupRef.value
      if (group) {
        if (group.status === 'merging') {
          return { key: 'm3u8-merging', label: t('task.m3u8-status-merging') || 'Merging', tone: 'waiting' }
        }
        if (group.status === 'failed' || group.status === 'partial') {
          return {
            key: `m3u8-${group.status}`,
            label: t(`task.m3u8-status-${group.status}`) || group.status,
            tone: 'error',
          }
        }
      }
      const seg = m3u8GroupRef.value?.segments.find((s) => s.aria2Gid === task.value.gid)
      if (seg && seg.status === 'failed') {
        return { key: 'm3u8-segment-failed', label: t('task.m3u8-status-failed') || 'Failed', tone: 'error' }
      }
      if (task.value.status === TASK_STATUS.COMPLETE) {
        return {
          key: 'm3u8-segment-complete',
          label: t('task.m3u8-segment-complete') || 'Segment done',
          tone: 'success',
        }
      }
      return {
        key: 'm3u8-segment-active',
        label: t('task.m3u8-segment-downloading') || 'Segment',
        tone: 'waiting',
      }
    }
    if (isSharing.value) return { key: 'sharing', label: sharingLabel.value, tone: 'success' }
    if (isMetadataFetching.value)
      return {
        key: 'bt-metadata-fetching',
        label: t('task.bt-metadata-fetching') || 'Fetching torrent',
        tone: 'waiting',
      }

    switch (task.value.status) {
      case TASK_STATUS.WAITING:
        return { key: TASK_STATUS.WAITING, label: t('task.status-waiting') || 'Queued', tone: 'waiting' }
      case TASK_STATUS.COMPLETE:
        return { key: TASK_STATUS.COMPLETE, label: t('task.task-complete') || 'Completed', tone: 'success' }
      case TASK_STATUS.ERROR:
        return { key: TASK_STATUS.ERROR, label: t('task.task-error') || 'Error', tone: 'error' }
      case TASK_STATUS.REMOVED:
        return { key: TASK_STATUS.REMOVED, label: t('task.task-removed') || 'Removed', tone: 'muted' }
      default:
        return null
    }
  })
  const isActive = computed(() => task.value.status === TASK_STATUS.ACTIVE)
  const completedLengthValue = computed(() => getTaskCompletedLength(task.value))
  const percent = computed(() => calcProgress(task.value.totalLength, completedLengthValue.value))
  const completedSize = computed(() => bytesToSize(completedLengthValue.value, 2))
  const totalSize = computed(() => bytesToSize(task.value.totalLength, 2))
  const hasSizeInfo = computed(() => completedLengthValue.value > 0 || Number(task.value.totalLength) > 0)
  const downloadSpeed = computed(() => bytesToSize(task.value.downloadSpeed))
  const uploadSpeed = computed(() => bytesToSize(task.value.uploadSpeed))
  const transferSummary = computed(() => buildTaskTransferSummary(task.value))
  const remaining = computed(() => {
    if (!isActive.value) return 0
    return timeRemaining(Number(task.value.totalLength), completedLengthValue.value, Number(task.value.downloadSpeed))
  })
  const remainingText = computed(() => {
    if (remaining.value <= 0) return ''
    return timeFormat(remaining.value, {
      prefix: t('task.remaining-prefix') || '',
      i18n: {
        gt1d: t('app.gt1d') || '>1d',
        hour: t('app.hour') || 'h',
        minute: t('app.minute') || 'm',
        second: t('app.second') || 's',
      },
    })
  })

  return {
    taskFullName,
    sharingKind,
    isSharing,
    sharingLabel,
    isMetadataFetching,
    statusBadge,
    taskStatus,
    isActive,
    completedLengthValue,
    percent,
    completedSize,
    totalSize,
    hasSizeInfo,
    downloadSpeed,
    uploadSpeed,
    remaining,
    remainingText,
    transferSummary,
  }
}
