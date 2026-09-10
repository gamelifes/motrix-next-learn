/**
 * @fileoverview Composable encapsulating AddTask submission logic.
 *
 * Extracted from AddTask.vue to make the complex branching testable:
 * - Options building (headers, proxy, user-agent, etc.)
 * - Batch submission routing for torrent files
 * - Manual URI submission with multi-URI rename
 * - Error classification (engine-not-ready, duplicate, generic)
 */
import { ref } from 'vue'
import type { Ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useTaskStore } from '@/stores/task'
import { usePreferenceStore } from '@/stores/preference'
import { useAppMessage } from '@/composables/useAppMessage'
import { handleM3u8Failure, handleM3u8MergeComplete, handleTaskStart } from '@/composables/useTaskNotifyHandlers'
import { isEngineReady } from '@/api/aria2'
import {
  normalizeUriLines,
  extractDecodedFilename,
  extractMagnetDisplayName,
  hasExtension,
  sanitizeAria2OutHint,
} from '@shared/utils/batchHelpers'
import { buildOuts } from '@shared/utils/rename'
import { invoke } from '@tauri-apps/api/core'
import { formatLogFields, logger } from '@shared/logger'
import type {
  Aria2EngineOptions,
  AppConfig,
  BatchItem,
  BrowserRequestHeader,
  ExternalDownloadContext,
  FileCategory,
  ProxyConfig,
  SegmentStatus,
} from '@shared/types'
import { isMagnetUri } from '@/composables/useMagnetFlow'
import {
  sanitizeBrowserRequestHeaders,
  sanitizeBrowserRequestHeadersWithDiagnostics,
  sanitizeHttpHeaderOptions,
  sanitizeSingleHeaderValue,
} from '@shared/utils/headerSanitize'
import { summarizeHeaderForwarding } from '@shared/utils/externalInputDiagnostics'
import { getErrorMessage } from '@shared/utils/errorMessage'
import { buildTaskProxyOptions, getDownloadProxy, type TaskProxyMode } from '@shared/utils/proxyPolicy'
import { resolveUserAgentFromContext } from '@shared/utils/userAgentPolicy'
import { DEFAULT_APP_CONFIG as D } from '@shared/constants'

export { getDownloadProxy } from '@shared/utils/proxyPolicy'
import { useM3u8GroupStore } from '@/stores/task/m3u8Group'
import { parseM3U8Playlist, inspectM3u8Playlist, prepareM3u8TempDir } from '@/shared/utils/m3u8Parser'

export interface AddTaskForm {
  uris: string
  out: string
  dir: string
  split: number
  userAgent: string
  authorization: string
  httpAuthUsername: string
  httpAuthPassword: string
  saveHttpAuth: boolean
  referer: string
  cookie: string
  /** Proxy mode for this task. */
  proxyMode: TaskProxyMode
  /** User-entered proxy address when proxyMode is 'manual'. */
  customProxy: string
  customProxyUsername?: string
  customProxyPassword?: string
  /** Injected from the preference store; used for manual proxy bypass inheritance. */
  appProxy?: ProxyConfig
  defaultUserAgent?: string
  userAgentProfiles?: import('@shared/types').UserAgentProfile[]
  userAgentRules?: import('@shared/types').UserAgentRule[]
  requestHeaders: BrowserRequestHeader[]
  uriRequestContexts?: Record<string, ExternalDownloadContext>
}

export interface UseAddTaskSubmitOptions {
  form: Ref<AddTaskForm>
  onClose: () => void
}

export interface MagnetSubmitFailure {
  uri: string
  error: string
}

export interface ManualUriSubmitResult {
  submittedTaskNames: string[]
  magnetGids: string[]
  magnetFailures: MagnetSubmitFailure[]
  /** m3u8 playlists whose segments were downloaded and merged into a file. */
  m3u8Merged?: M3u8MergeResult[]
}

/** A completed m3u8 playlist: the merged output name and its absolute path. */
export interface M3u8MergeResult {
  taskName: string
  outputPath: string
}

/** Maps m3u8 failure reason codes to i18n keys (localized at the call site). */
const M3U8_FAILURE_REASON_KEYS: Record<string, string> = {
  'max-retries': 'task.m3u8-max-retries',
  'merge-failed': 'task.m3u8-merge-failed',
  'master-playlist': 'task.m3u8-master-playlist',
  'live-stream': 'task.m3u8-live-stream',
}

/**
 * Error thrown when an m3u8 playlist permanently fails — segments exhausted
 * their retries or the ffmpeg merge failed. The caller reports it as a single
 * group-level failure notification instead of a generic submission error.
 */
export class M3u8SubmitFailure extends Error {
  readonly taskName: string
  readonly reasonCode: string
  /** Optional concrete cause (e.g. the ffmpeg/Rust error) shown after the localized reason. */
  readonly detail?: string

