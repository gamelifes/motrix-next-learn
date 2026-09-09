<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NDescriptions, NDescriptionsItem, NProgress, NTag } from 'naive-ui'
import { useM3u8GroupStore } from '@/stores/task/m3u8Group'
import { bytesToSize } from '@shared/utils'
import TaskSegmentGraphic from '../TaskSegmentGraphic.vue'

const props = defineProps<{
  groupId: string
}>()

const emit = defineEmits<{
  retry: [segmentIndex: number]
}>()

const { t } = useI18n()
const m3u8GroupStore = useM3u8GroupStore()

const group = computed(() => m3u8GroupStore.getGroup(props.groupId))

const completedCount = computed(() => {
  if (!group.value) return 0
  return group.value.segments.filter((s) => s.status === 'completed').length
})

const failedCount = computed(() => {
  if (!group.value) return 0
  return group.value.segments.filter((s) => s.status === 'failed').length
})

const downloadingCount = computed(() => {
  if (!group.value) return 0
  return group.value.segments.filter((s) => s.status === 'downloading').length
})

const totalCount = computed(() => group.value?.segments.length ?? 0)

const percent = computed(() => {
  if (totalCount.value === 0) return 0
  return Math.round((completedCount.value / totalCount.value) * 100)
})

const totalBytes = computed(() => {
  if (!group.value) return 0
  return group.value.segments.reduce((sum, s) => sum + s.totalBytes, 0)
})

const downloadedBytes = computed(() => {
  if (!group.value) return 0
  return group.value.segments.reduce((sum, s) => sum + s.bytesDownloaded, 0)
})

const statusTagType = computed(() => {
  if (!group.value) return 'default'
  switch (group.value.status) {
    case 'downloading':
      return 'warning'
    case 'merging':
      return 'info'
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    case 'partial':
      return 'warning'
    default:
      return 'default'
  }
})

const statusLabel = computed(() => {
  if (!group.value) return ''
  switch (group.value.status) {
    case 'downloading':
      return t('task.m3u8-status-downloading') || 'Downloading'
    case 'merging':
      return t('task.m3u8-status-merging') || 'Merging'
    case 'completed':
      return t('task.m3u8-status-completed') || 'Completed'
    case 'failed':
      return t('task.m3u8-status-failed') || 'Failed'
    case 'partial':
      return t('task.m3u8-status-partial') || 'Partial'
    default:
      return group.value.status
  }
})

function handleRetry(segmentIndex: number) {
  emit('retry', segmentIndex)
}
</script>

<template>
  <template v-if="group">
    <TaskSegmentGraphic :segments="group.segments" @retry="handleRetry" />
    <NDescriptions :column="1" label-placement="left" bordered size="small">
      <NDescriptionsItem :label="t('task.task-progress-info') || 'Progress'">
        <div class="progress-row">
          <NProgress type="line" :percentage="percent" :height="10" :show-indicator="false" processing />
          <span class="progress-pct">{{ percent }}%</span>
        </div>
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('task.m3u8-segments') || 'Segments'">
        {{ completedCount }} / {{ totalCount }}
        <span v-if="downloadingCount > 0" class="segment-meta">
          ({{ downloadingCount }} {{ t('task.m3u8-downloading') || 'downloading' }})
        </span>
        <span v-if="failedCount > 0" class="segment-meta segment-meta--error">
          ({{ failedCount }} {{ t('task.m3u8-failed') || 'failed' }})
        </span>
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('task.task-file-size') || 'Size'">
        {{ bytesToSize(downloadedBytes, 2) }}
        <span v-if="totalBytes > 0"> / {{ bytesToSize(totalBytes, 2) }}</span>
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('task.task-status') || 'Status'">
        <NTag :type="statusTagType" size="small">{{ statusLabel }}</NTag>
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('task.m3u8-output') || 'Output'">
        <span class="technical-text-wrap">{{ group.videoName }}.mp4</span>
      </NDescriptionsItem>
    </NDescriptions>
  </template>
</template>

<style scoped>
.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.progress-pct {
  font-size: 12px;
  color: var(--m3-on-surface-variant);
  white-space: nowrap;
}
.segment-meta {
  font-size: 12px;
  color: var(--m3-on-surface-variant);
  margin-left: 4px;
}
.segment-meta--error {
  color: var(--m3-error);
}
.technical-text-wrap {
  word-break: break-all;
  font-size: 12px;
}
</style>
