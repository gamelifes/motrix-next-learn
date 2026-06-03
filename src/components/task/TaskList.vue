<script setup lang="ts">
/** @fileoverview Scrollable task list container with SortableJS drag ordering and list transitions. */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { autoAnimate } from '@formkit/auto-animate'
import { useSortable } from '@vueuse/integrations/useSortable'
import { useTaskStore } from '@/stores/task'
import { usePreferenceStore } from '@/stores/preference'
import TaskItem from './TaskItem.vue'
import TaskCompactItem from './TaskCompactItem.vue'
import type { AnimationController } from '@formkit/auto-animate'
import type { SortableEvent } from 'sortablejs'
import type { Aria2Task } from '@shared/types'

const emit = defineEmits<{
  pause: [task: Aria2Task]
  resume: [task: Aria2Task]
  delete: [task: Aria2Task]
  'delete-record': [task: Aria2Task]
  'copy-link': [task: Aria2Task]
  'show-info': [task: Aria2Task]
  folder: [task: Aria2Task]
  'open-file': [task: Aria2Task]
  'stop-sharing': [task: Aria2Task]
}>()

const taskStore = useTaskStore()
const preferenceStore = usePreferenceStore()

const taskList = ref<Aria2Task[]>(taskStore.taskList)
const listRef = ref<HTMLElement | null>(null)
const sorting = ref(false)
let listAnimation: AnimationController | null = null
let lastFloatingRect: DOMRect | null = null
let floatingRectFrame = 0
const selectedGidList = computed(() => taskStore.selectedGidList)
const taskCardComponent = computed(() =>
  preferenceStore.config.taskCardMode === 'compact' ? TaskCompactItem : TaskItem,
)

onMounted(() => {
  if (!listRef.value) return
  listAnimation = autoAnimate(listRef.value, {
    duration: 260,
    easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  })
})

onBeforeUnmount(() => {
  listAnimation?.destroy?.()
  listAnimation = null
  stopFloatingRectTracking()
  lastFloatingRect = null
})

function trackFloatingRect() {
  const floating = document.querySelector<HTMLElement>('.task-list-item--floating')
  if (floating?.isConnected) {
    lastFloatingRect = floating.getBoundingClientRect()
  }

  if (sorting.value) {
    floatingRectFrame = requestAnimationFrame(trackFloatingRect)
  }
}

function startFloatingRectTracking() {
  stopFloatingRectTracking()
  lastFloatingRect = null
  floatingRectFrame = requestAnimationFrame(trackFloatingRect)
}

function stopFloatingRectTracking() {
  if (!floatingRectFrame) return
  cancelAnimationFrame(floatingRectFrame)
  floatingRectFrame = 0
}

function animateDropSettle(event: SortableEvent): Promise<void> {
  const item = event.item
  if (!lastFloatingRect || !item.isConnected) return Promise.resolve()

  const targetRect = item.getBoundingClientRect()
  const deltaX = lastFloatingRect.left - targetRect.left
  const deltaY = lastFloatingRect.top - targetRect.top
  lastFloatingRect = null

  if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return Promise.resolve()

  item.classList.add('task-list-item--settling')
  item.style.setProperty('--task-drop-x', `${deltaX}px`)
  item.style.setProperty('--task-drop-y', `${deltaY}px`)

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      item.classList.add('task-list-item--settled')
    })

    window.setTimeout(() => {
      item.classList.remove('task-list-item--settling', 'task-list-item--settled')
      item.style.removeProperty('--task-drop-x')
      item.style.removeProperty('--task-drop-y')
      resolve()
    }, 320)
  })
}

watch(
  () => taskStore.taskList,
  (v) => {
    if (sorting.value) return
    taskList.value = v
  },
)

