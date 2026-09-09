/** @fileoverview Utilities for HLS (.m3u8) download handling. */
import { M3U8_TEMP_DIR_PREFIX } from '@shared/constants'

/**
 * Parse an m3u8 playlist string and return an array of absolute URLs for the
 * .ts segments.
 *
 * @param playlistContent The raw text of the m3u8 playlist.
 * @param baseUrl The URL of the playlist itself, used to resolve relative
 *                segment URLs.
 * @returns Array of absolute segment URLs in the order they appear in the
 *          playlist. Lines that are empty or start with '#' are ignored.
 *          Lines that specify `#EXT-X-KEY` (encryption) are also ignored –
 *          the frontend should treat encrypted playlists as unsupported.
 */
export function parseM3U8Playlist(playlistContent: string, baseUrl: string): string[] {
  const lines = playlistContent.split('\n')
  const tsUris: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }

    // Skip encryption key lines – we do not support decryption.
    if (trimmed.startsWith('#EXT-X-KEY')) {
      continue
    }

    // Try to parse as an absolute URL; if that fails, treat as relative to baseUrl.
    try {
      new URL(trimmed) // will throw if not absolute
      tsUris.push(trimmed)
    } catch {
      try {
        const base = new URL(baseUrl)
        const absolute = new URL(trimmed, base)
        tsUris.push(absolute.toString())
      } catch {
        // If we still can't parse it, skip it (could be invalid)
        // In a real app we might log this.
      }
    }
  }
  return tsUris
}

/**
 * Returns a Windows-safe base name for a temporary directory, derived from the
 * desired video name. If the name after sanitization is empty, returns a
 * timestamp-based fallback.
 *
 * @param name The desired name (e.g. from the m3u8 URL basename or user input).
 * @returns A string safe to use as a directory name on Windows (does not
 *          contain reserved names, trailing spaces/dots, or path separators).
 */
export function getSafeM3u8OutName(name: string): string {
  if (!name) return ''
  // Strip path separators – we expect a bare name.
  const basename = name.replace(/^.*[/\\]/, '')
  if (!basename) return ''
  // Strip extension for reserved-name check.
  const dotIdx = basename.lastIndexOf('.')
  const stem = dotIdx > 0 ? basename.substring(0, dotIdx) : basename
  const WIN_RESERVED_NAMES: ReadonlySet<string> = new Set([
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
  ])
  if (WIN_RESERVED_NAMES.has(stem.toUpperCase())) return ''
  // Reject trailing dots/spaces (Windows refuses to write them).
  if (/[. ]+$/.test(basename)) return ''
  return basename
}

/**
 * Prepare a temporary directory for storing the individual .ts segments of an
 * m3u8 playlist.
 *
 * @param baseDir The directory where the temp dir should be created (usually
 *                the user's selected download directory).
 * @param videoName The desired base name for the final output (used to name
 *                  the temp dir for debugging).
 * @returns An object containing:
 *          - tempDir: absolute path to the created directory.
 *          - segmentFiles: array of absolute paths that each segment will be
 *                          written to, in the same order as the input URLs.
 *            The file names are taken from the URL's pathname last segment
 *            (the basename). If two segments would have the same basename,
 *            they are disambiguated by appending `_2`, `_3`, etc. (this is
 *            unlikely for HLS but we handle it anyway).
 *          - urlToFileMap: a map from segment URL to its chosen file path.
 */
export function prepareM3u8TempDir(
  baseDir: string,
  videoName: string,
  segmentUrls: string[],
): {
  tempDir: string
  segmentFiles: string[]
  urlToFileMap: Map<string, string>
} {
  // Create a safe base name for the temp directory.
  const safeBase = getSafeM3u8OutName(videoName) || 'm3u8'
  // Add a short hash to avoid collisions.
  const hashArray = window.crypto.getRandomValues(new Uint8Array(4))
  const hash = Array.from(hashArray, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 8)
  const dirName = `${M3U8_TEMP_DIR_PREFIX}${safeBase}-${hash}`
  const tempDir = `${baseDir.endsWith('/') ? baseDir : baseDir + '/'}${dirName}`

  // We will write each segment to a file whose name is taken from the URL's
  // basename. If there are duplicates, we add a suffix.
  const segmentFiles: string[] = []
  const urlToFileMap = new Map<string, string>()
  const nameCount: Map<string, number> = new Map()

  for (const url of segmentUrls) {
    try {
      const pathname = new URL(url).pathname
      let fileName = pathname.split('/').pop() ?? 'segment'
      if (!fileName) fileName = 'segment'
      // Ensure the file has a .ts extension (HLS segments should, but we
      // don't require it; we will keep whatever the URL gives).
      // However, to avoid confusion we keep the original extension.
      // If the URL has no extension, we keep it as is (the user expects
      // the final output to be .mp4, but the segments remain as they are).
      // Count occurrences of this base name to disambiguate.
      const count = nameCount.get(fileName) ?? 0
      nameCount.set(fileName, count + 1)
      if (count > 0) {
        // Append _2, _3, etc. before the extension if any.
        const extIdx = fileName.lastIndexOf('.')
        if (extIdx > 0) {
          const namePart = fileName.substring(0, extIdx)
          const ext = fileName.substring(extIdx)
          fileName = `${namePart}_${count + 1}${ext}`
        } else {
          fileName = `${fileName}_${count + 1}`
        }
      }
      const filePath = `${tempDir}/${fileName}`
      segmentFiles.push(filePath)
      urlToFileMap.set(url, filePath)
    } catch {
      // If URL is malformed, fall back to a generic name.
      const count = nameCount.get('segment') ?? 0
      nameCount.set('segment', count + 1)
      const fileName = count === 0 ? 'segment' : `segment_${count + 1}`
      const filePath = `${tempDir}/${fileName}`
      segmentFiles.push(filePath)
      urlToFileMap.set(url, filePath)
    }
  }

  return { tempDir, segmentFiles, urlToFileMap }
}
