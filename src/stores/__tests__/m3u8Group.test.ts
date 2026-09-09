/** @fileoverview Unit tests for the M3U8 group store (per-playlist segment tracking). */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useM3u8GroupStore } from '../task/m3u8Group'

function seedGroup(segmentUrls: string[]) {
  const store = useM3u8GroupStore()
  return store.createGroup({
    videoName: 'movie',
    finalPath: '/dl/movie.mp4',
    tempDir: '/dl/.motrix-m3u8-movie-abc12345',
    ffmpegPath: '/usr/bin/ffmpeg',
    segmentUrls,
  })
}

describe('useM3u8GroupStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('creates a group with pending segments in order', () => {
    const store = useM3u8GroupStore()
    const id = seedGroup(['https://cdn/a.ts', 'https://cdn/b.ts'])

    const group = store.getGroup(id)
    expect(group).toBeTruthy()
    expect(group?.status).toBe('downloading')
    expect(group?.segments).toHaveLength(2)
    expect(group?.segments[0]).toMatchObject({ index: 0, url: 'https://cdn/a.ts', status: 'pending' })
    expect(group?.segments[1]).toMatchObject({ index: 1, url: 'https://cdn/b.ts', status: 'pending' })
  })

  it('counts groups by status', () => {
    const store = useM3u8GroupStore()
    const id = seedGroup(['https://cdn/a.ts'])
    store.setGroupStatus(id, 'partial')

    expect(store.countByStatus).toMatchObject({ partial: 1, downloading: 0 })
  })

  it('registers the aria2 GID for a segment', () => {
    const store = useM3u8GroupStore()
    const id = seedGroup(['https://cdn/a.ts'])
    store.registerSegment(id, 0, 'gid-1', '/dl/.motrix-m3u8-movie-abc12345/0000.ts')

    const seg = store.getGroup(id)?.segments[0]
    expect(seg?.aria2Gid).toBe('gid-1')
    expect(seg?.filePath).toBe('/dl/.motrix-m3u8-movie-abc12345/0000.ts')
    expect(seg?.status).toBe('downloading')
  })

  it('updates a segment status by aria2 GID', () => {
    const store = useM3u8GroupStore()
    const id = seedGroup(['https://cdn/a.ts'])
    store.registerSegment(id, 0, 'gid-1', '/dl/0000.ts')
    store.updateSegmentStatus(id, 'gid-1', 'completed', 1000, 1000)

    const seg = store.getGroup(id)?.segments[0]
    expect(seg?.status).toBe('completed')
    expect(seg?.bytesDownloaded).toBe(1000)
    expect(seg?.totalBytes).toBe(1000)
  })

  it('ignores registerSegment/updateSegmentStatus for unknown groups or gids', () => {
    const store = useM3u8GroupStore()
    expect(() => store.registerSegment('missing', 0, 'gid', '/dl/x.ts')).not.toThrow()
    expect(() => store.updateSegmentStatus('missing', 'gid', 'failed', 0, 0)).not.toThrow()
  })

  it('detects terminal/all-completed/failed states', () => {
    const store = useM3u8GroupStore()
    const id = seedGroup(['https://cdn/a.ts', 'https://cdn/b.ts'])
    store.registerSegment(id, 0, 'gid-0', '/dl/0.ts')
    store.registerSegment(id, 1, 'gid-1', '/dl/1.ts')

    expect(store.allSegmentsTerminal(id)).toBe(false)
    expect(store.hasAnyFailed(id)).toBe(false)

    store.updateSegmentStatus(id, 'gid-0', 'completed', 1, 1)
    store.updateSegmentStatus(id, 'gid-1', 'failed', 0, 1)

    expect(store.allSegmentsTerminal(id)).toBe(true)
    expect(store.allSegmentsCompleted(id)).toBe(false)
    expect(store.hasAnyFailed(id)).toBe(true)
  })

  it('retrySegment increments the retry counter and reports remaining attempts', () => {
    const store = useM3u8GroupStore()
    const id = seedGroup(['https://cdn/a.ts'])
    store.registerSegment(id, 0, 'gid-1', '/dl/0.ts')
    store.updateSegmentStatus(id, 'gid-1', 'failed', 0, 0)

    const first = store.retrySegment(id, 0, 2)
    expect(first).toMatchObject({ canRetry: true, retryCount: 1 })
    expect(first?.url).toBe('https://cdn/a.ts')

    const second = store.retrySegment(id, 0, 2)
    expect(second?.canRetry).toBe(true)

    const third = store.retrySegment(id, 0, 2)
    expect(third?.canRetry).toBe(false)
    expect(third?.retryCount).toBe(3)
  })

  it('retrySegment respects maxRetries=0 (retries disabled)', () => {
    const store = useM3u8GroupStore()
    const id = seedGroup(['https://cdn/a.ts'])
    store.registerSegment(id, 0, 'gid-1', '/dl/0.ts')
    store.updateSegmentStatus(id, 'gid-1', 'failed', 0, 0)

    const first = store.retrySegment(id, 0, 0)
    expect(first?.canRetry).toBe(false)
    expect(first?.retryCount).toBe(1)
  })

  it('retrySegment returns null for unknown group or segment', () => {
    const store = useM3u8GroupStore()
    expect(store.retrySegment('missing', 0, 5)).toBeNull()
    const id = seedGroup(['https://cdn/a.ts'])
    expect(store.retrySegment(id, 99, 5)).toBeNull()
  })

  it('removes a group', () => {
    const store = useM3u8GroupStore()
    const id = seedGroup(['https://cdn/a.ts'])
    store.removeGroup(id)
    expect(store.getGroup(id)).toBeUndefined()
  })
})