  constructor(taskName: string, reasonCode: string, detail?: string) {
    super(`M3U8 download failed: ${taskName} (${reasonCode})`)
    this.name = 'M3u8SubmitFailure'
    this.taskName = taskName
    this.reasonCode = reasonCode
    if (detail) this.detail = detail
  }

  /** Returns the localized failure reason text for this error. */
  reasonText(t: (key: string) => string): string {
    const reason = t(M3U8_FAILURE_REASON_KEYS[this.reasonCode] ?? 'task.m3u8-max-retries')
    return this.detail ? `${reason}: ${this.detail}` : reason
  }
}

/**
 * Builds aria2 engine options from the add-task form.
 * Pure function — no side effects, fully testable.
 */
export function buildEngineOptions(form: AddTaskForm, context?: ExternalDownloadContext): Aria2EngineOptions {
  const resolvedUserAgent = resolveUserAgentFromContext({
    formUserAgent: form.userAgent,
    context,
    url: context?.url ?? form.uris,
    finalUrl: context?.finalUrl,
    defaultUserAgent: form.defaultUserAgent,
    profiles: form.userAgentProfiles ?? [],
    rules: form.userAgentRules ?? [],
  }).userAgent
  const headers = {
    userAgent: sanitizeSingleHeaderValue(resolvedUserAgent),
    referer: sanitizeSingleHeaderValue(context?.referer ?? form.referer),
    cookie: sanitizeSingleHeaderValue(context?.cookie ?? form.cookie),
    authorization: sanitizeSingleHeaderValue(form.authorization),
  }
  const options: Aria2EngineOptions = {
    dir: form.dir,
    split: String(form.split),
    // max-connection-per-server is intentionally NOT set per-task.
    // It uses the global value pushed by on_engine_ready() (Rust), allowing
    // split (segment count) and max-conn (server connection cap) to be
    // controlled independently. See: aria2 download_helper.cc:394-401.
  }
  if (form.out) options.out = form.out
  if (headers.userAgent) options['user-agent'] = headers.userAgent
  if (headers.referer) options.referer = headers.referer

  const browserHeaders = sanitizeBrowserRequestHeaders(context?.requestHeaders ?? form.requestHeaders)
  const headerLines: string[] = browserHeaders.map((header) => `${header.name}: ${header.value}`)
  if (headers.cookie) headerLines.push(`Cookie: ${headers.cookie}`)
  if (headers.authorization) headerLines.push(`Authorization: ${headers.authorization}`)
  if (headerLines.length > 0) options.header = headerLines

  const httpAuthUsername = sanitizeHttpHeaderOptions({ authorization: form.httpAuthUsername }).authorization ?? ''
  const httpAuthPassword = sanitizeHttpHeaderOptions({ authorization: form.httpAuthPassword }).authorization ?? ''
  if (httpAuthUsername) {
    options['http-user'] = httpAuthUsername
    options['http-passwd'] = httpAuthPassword
  }

  Object.assign(
    options,
    buildTaskProxyOptions(
      form.proxyMode,
      form.customProxy,
      form.appProxy,
      form.customProxyUsername,
      form.customProxyPassword,
    ),
  )
  return options
}

function summarizeSubmitHeaderForwarding(form: AddTaskForm, context?: ExternalDownloadContext) {
  return summarizeHeaderForwarding(
    sanitizeBrowserRequestHeadersWithDiagnostics(context?.requestHeaders ?? form.requestHeaders).diagnostics,
  )
}

/**
 * Classifies an error from task submission into a user-friendly category.
 * Pure function — fully testable.
 */
export function classifySubmitError(err: unknown): 'engine-not-ready' | 'duplicate' | 'generic' {
  const msg = getErrorMessage(err)
  if (msg.includes('not initialized') || !isEngineReady()) return 'engine-not-ready'
  if (/duplicate|already/i.test(msg)) return 'duplicate'
  return 'generic'
}

/** Runtime tuning values for m3u8 segment download, resolved with defaults. */
export interface M3u8RuntimeConfig {
  /** Max automatic re-queues per failed segment (0 = no retries). */
  maxRetries: number
  /** Seconds to wait before re-queuing failed segments. */
  retryDelaySec: number
  /** Per-segment download timeout in seconds (0 = disabled). */
  segmentTimeoutSec: number
  /** Parallel segment submissions for one playlist. */
  concurrency: number
  /** Remove the temporary segment dir after a successful merge. */
  autoCleanup: boolean
}

/**
 * Resolves the m3u8 runtime tuning values from the app config, falling back
 * to DEFAULT_APP_CONFIG so callers never see undefined even for old saved
 * configs. Pure function — fully testable.
 */
