import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useTaskStore } from '@/stores/task'
import { usePreferenceStore } from '@/stores/preference'
import type { Aria2Task } from '@shared/types'

vi.mock('@formkit/auto-animate', () => ({
  autoAnimate: vi.fn(() => ({
    enable: vi.fn(),
    disable: vi.fn(),
    destroy: vi.fn(),
  })),
}))

vi.mock('@vueuse/integrations/useSortable', () => ({
  moveArrayElement: vi.fn(),
  useSortable: vi.fn(),
}))

vi.mock('../TaskItem.vue', () => ({
  default: { name: 'TaskItem', props: ['task'], template: '<div class="full-task-item" />' },
}))

vi.mock('../TaskCompactItem.vue', () => ({
  default: { name: 'TaskCompactItem', props: ['task'], template: '<div class="compact-task-item" />' },
}))

import TaskList from '../TaskList.vue'

function createTask(): Aria2Task {
  return {
    gid: 'gid-1',
    status: 'active',
    totalLength: '100',
    completedLength: '25',
    uploadLength: '0',
    downloadSpeed: '10',
    uploadSpeed: '0',
    connections: '1',
    dir: '/downloads',
    files: [],
    errorMessage: '',
  }
}

describe('TaskList', () => {
  let pinia: Pinia

  beforeEach(() => {
    vi.clearAllMocks()
    pinia = createPinia()
    setActivePinia(pinia)
  })

  it('renders full task cards by default', async () => {
    const wrapper = mount(TaskList, {
      global: {
        plugins: [pinia],
      },
    })
    const taskStore = useTaskStore()
    taskStore.taskList = [createTask()]
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.full-task-item').exists()).toBe(true)
    expect(wrapper.find('.compact-task-item').exists()).toBe(false)
  })

  it('renders compact task cards when taskCardMode is compact', async () => {
    const wrapper = mount(TaskList, {
      global: {
        plugins: [pinia],
      },
    })
    const taskStore = useTaskStore()
    const preferenceStore = usePreferenceStore()
    preferenceStore.updatePreference({ taskCardMode: 'compact' })
    taskStore.taskList = [createTask()]

    await wrapper.vm.$nextTick()

    expect(wrapper.find('.compact-task-item').exists()).toBe(true)
    expect(wrapper.find('.full-task-item').exists()).toBe(false)
  })
})