useSortable(listRef, taskList, {
  animation: 240,
  handle: '.task-drag-handle',
  draggable: '.task-list-item',
  filter: '.task-item-actions, button, a, input, textarea, select, [data-no-drag]',
  ghostClass: 'task-list-item--ghost',
  chosenClass: 'task-list-item--chosen',
  fallbackClass: 'task-list-item--floating',
  dragClass: 'task-list-item--dragging',
  direction: 'vertical',
  swapThreshold: 0.72,
  invertedSwapThreshold: 0.28,
  invertSwap: false,
  forceFallback: true,
  fallbackOnBody: true,
  fallbackTolerance: 3,
  preventOnFilter: false,
  onStart: () => {
    sorting.value = true
    listAnimation?.disable()
    startFloatingRectTracking()
  },
  onUpdate: (event) => {
    if (event.oldIndex === undefined || event.newIndex === undefined || event.oldIndex === event.newIndex) return
    const nextList = [...taskList.value]
    const [task] = nextList.splice(event.oldIndex, 1)
    if (!task) return
    nextList.splice(event.newIndex, 0, task)
    taskList.value = nextList
  },
  onEnd: async (event) => {
    stopFloatingRectTracking()
    await nextTick()
    await animateDropSettle(event)
    await taskStore.saveManualOrder(taskList.value.map((task) => task.gid))
    window.setTimeout(() => {
      sorting.value = false
      listAnimation?.enable()
    }, 0)
  },
})

function isSelected(gid: string) {
  return selectedGidList.value.includes(gid)
}

function handleItemClick(task: Aria2Task, event: MouseEvent) {
  if (sorting.value) return
  const gid = task.gid
  const list = [...selectedGidList.value]
  if (event.metaKey || event.ctrlKey) {
    const idx = list.indexOf(gid)
    if (idx === -1) list.push(gid)
    else list.splice(idx, 1)
  } else {
    list.length = 0
    list.push(gid)
  }
  taskStore.selectTasks(list)
}
</script>

<template>
  <div class="task-list">
    <div ref="listRef" class="task-list-inner">
      <div
        v-for="item in taskList"
        :key="item.gid"
        :class="{ selected: isSelected(item.gid) }"
        class="task-list-item"
        @click="handleItemClick(item, $event)"
      >
        <span class="task-drag-handle" role="button" tabindex="0" aria-label="Drag task" @click.stop>
          <span aria-hidden="true">⋮⋮</span>
        </span>
        <component
          :is="taskCardComponent"
          :task="item"
          @pause="emit('pause', item)"
          @resume="emit('resume', item)"
          @delete="emit('delete', item)"
          @delete-record="emit('delete-record', item)"
          @copy-link="emit('copy-link', item)"
          @show-info="emit('show-info', item)"
          @folder="emit('folder', item)"
          @open-file="emit('open-file', item)"
          @stop-sharing="emit('stop-sharing', item)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-list {
  --task-list-bottom-safety: 54px;
  padding: 16px 36px 16px;
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
/*
 * Speedometer bottom safety area — only when cards are present.
 * A ::after pseudo-element participates in flex layout, reliably
 * letting the final card scroll above the fixed Speedometer widget without
 * forcing short lists to show a scrollbar.
 */
.task-list-inner:not(:empty)::after {
  content: '';
  display: block;
  height: var(--task-list-bottom-safety);
}

/* ── Task card layer ─────────────────────────────────────────────────── */
.task-list-inner {
  position: relative;
  z-index: 1;
}
.selected :deep(.task-item) {
  border-color: var(--task-item-hover-border);
}
.task-list-item {
  position: relative;
  margin-bottom: 16px;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  column-gap: 8px;
  align-items: stretch;
}
.task-drag-handle {
  width: 22px;
  min-height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--m3-outline);
  cursor: grab;
  opacity: 0.55;
  font-size: 16px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  transition:
    opacity 0.16s cubic-bezier(0.2, 0, 0, 1),
    color 0.16s cubic-bezier(0.2, 0, 0, 1);
}
.task-drag-handle:hover {
  color: var(--color-primary);
  opacity: 1;
}
.task-drag-handle:active {
  cursor: grabbing;
}
.task-list-item--ghost {
  overflow: hidden;
  opacity: 0;
}
.task-list-item--floating {
  opacity: 1 !important;
  filter: none !important;
  pointer-events: none;
  transition: none !important;
}
.task-list-item--dragging {
  opacity: 1 !important;
}
.task-list-item--settling {
  z-index: 3;
  transform: translate3d(var(--task-drop-x), var(--task-drop-y), 0);
  will-change: transform;
}
.task-list-item--settling.task-list-item--settled {
  transform: translate3d(0, 0, 0);
  transition: transform 300ms ease;
}
.task-list-item--chosen .task-drag-handle {
  color: var(--color-primary);
  opacity: 1;
}
.task-list-item :deep(button),
.task-list-item :deep(a),
.task-list-item :deep(input),
.task-list-item :deep(textarea),
.task-list-item :deep(select) {
  cursor: auto;
}
</style>
