<script setup lang="ts">
/** @fileoverview Visual segment progress graphic for m3u8 downloads. */
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import type { SegmentStatus } from '@shared/types'

const props = withDefaults(
  defineProps<{
    segments: SegmentStatus[]
    atomWidth?: number
    atomHeight?: number
    atomGutter?: number
    atomRadius?: number
  }>(),
  {
    atomWidth: 8,
    atomHeight: 8,
    atomGutter: 2,
    atomRadius: 1.5,
  },
)

const emit = defineEmits<{
  retry: [segmentIndex: number]
}>()

const container = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const containerWidth = ref(300)

function updateWidth() {
  if (container.value) containerWidth.value = container.value.clientWidth
}

let ro: ResizeObserver | null = null
onMounted(() => {
  updateWidth()
  if (container.value) {
    ro = new ResizeObserver(() => {
      updateWidth()
      nextTick(draw)
    })
    ro.observe(container.value)
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
})

const len = computed(() => props.segments.length)
const atomWG = computed(() => props.atomWidth + props.atomGutter)
const atomHG = computed(() => props.atomHeight + props.atomGutter)

const columnCount = computed(() => {
  const cols = Math.floor((containerWidth.value - props.atomWidth) / atomWG.value) + 1
  return Math.max(cols, 1)
})

const rowCount = computed(() => Math.ceil(len.value / columnCount.value))

const canvasWidth = computed(() => atomWG.value * (columnCount.value - 1) + props.atomWidth)
const canvasHeight = computed(() => atomHG.value * (rowCount.value - 1) + props.atomHeight)

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function getStatusColor(status: SegmentStatus['status']): string {
  switch (status) {
    case 'completed':
      return cssVar('--m3-status-success', '#67C23A')
    case 'downloading':
      return cssVar('--m3-status-active', '#409EFF')
    case 'failed':
      return cssVar('--m3-error', '#F56C6C')
    case 'pending':
    default:
      return cssVar('--m3-surface-container', '#2a2a2a')
  }
}

const strokeColor = computed(() => cssVar('--m3-outline-variant', '#333'))

const prevStatus = ref<string[]>([])

function draw() {
  const cvs = canvas.value
  if (!cvs || len.value === 0) return

  const dpr = window.devicePixelRatio || 1
  const w = canvasWidth.value
  const h = canvasHeight.value

  cvs.width = w * dpr
  cvs.height = h * dpr
  cvs.style.width = w + 'px'
  cvs.style.height = h + 'px'

  const ctx = cvs.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  const cols = columnCount.value
  const aw = props.atomWidth
  const ah = props.atomHeight
  const awg = atomWG.value
  const ahg = atomHG.value
  const r = props.atomRadius
  const segs = props.segments
  const n = segs.length

  const newStatus: string[] = new Array(n)

  for (let i = 0; i < n; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * awg
    const y = row * ahg
    const seg = segs[i]
    const status = seg.status
    newStatus[i] = status

    const wasInactive = prevStatus.value.length > 0 && (prevStatus.value[i] || '') === 'pending'
    const justActivated = wasInactive && status === 'downloading'

    ctx.fillStyle = getStatusColor(status)
    ctx.globalAlpha = status === 'pending' ? 0.5 : 1.0

    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + aw - r, y)
    ctx.arcTo(x + aw, y, x + aw, y + r, r)
    ctx.lineTo(x + aw, y + ah - r)
    ctx.arcTo(x + aw, y + ah, x + aw - r, y + ah, r)
    ctx.lineTo(x + r, y + ah)
    ctx.arcTo(x, y + ah, x, y + ah - r, r)
    ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = strokeColor.value
    ctx.lineWidth = 0.5
    ctx.globalAlpha = status === 'pending' ? 0.3 : 0.6
    ctx.stroke()

    if (justActivated) {
      ctx.globalAlpha = 0.3
      ctx.fillStyle = cssVar('--m3-status-active', '#409EFF')
      ctx.fill()
    }
  }

  ctx.globalAlpha = 1.0
  prevStatus.value = newStatus
}

function handleClick(event: MouseEvent) {
  const cvs = canvas.value
  if (!cvs || len.value === 0) return

  const rect = cvs.getBoundingClientRect()
  const scaleX = canvasWidth.value / rect.width
  const scaleY = canvasHeight.value / rect.height
  const mx = (event.clientX - rect.left) * scaleX
  const my = (event.clientY - rect.top) * scaleY

  const cols = columnCount.value
  const awg = atomWG.value
  const ahg = atomHG.value

  const col = Math.floor(mx / awg)
  const row = Math.floor(my / ahg)
  if (col < 0 || col >= cols || row < 0) return

  const index = row * cols + col
  if (index < 0 || index >= len.value) return

  const seg = props.segments[index]
  if (seg && seg.status === 'failed') {
    emit('retry', seg.index)
  }
}

watch(
  () => props.segments,
  () => nextTick(draw),
  { deep: true },
)
watch([canvasWidth, canvasHeight], () => nextTick(draw))
onMounted(() => nextTick(draw))
</script>

<template>
  <div ref="container" class="segment-graphic-container">
    <canvas v-if="segments.length > 0" ref="canvas" class="segment-graphic" @click="handleClick" />
    <div v-else class="no-segments">No segment data</div>
  </div>
</template>

<style scoped>
.segment-graphic-container {
  width: 100%;
  padding: 8px 0;
  overflow: hidden;
}
.segment-graphic {
  display: block;
}
.no-segments {
  color: var(--m3-on-surface-variant);
  font-size: 12px;
  padding: 8px 0;
}
</style>