export function resolveM3u8RuntimeConfig(config: AppConfig): M3u8RuntimeConfig {
  return {
    maxRetries: config.m3u8MaxRetries ?? D.m3u8MaxRetries,
    retryDelaySec: config.m3u8RetryDelaySec ?? D.m3u8RetryDelaySec,
    segmentTimeoutSec: config.m3u8SegmentTimeoutSec ?? D.m3u8SegmentTimeoutSec,
    concurrency: config.m3u8Concurrency ?? D.m3u8Concurrency,
    autoCleanup: config.m3u8AutoCleanup ?? D.m3u8AutoCleanup,
  }
}

/**
 * Runs `fn` over `items` with at most `limit` concurrent invocations.
 * Pure — no globals, fully testable. Used to cap segment submissions in
 * parallel so large playlists do not flood the IPC bridge.
 */
export async function runWithConcurrency<T>(
  limit: number,
  items: readonly T[],
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const safeLimit = Math.max(1, Math.floor(limit))
  let cursor = 0
  const workerCount = Math.min(safeLimit, items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      await fn(items[index], index)
    }
  })
  await Promise.all(workers)
}

/**
 * Submits file-based torrent batch items to the engine.
 * Mutates item.status in place; returns count of failures.
 */
export async function submitBatchItems(
  items: BatchItem[],
  options: Aria2EngineOptions,
  taskStore: ReturnType<typeof useTaskStore>,
): Promise<number> {
  let failures = 0
  for (const item of items) {
    if (item.kind === 'uri') continue
    if (item.status !== 'pending' && item.status !== 'failed') continue
    try {
      if (item.kind === 'torrent') {
        const opts: Aria2EngineOptions = { ...options }
        delete opts.out
        if (
          item.selectedFileIndices &&
          item.torrentMeta &&
          item.selectedFileIndices.length > 0 &&
          item.selectedFileIndices.length < item.torrentMeta.files.length
        ) {
          opts['select-file'] = item.selectedFileIndices.join(',')
        }
        // Register source path by infoHash BEFORE addTorrent to avoid race:
        // fast downloads enter seeding before addTorrent promise resolves.
        if (item.source && item.torrentMeta?.infoHash) {
          taskStore.registerTorrentSource(item.torrentMeta.infoHash, item.source)
        }
        await taskStore.addTorrent({ torrent: item.payload, options: opts })
      }
      item.status = 'submitted'
      logger.info('submitBatchItems', `${item.kind} submitted: ${item.displayName}`)
    } catch (e) {
      item.status = 'failed'
      item.error = getErrorMessage(e)
      logger.error('submitBatchItems', e)
      failures++
    }
  }
  return failures
}

/**
 * Submits manually entered URIs from the textarea.
 * Handles multi-URI rename with buildOuts.
 *
 * Magnet URIs are separated and submitted via addMagnetUri (metadata-only mode).
 * Returns an array of magnet GIDs for the caller to monitor for file selection.
 */
