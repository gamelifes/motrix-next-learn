/**
 * @fileoverview Tests for HLS (.m3u8) playlist parsing and temp-dir helpers.
 */
import { describe, it, expect } from 'vitest'
import { parseM3U8Playlist, getSafeM3u8OutName, prepareM3u8TempDir, inspectM3u8Playlist } from '../m3u8Parser'
import { M3U8_TEMP_DIR_PREFIX } from '@shared/constants'

describe('parseM3U8Playlist', () => {
  it('returns an empty array for an empty playlist', () => {
    expect(parseM3U8Playlist('', 'https://cdn.example.com/video.m3u8')).toEqual([])
  })

  it('resolves relative segment URLs against the playlist URL', () => {
    const playlist = ['#EXTM3U', '#EXTINF:10,', 'seg1.ts', '#EXTINF:10,', 'seg2.ts', '#EXT-X-ENDLIST'].join('\n')
    expect(parseM3U8Playlist(playlist, 'https://cdn.example.com/hls/video.m3u8')).toEqual([
      'https://cdn.example.com/hls/seg1.ts',
      'https://cdn.example.com/hls/seg2.ts',
    ])
  })

  it('keeps absolute segment URLs untouched', () => {
    const playlist = [
      '#EXTINF:10,',
      'https://other.example.com/a.ts',
      '#EXTINF:10,',
      'https://other.example.com/b.ts',
    ].join('\n')
    expect(parseM3U8Playlist(playlist, 'https://cdn.example.com/video.m3u8')).toEqual([
      'https://other.example.com/a.ts',
      'https://other.example.com/b.ts',
    ])
  })

  it('ignores comment lines, blank lines and EXTINF tags', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '',
      '#EXTINF:6.006,',
      'seq-0.ts',
      '   #EXTINF:6.006,   ',
      '   seq-1.ts   ',
      '#EXT-X-ENDLIST',
    ].join('\n')
    const uris = parseM3U8Playlist(playlist, 'https://cdn.example.com/video.m3u8')
    expect(uris).toEqual(['https://cdn.example.com/seq-0.ts', 'https://cdn.example.com/seq-1.ts'])
  })

  it('ignores #EXT-X-KEY encryption directives so encrypted streams are not silently corrupt', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key"',
      '#EXTINF:10,',
      'seg.ts',
    ].join('\n')
    expect(parseM3U8Playlist(playlist, 'https://cdn.example.com/video.m3u8')).toEqual([
      'https://cdn.example.com/seg.ts',
    ])
  })

  it('skips lines that cannot be resolved when the base URL is invalid', () => {
    const playlist = ['#EXTM3U', ':::not-a-url:::', 'seg.ts'].join('\n')
    expect(parseM3U8Playlist(playlist, 'not a playlist url')).toEqual([])
  })

  it('handles query strings on segment URLs', () => {
    const playlist = ['#EXTINF:10,', 'seg.ts?token=abc'].join('\n')
    expect(parseM3U8Playlist(playlist, 'https://cdn.example.com/video.m3u8')).toEqual([
      'https://cdn.example.com/seg.ts?token=abc',
    ])
  })
})

describe('getSafeM3u8OutName', () => {
  it('returns an empty string for empty input', () => {
    expect(getSafeM3u8OutName('')).toBe('')
    expect(getSafeM3u8OutName('   ')).toBe('')
  })

  it('strips directory components', () => {
    expect(getSafeM3u8OutName('folder/sub/video')).toBe('video')
    expect(getSafeM3u8OutName('C:\\videos\\final\\episode')).toBe('episode')
  })

  it('rejects Windows reserved device names', () => {
    expect(getSafeM3u8OutName('CON')).toBe('')
    expect(getSafeM3u8OutName('nul')).toBe('')
    expect(getSafeM3u8OutName('com1')).toBe('')
  })

  it('rejects trailing dots and spaces', () => {
    expect(getSafeM3u8OutName('video.')).toBe('')
    expect(getSafeM3u8OutName('video ')).toBe('')
  })

  it('keeps a normal video name', () => {
    expect(getSafeM3u8OutName('my movie')).toBe('my movie')
  })
})

