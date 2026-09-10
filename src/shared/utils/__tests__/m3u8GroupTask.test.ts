/** @fileoverview Tests for synthetic m3u8 main-task row helpers. */
import { describe, it, expect } from 'vitest'
import {
  m3u8MainGidFor,
  isM3u8MainGid,
  getGroupIdFromM3u8MainGid,
  getM3u8GroupIdFromTask,
  isM3u8MainTask,
  segmentGidSetFor,
  buildM3u8MainTask,
  collectM3u8MainTasks,
} from '@shared/utils/m3u8GroupTask'
import type { Aria2Task, M3u8Group } from '@shared/types'

function makeGroup(overrides: Partial<M3u8Group> = {}): M3u8Group {
  return {
    groupId: 'group-a',
    videoName: 'movie',
    finalPath: '/dl/movie.mp4',
    tempDir: '/dl/.motrix-m3u8-movie-1234abcd',
    segmentGids: ['seg-0', 'seg-1'],
    ffmpegPath: '/usr/local/bin/ffmpeg',
    status: 'downloading',
    segments: [
      {
        index: 0,
        url: 'https://cdn.example.com/movie/0.ts',
        aria2Gid: 'seg-0',
        filePath: '0.ts',
        status: 'downloading',
        bytesDownloaded: 100,
        totalBytes: 200,
        retryCount: 0,
      },
      {
        index: 1,
        url: 'https://cdn.example.com/movie/1.ts',
        aria2Gid: 'seg-1',
        filePath: '1.ts',
        status: 'completed',
        bytesDownloaded: 300,
        totalBytes: 300,
        retryCount: 0,
      },
    ],
    ...overrides,
  }
}

function makeLiveTask(gid: string, status: Aria2Task['status'], downloadSpeed: string): Aria2Task {
  return {
    gid,
    status,
    totalLength: '200',
    completedLength: '100',
    uploadLength: '0',
    downloadSpeed,
    uploadSpeed: '0',
    connections: '1',
    dir: '/dl/.motrix-m3u8-movie-1234abcd',
    files: [],
  }
}

describe('m3u8 gid helpers', () => {
  it('builds and recognises the synthetic gid format', () => {
    const gid = m3u8MainGidFor('group-a')
    expect(gid).toBe('m3u8:group-a')
    expect(isM3u8MainGid(gid)).toBe(true)
    expect(getGroupIdFromM3u8MainGid(gid)).toBe('group-a')
    expect(getM3u8GroupIdFromTask({ gid })).toBe('group-a')
    expect(isM3u8MainTask({ gid })).toBe(true)
  })

  it('rejects real aria2-style gids', () => {
    expect(isM3u8MainGid('8f9e2a1b3c4d')).toBe(false)
    expect(isM3u8MainGid('')).toBe(false)
    expect(isM3u8MainGid(undefined)).toBe(false)
    expect(getM3u8GroupIdFromTask({ gid: '8f9e2a1b3c4d' })).toBeNull()
    expect(isM3u8MainTask({ gid: '8f9e2a1b3c4d' })).toBe(false)
  })

  it('collects segment gids from groups, skipping empty placeholders', () => {
    const group = makeGroup({ segmentGids: ['', 'seg-0', 'seg-1'] })
    expect(segmentGidSetFor([group])).toEqual(new Set(['seg-0', 'seg-1']))
  })
})

describe('buildM3u8MainTask', () => {
  it('aggregates segment lengths into a single row for downloading groups', () => {
    const task = buildM3u8MainTask(makeGroup())
    expect(task.gid).toBe('m3u8:group-a')
    expect(task.status).toBe('active')
    expect(task.totalLength).toBe('500')
    expect(task.completedLength).toBe('400')
    expect(task.dir).toBe('/dl/.motrix-m3u8-movie-1234abcd')
    expect(task.files[0].path).toBe('/dl/movie.mp4')
    expect(task.files[0].length).toBe('500')
    expect(task.connections).toBe('2')
  })

  it('sums live download speed from active segment tasks', () => {
    const live = new Map([
      ['seg-0', makeLiveTask('seg-0', 'active', '1200')],
      ['seg-1', makeLiveTask('seg-1', 'complete', '0')],
    ])
    const task = buildM3u8MainTask(makeGroup(), live)
    expect(task.downloadSpeed).toBe('1200')
  })

  it('reports 100% once the group is completed, regardless of recorded lengths', () => {
    const group = makeGroup({
      status: 'completed',
      segments: [
        {
          index: 0,
          url: 'https://cdn.example.com/movie/0.ts',
          aria2Gid: 'seg-0',
          filePath: '0.ts',
          status: 'completed',
          bytesDownloaded: 100,
          totalBytes: 0,
          retryCount: 0,
        },
      ],
    })
    const task = buildM3u8MainTask(group)
    expect(task.status).toBe('complete')
    expect(task.completedLength).toBe(task.totalLength)
  })

  it('maps group status onto aria2 task statuses', () => {
    expect(buildM3u8MainTask(makeGroup({ status: 'merging' })).status).toBe('waiting')
    expect(buildM3u8MainTask(makeGroup({ status: 'partial' })).status).toBe('active')
    expect(buildM3u8MainTask(makeGroup({ status: 'failed' })).status).toBe('error')
  })
})

describe('collectM3u8MainTasks', () => {
  const downloading = makeGroup({ groupId: 'a' })
  const merging = makeGroup({ groupId: 'b', status: 'merging' })
  const failed = makeGroup({ groupId: 'c', status: 'failed' })
  const completed = makeGroup({ groupId: 'd', status: 'completed' })
  const groups = [downloading, merging, failed, completed]

  it('active tab shows downloading / merging / partial groups only', () => {
    const gids = collectM3u8MainTasks(groups, 'active').map((t) => t.gid)
    expect(gids).toEqual(['m3u8:a', 'm3u8:b'])
  })

  it('stopped tab shows completed / failed groups only', () => {
    const gids = collectM3u8MainTasks(groups, 'stopped').map((t) => t.gid)
    expect(gids).toEqual(['m3u8:c', 'm3u8:d'])
  })

  it('all tab shows every group', () => {
    expect(collectM3u8MainTasks(groups, 'all')).toHaveLength(4)
  })
})