export async function submitManualUris(
  form: AddTaskForm,
  options: Aria2EngineOptions,
  taskStore: ReturnType<typeof useTaskStore>,
  fileCategory?: { enabled: boolean; categories: FileCategory[] },
  downloadProxy?: string,
): Promise<ManualUriSubmitResult> {
  if (!form.uris.trim()) return { submittedTaskNames: [], magnetGids: [], magnetFailures: [] }
  const allUris = normalizeUriLines(form.uris)
  const preferenceStore = usePreferenceStore()
  logger.info(
    'submitManualUris',
    formatLogFields({
      regular: allUris.filter((u) => !isMagnetUri(u) && !u.toLowerCase().endsWith('.m3u8')).length,
      magnet: allUris.filter(isMagnetUri).length,
      m3u8: allUris.filter((uri) => uri.toLowerCase().endsWith('.m3u8')).length,
      hasUserAgent: Boolean(form.userAgent),
      hasReferer: Boolean(form.referer),
      hasCookie: Boolean(form.cookie),
      ...summarizeSubmitHeaderForwarding(form),
    }),
  )

  const magnetUris = allUris.filter(isMagnetUri)
  const m3u8Uris = allUris.filter((uri) => uri.toLowerCase().endsWith('.m3u8'))
  const regularUris = allUris.filter((uri) => !isMagnetUri(uri) && !uri.toLowerCase().endsWith('.m3u8'))
  const fileCategoryWithContexts = fileCategory
    ? { ...fileCategory, contexts: form.uriRequestContexts ?? {} }
    : undefined
  const submittedTaskNames: string[] = []
  const m3u8Merged: M3u8MergeResult[] = []

  // Submit regular URIs using the existing path
  if (regularUris.length > 0) {
    if (regularUris.length > 1 && form.out) {
      const regularOptions = { ...options }
      delete regularOptions.out
      let outs = buildOuts(regularUris, form.out)
      if (outs.length === 0) {
        const dotIdx = form.out.lastIndexOf('.')
        const base = dotIdx > 0 ? form.out.substring(0, dotIdx) : form.out
        const ext = dotIdx > 0 ? form.out.substring(dotIdx) : ''
        outs = regularUris.map((_, i) => `${base}_${i + 1}${ext}`)
      }
      await taskStore.addUri({
        uris: regularUris,
        outs,
        options: regularOptions,
        fileCategory: fileCategoryWithContexts,
      })
      submittedTaskNames.push(...regularUris.map((uri, index) => resolveSubmittedTaskName(uri, outs[index])))
    } else {
      // aria2's native filename resolution only uses Content-Disposition
      // and URL path.  CDNs like Twitter/X serve media from extensionless
      // paths (e.g. /media/HCo_0zsbkAEov7s?format=jpg).  For each URL
      // whose path lacks an extension, invoke the Rust-side HEAD request
      // to infer the correct name via Content-Type MIME mapping.
      const outs = await Promise.all(
        regularUris.map(async (uri) => {
          // Extension already provided a filename via options.out — skip HEAD.
          // Without this guard, resolve_filename returns a name derived from
          // the CDN's Content-Type (e.g. .xml), and aria2.ts addUri() L108
          // overwrites options.out with the outs[] entry.
          if (options.out) return ''
          const pathFilename = extractDecodedFilename(uri)
          if (!pathFilename || hasExtension(pathFilename)) return ''
          try {
            const uriContext = form.uriRequestContexts?.[uri]
            const sanitizedHeaders = sanitizeHttpHeaderOptions({
              referer: uriContext?.referer ?? form.referer,
              cookie: uriContext?.cookie ?? form.cookie,
            })
            const args: {
              url: string
              proxy: string | null
              referer?: string
              cookie?: string
            } = {
              url: uri,
              proxy: downloadProxy ?? null,
            }
            if (sanitizedHeaders.referer) args.referer = sanitizedHeaders.referer
            if (sanitizedHeaders.cookie) args.cookie = sanitizedHeaders.cookie
            return (await invoke<string | null>('resolve_filename', args)) ?? ''
          } catch {
            return '' // HEAD failure → graceful degradation
          }
        }),
      )
      const contextEntries = form.uriRequestContexts ?? {}
      const hasPerUriContext = regularUris.some((uri) => contextEntries[uri])
      if (hasPerUriContext) {
        for (let index = 0; index < regularUris.length; index++) {
          const uri = regularUris[index]
          await taskStore.addUri({
            uris: [uri],
            outs: [outs[index] ?? ''],
            options: buildEngineOptions(form, contextEntries[uri]),
            fileCategory: fileCategoryWithContexts,
          })
        }
      } else {
        await taskStore.addUri({ uris: regularUris, outs, options, fileCategory: fileCategoryWithContexts })
      }
      const optionOut = typeof options.out === 'string' ? options.out : ''
      submittedTaskNames.push(
        ...regularUris.map((uri, index) => resolveSubmittedTaskName(uri, optionOut || outs[index])),
      )
    }
  }

  // Submit m3u8 URIs (special handling for HLS streams)
  if (m3u8Uris.length > 0) {
    // Resolve once per submission batch — the store config is hydrated and
    // stable for the duration of this request.
    const m3u8Runtime = resolveM3u8RuntimeConfig(preferenceStore.config)
    for (const uri of m3u8Uris) {
      try {
        // For m3u8 URLs, we'll download the playlist and submit all .ts segments via aria2, then merge via ffmpeg
        const responseBytes: number[] = await invoke<number[]>('fetch_remote_bytes', {
          url: uri,
          proxy: getDownloadProxy(preferenceStore.config.proxy),
          referer: form.referer,
          cookie: form.cookie,
          userAgent: form.userAgent,
          requestHeaders: form.requestHeaders,
        })
        const playlistContent = new TextDecoder().decode(Uint8Array.from(responseBytes))

        // Classify the playlist before downloading anything so unsupported
        // HLS variants (multi-variant master playlists, live/event streams)
        // fail fast with a descriptive group-level error instead of polluting
        // the task list with manifest downloads that can never merge.
        const outHint = form.out || extractDecodedFilename(uri) || 'video'
        const baseName = outHint.replace(/\.[^/.]+$/, '') // Remove extension if present
        const playlistInfo = inspectM3u8Playlist(playlistContent)

        if (playlistInfo.kind === 'master') {
          throw new M3u8SubmitFailure(baseName, 'master-playlist')
        }
        if (playlistInfo.kind === 'live' || playlistInfo.kind === 'event') {
          throw new M3u8SubmitFailure(baseName, 'live-stream')
        }

        // Resolve ffmpeg BEFORE spending bandwidth on segments. The merge step
        // cannot succeed without an executable ffmpeg, so an unset or broken
        // path should fail fast with the concrete reason instead of surfacing a
        // generic "FFmpeg merge failed" after every segment has downloaded.
        const ffmpegPath = (preferenceStore.config.ffmpegPath ?? '').trim()
        if (!ffmpegPath) {
          throw new M3u8SubmitFailure(
            baseName,
            'merge-failed',
            'no ffmpeg configured — set a valid ffmpeg path in Preferences → Advanced first',
          )
        }
        try {
          await invoke<{ versionLine: string }>('check_ffmpeg', { path: ffmpegPath })
        } catch (probeError) {
          throw new M3u8SubmitFailure(baseName, 'merge-failed', `ffmpeg check failed: ${getErrorMessage(probeError)}`)
        }

        // Parse the m3u8 playlist to extract .ts segment URLs
        const tsUris = parseM3U8Playlist(playlistContent, uri)

        if (tsUris.length === 0) {
          throw new Error('No .ts segments found in m3u8 playlist')
        }

        // Prepare temporary directory and segment file mapping
        const tempDirResult = await prepareM3u8TempDir(form.dir, baseName, tsUris)
        const { tempDir, segmentFiles } = tempDirResult

        // Create a new m3u8 group
        const m3u8GroupStore = useM3u8GroupStore()
        const mergedFilePath = `${form.dir}/${baseName}.mp4`
        const groupId = m3u8GroupStore.createGroup({
          videoName: baseName,
          finalPath: mergedFilePath,
          tempDir,
          ffmpegPath,
          segmentUrls: tsUris,
        })

        // Submit each .ts segment via aria2 (one addUri call per segment).
        // Submission is rate-limited to m3u8Runtime.concurrency in parallel so
        // very large playlists do not flood the IPC bridge in one burst.
        const segmentGids: string[] = []
        await runWithConcurrency(m3u8Runtime.concurrency, tsUris, async (segUri, i) => {
          const outFilename = segmentFiles[i] // e.g., "0000.ts"
          const gids = await taskStore.addUri({
            uris: [segUri],
            outs: [outFilename],
            options: {
              ...buildEngineOptions(form),
              dir: tempDir,
              'auto-file-renaming': 'false', // Keep filename as provided
            },
            fileCategory: {
              enabled: preferenceStore.config.fileCategoryEnabled,
              categories: preferenceStore.config.fileCategories,
            },
          })
          const gid = gids[0] ?? ''
          segmentGids[i] = gid
          // Register segment with the group store
          m3u8GroupStore.registerSegment(groupId, i, gid, outFilename)
        })

        // Wait for all segments to complete (or fail), bounded by the
        // configured per-segment timeout watchdog.
        await waitForSegmentsCompletion(
          segmentGids,
          taskStore,
          m3u8GroupStore,
          groupId,
          undefined,
          m3u8Runtime.segmentTimeoutSec > 0 ? m3u8Runtime.segmentTimeoutSec * 1000 : 0,
        )

        // Check if any segment failed
        if (m3u8GroupStore.hasAnyFailed(groupId)) {
          const group = m3u8GroupStore.getGroup(groupId)!
          // Check if any failed segments have retries remaining
          const failedSegmentsWithRetries = group.segments.filter(
            (seg) => seg.status === 'failed' && seg.retryCount < m3u8Runtime.maxRetries,
          )

          if (failedSegmentsWithRetries.length > 0) {
            // Some segments failed but have retries available
            // Set group status to partial to indicate retry is possible
            m3u8GroupStore.setGroupStatus(groupId, 'partial')
            // Return special result to indicate retry is needed
            // The frontend should show retry UI for failed segments
            throw new Error(
              `RETRY_NEEDED:${JSON.stringify({
                groupId,
                failedSegments: failedSegmentsWithRetries.map((seg) => ({
                  index: seg.index,
                  url: seg.url,
                  retryCount: seg.retryCount,
                  maxRetries: m3u8Runtime.maxRetries,
                })),
              })}`,
            )
          } else {
            // All failed segments have exhausted retries
            m3u8GroupStore.setGroupStatus(groupId, 'failed')
            throw new M3u8SubmitFailure(baseName, 'max-retries')
          }
        }

        // All segments completed successfully, proceed to merge
        m3u8GroupStore.setGroupStatus(groupId, 'merging')
        const mergedFileName = `${baseName}.mp4` // Output as MP4

        try {
          // Invoke ffmpeg merge command. The Rust signature takes the whole
          // payload as a single `params` struct — Tauri requires the key, not
          // the fields spread at the top level.
          await invoke('merge_m3u8_segments', {
            params: {
              tempDir,
              finalPath: mergedFilePath,
              ffmpegPath,
              cleanup: m3u8Runtime.autoCleanup,
            },
          })
        } catch (error) {
          logger.error('submitManualUris.m3u8.merge', error)
          throw new M3u8SubmitFailure(baseName, 'merge-failed', getErrorMessage(error))
        }

        // Mark the group complete so the aggregated main-task row persists in
        // the list (Segments tab stays accessible for the finished download).
        m3u8GroupStore.setCompleted(groupId)

        // Report the merged output as a single group-level completion. The
        // caller fires one toast + native notification per playlist — the
        // per-segment aria2 tasks are suppressed in both the frontend
        // notifier and the Rust task monitor.
        m3u8Merged.push({ taskName: mergedFileName, outputPath: mergedFilePath })
      } catch (e) {
        logger.error('submitManualUris.m3u8', e)
        throw e
      }
    }
  }

  // Submit magnet URIs (normal mode — global pause-metadata controls pausing)
  const result: ManualUriSubmitResult = {
    submittedTaskNames,
    magnetGids: [],
    magnetFailures: [],
    m3u8Merged,
  }
  for (const uri of magnetUris) {
    try {
      const gid = await taskStore.addMagnetUri({ uri, options })
      result.magnetGids.push(gid)
    } catch (e) {
      logger.error('submitManualUris.magnet', e)
      result.magnetFailures.push({
        uri,
        error: getErrorMessage(e),
      })
    }
  }

  return result
}