describe('inspectM3u8Playlist', () => {
  it('classifies a VOD playlist that ends with EXT-X-ENDLIST', () => {
    const info = inspectM3u8Playlist(
      ['#EXTM3U', '#EXT-X-TARGETDURATION:10', '#EXTINF:10,', 'seg-0.ts', '#EXT-X-ENDLIST'].join('\n'),
    )
    expect(info.kind).toBe('vod')
    expect(info.isHls).toBe(true)
    expect(info.hasEndList).toBe(true)
    expect(info.hasStreamInf).toBe(false)
    expect(info.variantUrls).toEqual([])
  })

  it('classifies a sliding-window live playlist (no ENDLIST) as live', () => {
    const info = inspectM3u8Playlist(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:6',
        '#EXT-X-MEDIA-SEQUENCE:2680',
        '#EXTINF:6.0,',
        'https://cdn.example.com/live/seg-2680.ts',
        '#EXTINF:6.0,',
        'https://cdn.example.com/live/seg-2681.ts',
      ].join('\n'),
    )
    expect(info.kind).toBe('live')
    expect(info.hasEndList).toBe(false)
  })

  it('classifies a declared EVENT playlist as event (rejected)', () => {
    const info = inspectM3u8Playlist(
      ['#EXTM3U', '#EXT-X-PLAYLIST-TYPE:EVENT', '#EXTINF:6.006,', 'https://cdn.example.com/event/seg-0.ts'].join('\n'),
    )
    expect(info.kind).toBe('event')
    expect(info.isEvent).toBe(true)
    expect(info.playlistType).toBe('EVENT')
  })

  it('classifies a declared VOD playlist as vod even without ENDLIST', () => {
    const info = inspectM3u8Playlist(['#EXTM3U', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXTINF:10,', 'seg-0.ts'].join('\n'))
    expect(info.kind).toBe('vod')
    expect(info.playlistType).toBe('VOD')
  })

  it('classifies a master playlist with STREAM-INF variants as master and captures variant URLs', () => {
    const info = inspectM3u8Playlist(
      [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720',
        '720p/index.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=640000,RESOLUTION=640x360',
        '360p/index.m3u8',
      ].join('\n'),
    )
    expect(info.kind).toBe('master')
    expect(info.hasStreamInf).toBe(true)
    expect(info.variantUrls).toEqual(['720p/index.m3u8', '360p/index.m3u8'])
  })

  it('classifies non-HLS content as unknown', () => {
    expect(inspectM3u8Playlist('<!DOCTYPE html><html><body>Not a playlist</body></html>').kind).toBe('unknown')
    expect(inspectM3u8Playlist('').kind).toBe('unknown')
    expect(inspectM3u8Playlist('plain text line').kind).toBe('unknown')
  })

  it('is case-insensitive for the PLAYLIST-TYPE value', () => {
    const info = inspectM3u8Playlist(['#EXTM3U', '#EXT-X-PLAYLIST-TYPE:event', '#EXTINF:6,', 'seg.ts'].join('\n'))
    expect(info.kind).toBe('event')
  })
})

describe('prepareM3u8TempDir', () => {
  it('creates a temp dir name prefixed with the m3u8 marker', () => {
    const result = prepareM3u8TempDir('/dl', 'my video', ['https://cdn.example.com/file-0.ts'])
    expect(result.tempDir).toMatch(new RegExp(`^/dl/${M3U8_TEMP_DIR_PREFIX}my video-[0-9a-f]{8}$`))
  })

  it('derives segment file names from URL basenames', () => {
    const result = prepareM3u8TempDir('/dl', 'vid', [
      'https://cdn.example.com/record/seg-0.ts',
      'https://cdn.example.com/record/seg-1.ts',
    ])
    expect(result.segmentFiles).toHaveLength(2)
    expect(result.segmentFiles[0]).toMatch(/\/seg-0\.ts$/)
    expect(result.segmentFiles[1]).toMatch(/\/seg-1\.ts$/)
  })

  it('disambiguates duplicate segment basenames', () => {
    const result = prepareM3u8TempDir('/dl', 'vid', [
      'https://cdn.example.com/seg.ts',
      'https://cdn.example.com/seg.ts',
    ])
    expect(result.segmentFiles[0]).not.toBe(result.segmentFiles[1])
    expect(result.segmentFiles[1]).toMatch(/seg_2\.ts$/)
  })

  it('maps segment URLs to their resolved file paths', () => {
    const urls = ['https://cdn.example.com/a.ts', 'https://cdn.example.com/b.ts']
    const result = prepareM3u8TempDir('/dl', 'vid', urls)
    for (const url of urls) {
      const path = result.urlToFileMap.get(url)
      expect(path).toBeTruthy()
      expect(result.segmentFiles).toContain(path)
    }
  })
})