function resolveSubmittedTaskName(uri: string, outHint?: string): string {
  const out = outHint ? sanitizeAria2OutHint(outHint) : ''
  return out || extractDecodedFilename(uri) || uri
}

function buildSubmitErrorLabels(t: (key: string) => string): Parameters<typeof getErrorMessage>[1] {
  return {
    fallback: t('task.error-unknown'),
    labels: { Aria2: t('task.error-aria2-next') },
  }
}

export function useAddTaskSubmit({ form, onClose }: UseAddTaskSubmitOptions) {
  const { t } = useI18n()
  const router = useRouter()
  const appStore = useAppStore()
  const taskStore = useTaskStore()
  const preferenceStore = usePreferenceStore()
  const message = useAppMessage()
  const submitting = ref(false)

  async function handleSubmit() {
    if (submitting.value) return
    submitting.value = true

    try {
      const options = buildEngineOptions(form.value)
      const batch = appStore.pendingBatch
      let manualResult: ManualUriSubmitResult = { submittedTaskNames: [], magnetGids: [], magnetFailures: [] }

      if (batch.length > 0) {
        await submitBatchItems(batch, options, taskStore)
      }
      if (form.value.uris.trim()) {
        manualResult = await submitManualUris(
          form.value,
          options,
          taskStore,
          {
            enabled: preferenceStore.config.fileCategoryEnabled,
            categories: preferenceStore.config.fileCategories,
          },
          getDownloadProxy(preferenceStore.config.proxy),
        )
        // pendingMagnetGids is set directly inside addMagnetUri (task store)
      }

      // Fire one completion notification per merged m3u8 playlist. Per-segment
      // notifications are suppressed in the frontend notifier and the Rust
      // task monitor; the merged output file is reported only here.
      for (const merged of manualResult.m3u8Merged ?? []) {
        handleM3u8MergeComplete(merged.taskName, merged.outputPath, {
          messageSuccess: message.success,
          messageError: message.error,
          t,
        })
      }

      const failedCount = batch.filter((i) => i.status === 'failed').length + manualResult.magnetFailures.length
      logger.info(
        'AddTask.submit',
        `batch=${batch.length} manual=${normalizeUriLines(form.value.uris).length} failed=${failedCount}`,
      )
      if (failedCount > 0) {
        message.warning(`${failedCount} ${t('task.failed') || 'failed'}`, { closable: true })
      } else {
        onClose()

        // ── Start notification (aggregated) ──────────────────────
        const taskNames: string[] = []
        for (const item of batch) {
          if (item.status === 'submitted') {
            taskNames.push(item.displayName)
          }
        }
        taskNames.push(...manualResult.submittedTaskNames)
        const allUris = normalizeUriLines(form.value.uris)
        const magnetUris = allUris.filter(isMagnetUri)
        for (let i = 0; i < manualResult.magnetGids.length; i++) {
          const dn = magnetUris[i] ? extractMagnetDisplayName(magnetUris[i]) : ''
          taskNames.push(dn || t('task.magnet-task'))
        }
        handleTaskStart(taskNames, {
          messageInfo: message.info,
          t,
        })

        if (preferenceStore.config.newTaskShowDownloading !== false) {
          router.push({ path: '/task/all' }).catch(() => {})
        }
      }
    } catch (e: unknown) {
      // Permanent m3u8 failure (segments exhausted retries or ffmpeg merge
      // failed) — report as a single group-level failure notification.
      if (e instanceof M3u8SubmitFailure) {
        handleM3u8Failure(e.taskName, e.reasonText(t), {
          messageSuccess: message.success,
          messageError: message.error,
          t,
        })
        return
      }
      // Check for special RETRY_NEEDED error from m3u8 segment handling
      if (e instanceof Error && e.message.startsWith('RETRY_NEEDED:')) {
        try {
          const retryData = JSON.parse(e.message.substring('RETRY_NEEDED:'.length))
          const { groupId, failedSegments } = retryData

          // Show info to user about retrying failed segments
          message.info(t('task.m3u8-retry-message', { count: failedSegments.length }), {
            closable: true,
            duration: 3000,
          })

          // Retry the failed segments
          const m3u8GroupStore = useM3u8GroupStore()
          const taskStore = useTaskStore()
          const preferenceStore = usePreferenceStore()
          const m3u8Runtime = resolveM3u8RuntimeConfig(preferenceStore.config)

          // Wait the configured retry delay before re-queuing
          await new Promise((resolve) => setTimeout(resolve, m3u8Runtime.retryDelaySec * 1000))

          // Get the group to access segment info
          const group = m3u8GroupStore.getGroup(groupId)
          if (!group) {
            throw new Error('M3u8 group not found for retry')
          }

          // Reset group status to downloading for retry
          m3u8GroupStore.setGroupStatus(groupId, 'downloading')

          // Submit retry tasks for failed segments. `retrySegment()` bumps the
          // per-segment retry counter and reports whether the attempt is still
          // allowed — without this the RETRY_NEEDED loop would re-submit a
          // permanently failed segment forever.
          const retrySegmentGids: string[] = []
          for (const segInfo of failedSegments) {
            const segIndex = segInfo.index
            const seg = group.segments[segIndex]
            if (!seg) continue

            const retry = m3u8GroupStore.retrySegment(groupId, segIndex, m3u8Runtime.maxRetries)
            if (!retry || !retry.canRetry) continue

            const outFilename = retry.filePath.split('/').pop() || `segment_${String(segIndex).padStart(4, '0')}.ts`

            const retryGids = await taskStore.addUri({
              uris: [retry.url],
              outs: [outFilename],
              options: {
                ...buildEngineOptions(form.value),
                dir: group.tempDir,
                'auto-file-renaming': 'false',
              },
              fileCategory: {
                enabled: preferenceStore.config.fileCategoryEnabled,
                categories: preferenceStore.config.fileCategories,
              },
            })
            const gid = retryGids[0] ?? ''

            retrySegmentGids.push(gid)
            // Register the new GID for this segment
            m3u8GroupStore.registerSegment(groupId, segIndex, gid, outFilename)
          }

          // Wait for retry segments to complete
          await waitForSegmentsCompletion(
            retrySegmentGids,
            taskStore,
            m3u8GroupStore,
            groupId,
            undefined,
            m3u8Runtime.segmentTimeoutSec > 0 ? m3u8Runtime.segmentTimeoutSec * 1000 : 0,
          )

          // Check if any segment failed after retry
          if (m3u8GroupStore.hasAnyFailed(groupId)) {
            const retryGroup = m3u8GroupStore.getGroup(groupId)!
            // Check if any failed segments still have retries remaining
            const stillFailedSegmentsWithRetries = retryGroup.segments.filter(
              (seg) => seg.status === 'failed' && seg.retryCount < m3u8Runtime.maxRetries,
            )

            if (stillFailedSegmentsWithRetries.length > 0) {
              // Still have retries available, set to partial for UI to handle
              m3u8GroupStore.setGroupStatus(groupId, 'partial')
              throw new Error(
                `RETRY_NEEDED:${JSON.stringify({
                  groupId,
                  failedSegments: stillFailedSegmentsWithRetries.map((seg) => ({
                    index: seg.index,
                    url: seg.url,
                    retryCount: seg.retryCount,
                    maxRetries: m3u8Runtime.maxRetries,
                  })),
                })}`,
              )
            } else {
              // No more retries available
              m3u8GroupStore.setGroupStatus(groupId, 'failed')
              throw new M3u8SubmitFailure(retryGroup.videoName, 'max-retries')
            }
          }

          // All segments completed successfully after retry, proceed to merge
          m3u8GroupStore.setGroupStatus(groupId, 'merging')
          const retryGroup = m3u8GroupStore.getGroup(groupId)!
          const mergedFileName = `${retryGroup.videoName}.mp4` // Output as MP4
          const mergedFilePath = retryGroup.finalPath

          try {
            // Invoke ffmpeg merge command. The Rust signature takes the whole
            // payload as a single `params` struct — Tauri requires the key, not
            // the fields spread at the top level.
            await invoke('merge_m3u8_segments', {
              params: {
                tempDir: retryGroup.tempDir,
                finalPath: mergedFilePath,
                ffmpegPath: preferenceStore.config.ffmpegPath,
                cleanup: m3u8Runtime.autoCleanup,
              },
            })
          } catch (mergeError) {
            logger.error('AddTask.submit.m3u8retry.merge', mergeError)
            throw new M3u8SubmitFailure(retryGroup.videoName, 'merge-failed', getErrorMessage(mergeError))
          }

          // Mark the group complete so the aggregated main-task row persists in
          // the list (Segments tab stays accessible for the finished download).
          m3u8GroupStore.setCompleted(groupId)

          // Group-level completion notification for the merged playlist
          handleM3u8MergeComplete(mergedFileName, mergedFilePath, {
            messageSuccess: message.success,
            messageError: message.error,
            t,
          })
        } catch (retryError) {
          // If retry fails, fall through to normal error handling
          logger.error('AddTask.submit.m3u8retry', retryError)
          throw retryError
        }
      } else {
        // Normal error handling
        const category = classifySubmitError(e)
        const errMsg = getErrorMessage(e, buildSubmitErrorLabels(t))
        logger.error('AddTask.submit', e)
        if (category === 'engine-not-ready') {
          message.error(t('app.engine-not-ready'), { closable: true })
        } else if (category === 'duplicate') {
          message.warning(errMsg, { closable: true })
        } else {
          message.error(errMsg, { closable: true })
        }
      }
    } finally {
      submitting.value = false
    }
  }

  return { submitting, handleSubmit }
}

/**
 * Waits for all segments in an m3u8 group to reach a terminal state (completed or failed).
 * Polls the task store for status updates at the specified interval.
 *
 * @param segmentGids Array of aria2 GIDs for the segment download tasks
 * @param taskStore The task store instance
 * @param m3u8GroupStore The m3u8 group store instance
 * @param groupId The ID of the m3u8 group
 * @param pollIntervalMs Interval between status checks in milliseconds (default: 1000)
 * @returns Promise that resolves when all segments are completed or failed
 */
async function waitForSegmentsCompletion(
  segmentGids: string[],
  taskStore: ReturnType<typeof useTaskStore>,
  m3u8GroupStore: ReturnType<typeof useM3u8GroupStore>,
  groupId: string,
  pollIntervalMs: number = 1000,
  timeoutMs: number = 0,
): Promise<void> {
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0
  while (true) {
    // Check if all segments have reached terminal state
    const allTerminal = await Promise.all(
      segmentGids.map(async (gid) => {
        try {
          const task = await taskStore.fetchTaskStatus(gid)
          // Update segment status in the store based on aria2 task status
          if (task) {
            let status: SegmentStatus['status'] = 'pending'
            switch (task.status) {
              case 'active':
              case 'waiting':
              case 'paused':
                status = 'downloading'
                break
              case 'complete':
                status = 'completed'
                break
              case 'error':

              case 'removed':
                status = 'failed'
                break
            }
            m3u8GroupStore.updateSegmentStatus(
              groupId,
              gid,
              status,
              Number(task.completedLength),
              Number(task.totalLength),
              task.status === 'error' ? Number(task.errorCode || 0) : undefined,
            )
          }
          // Return true if task is in terminal state
          return ['complete', 'error', 'removed'].includes(task?.status || '')
        } catch (error) {
          // If we can't fetch the task, consider it failed to avoid hanging
          logger.error('waitForSegmentsCompletion', error)
          return true
        }
      }),
    )

    if (allTerminal.every(Boolean)) {
      // All segments have reached terminal state
      break
    }

    // Enforce the per-segment timeout watchdog. When a playlist stalls (e.g.
    // a segment URL goes silent), mark the still-running tasks failed so the
    // caller's retry path can re-queue them, and remove the stalled aria2
    // tasks to avoid orphaned downloads. timeoutMs <= 0 disables the watchdog.
    if (deadline > 0 && Date.now() >= deadline) {
      logger.warn('waitForSegmentsCompletion', `timeout exceeded groupId=${groupId}`)
      for (const gid of segmentGids) {
        const task = await taskStore.fetchTaskStatus(gid)
        if (task && !['complete', 'error', 'removed'].includes(task.status)) {
          const localTask = taskStore.taskList.find((item) => item.gid === gid)
          if (localTask) {
            await taskStore.removeTask(localTask).catch((error) => {
              logger.error('waitForSegmentsCompletion.removeTask', error)
            })
          }
          m3u8GroupStore.updateSegmentStatus(groupId, gid, 'failed', 0, 0)
        }
      }
      break
    }

    // Wait before next check
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}
