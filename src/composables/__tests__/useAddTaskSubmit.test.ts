/**
 * @fileoverview Tests for the extracted AddTask submission logic.
 *
 * Tests REAL pure functions without mocking them:
 * - buildEngineOptions: form → aria2 options conversion
 * - classifySubmitError: error categorization
 * - submitBatchItems: batch routing to torrent store
 * - submitManualUris: multi-URI handling with rename
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// ── Mock external dependencies ──────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params?.taskName ? `${key}:${params.taskName}` : key),
  }),
}))

const mockRouterPush = vi.fn().mockResolvedValue(undefined)
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock('naive-ui', () => ({
  useMessage: () => ({
    success: vi.fn(() => ({ destroy: vi.fn() })),
    error: vi.fn(() => ({ destroy: vi.fn() })),
    warning: vi.fn(() => ({ destroy: vi.fn() })),
    info: vi.fn(() => ({ destroy: vi.fn() })),
  }),
}))

// Mock isEngineReady for classifySubmitError tests
const mockIsEngineReady = vi.fn().mockReturnValue(true)
vi.mock('@/api/aria2', () => ({
  isEngineReady: () => mockIsEngineReady(),
}))

const mockAppStore = {
  pendingBatch: [] as BatchItem[],
}

const mockTaskStoreForHook = {
  addUri: vi.fn().mockResolvedValue(['gid1']),
  addMagnetUri: vi.fn().mockResolvedValue('magnet-gid'),
  addTorrent: vi.fn(),
  registerTorrentSource: vi.fn(),
}

const mockPreferenceStore = {
  config: {
    newTaskShowDownloading: true,
    proxy: { mode: 'direct', server: '', scope: [], bypass: '' },
    fileCategoryEnabled: false,
    fileCategories: [],
    ffmpegPath: '/usr/local/bin/ffmpeg',
    m3u8MaxRetries: 5,
    m3u8RetryDelaySec: 3,
    m3u8SegmentTimeoutSec: 300,
    m3u8Concurrency: 6,
    m3u8AutoCleanup: true,
  },
}

const mockMessage = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}

vi.mock('@/stores/app', () => ({
  useAppStore: () => mockAppStore,
}))

vi.mock('@/stores/task', () => ({
  useTaskStore: () => mockTaskStoreForHook,
}))

vi.mock('@/stores/preference', () => ({
  usePreferenceStore: () => mockPreferenceStore,
}))

vi.mock('@/composables/useAppMessage', () => ({
  useAppMessage: () => mockMessage,
}))

import {
  buildEngineOptions,
  classifySubmitError,
  submitBatchItems,
  submitManualUris,
  useAddTaskSubmit,
  M3u8SubmitFailure,
  resolveM3u8RuntimeConfig,
  runWithConcurrency,
  type AddTaskForm,
} from '../useAddTaskSubmit'
import type { BatchItem, Aria2EngineOptions, AppConfig } from '@shared/types'
import { DEFAULT_APP_CONFIG as D } from '@shared/constants'

// ── buildEngineOptions ──────────────────────────────────────────────

describe('buildEngineOptions', () => {
  const baseForm: AddTaskForm = {
    uris: '',
    out: '',
    dir: '/downloads',
    split: 16,
    userAgent: '',
    authorization: '',
    referer: '',
    cookie: '',
    httpAuthUsername: '',
    httpAuthPassword: '',
    saveHttpAuth: true,
    proxyMode: 'direct',
    customProxy: '',
    requestHeaders: [],
  }

  it('always includes dir and split', () => {
    const opts = buildEngineOptions(baseForm)
    expect(opts.dir).toBe('/downloads')
    expect(opts.split).toBe('16')
  })

  it('does NOT include max-connection-per-server (uses global value since v2)', () => {
    const opts = buildEngineOptions(baseForm)
    expect(opts['max-connection-per-server']).toBeUndefined()
  })

  it('includes split without coupling to max-connection-per-server', () => {
    const opts = buildEngineOptions({ ...baseForm, split: 128 })
    expect(opts.split).toBe('128')
    expect(opts['max-connection-per-server']).toBeUndefined()
  })

  it('includes out when non-empty', () => {
    const opts = buildEngineOptions({ ...baseForm, out: 'file.zip' })
    expect(opts.out).toBe('file.zip')
  })

  it('omits out when empty', () => {
    const opts = buildEngineOptions(baseForm)
    expect(opts.out).toBeUndefined()
  })

  it('includes user-agent when set', () => {
    const opts = buildEngineOptions({ ...baseForm, userAgent: 'MyUA/1.0' })
    expect(opts['user-agent']).toBe('MyUA/1.0')
  })

  it('keeps plugin user-agent unless a matching saved rule overrides it', () => {
    const form = {
      ...baseForm,
      defaultUserAgent: 'DefaultUA/1.0',
      userAgentProfiles: [
        { id: 'quark', name: 'Quark Drive', value: 'QuarkUA/1.0', createdAt: 1, updatedAt: 1 },
        { id: 'baidu', name: 'Baidu Netdisk', value: 'BaiduUA/1.0', createdAt: 2, updatedAt: 2 },
      ],
      userAgentRules: [
        {
          id: 'quark-rule',
          enabled: true,
          hostPattern: '*.quark.cn',
          profileId: 'quark',
          overridePlugin: false,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'baidu-rule',
          enabled: true,
          hostPattern: 'pan.baidu.com',
          profileId: 'baidu',
          overridePlugin: true,
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    }

    expect(
      buildEngineOptions(form, { url: 'https://cdn.quark.cn/file.zip', userAgent: 'BrowserUA/1.0' })['user-agent'],
    ).toBe('BrowserUA/1.0')
    expect(
      buildEngineOptions(form, { url: 'https://pan.baidu.com/file.zip', userAgent: 'BrowserUA/1.0' })['user-agent'],
    ).toBe('BaiduUA/1.0')
  })

  it('includes referer when set', () => {
    const opts = buildEngineOptions({ ...baseForm, referer: 'https://r.com' })
    expect(opts.referer).toBe('https://r.com')
  })

  it('builds header array from cookie and authorization', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      cookie: 'session=abc',
      authorization: 'Bearer token',
    })
    expect(opts.header).toEqual(['Cookie: session=abc', 'Authorization: Bearer token'])
  })

  it('merges sanitized browser request headers before explicit cookie and authorization', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      cookie: 'session=abc',
      authorization: 'Bearer token',
      requestHeaders: [
        { name: 'Accept', value: 'application/octet-stream' },
        { name: 'Accept-Language', value: 'en-US,en;q=0.9' },
      ],
    })

    expect(opts.header).toEqual([
      'Accept: application/octet-stream',
      'Accept-Language: en-US,en;q=0.9',
      'Cookie: session=abc',
      'Authorization: Bearer token',
    ])
  })

  it('drops unsafe, forbidden, duplicate, and overlong browser request headers', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      requestHeaders: [
        { name: 'Accept', value: 'application/octet-stream' },
        { name: 'Accept', value: 'text/html' },
        { name: 'Host', value: 'example.com' },
        { name: 'X-Evil', value: 'bad' },
        { name: 'Origin', value: 'https://example.com\r\nInjected: bad' },
        { name: 'DNT', value: '1' },
        { name: 'Accept-Language', value: 'x'.repeat(8193) },
      ],
    })

    expect(opts.header).toEqual(['Accept: application/octet-stream', 'DNT: 1'])
  })

  it('drops explicit header fields that contain CRLF instead of joining injected segments', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      userAgent: 'MyUA\r\nInjected: bad',
      referer: 'https://r.com\n',
      cookie: 'session=abc\r\nX-Evil: 1',
      authorization: 'Bearer token\nAnother: bad',
    })

    expect(opts['user-agent']).toBeUndefined()
    expect(opts.referer).toBeUndefined()
    expect(opts.header).toBeUndefined()
  })

  it('builds HTTP Basic Auth options from form fields', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      httpAuthUsername: ' demo ',
      httpAuthPassword: ' secret ',
    })
    expect(opts['http-user']).toBe('demo')
    expect(opts['http-passwd']).toBe('secret')
  })

  it('trims clean explicit HTTP header values before building aria2 options', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      userAgent: ' MyUA ',
      referer: ' https://r.com ',
      cookie: ' session=abc ',
      authorization: ' Bearer token ',
    })

    expect(opts['user-agent']).toBe('MyUA')
    expect(opts.referer).toBe('https://r.com')
    expect(opts.header).toEqual(['Cookie: session=abc', 'Authorization: Bearer token'])
  })

  it('omits header when no cookie or auth', () => {
    const opts = buildEngineOptions(baseForm)
    expect(opts.header).toBeUndefined()
  })

  // ── Proxy mode tests ──

  it('forces direct mode when proxyMode is direct', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      proxyMode: 'direct',
    })
    expect(opts['proxy-mode']).toBeUndefined()
    expect(opts['all-proxy']).toBe('')
  })

  it('sets manual proxy options when proxyMode is manual with valid address', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      proxyMode: 'manual',
      customProxy: 'http://10.0.0.1:8080',
    })
    expect(opts['proxy-mode']).toBeUndefined()
    expect(opts['all-proxy']).toBe('http://10.0.0.1:8080')
  })

  it('sets structured proxy authentication options for manual task proxy', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      proxyMode: 'manual',
      customProxy: 'http://10.0.0.1:8080',
      customProxyUsername: 'proxy-user',
      customProxyPassword: 'proxy-pass',
    })
    expect(opts['all-proxy']).toBe('http://10.0.0.1:8080')
    expect(opts['all-proxy-user']).toBe('proxy-user')
    expect(opts['all-proxy-passwd']).toBe('proxy-pass')
    expect(opts['http-user']).toBeUndefined()
    expect(opts['http-passwd']).toBeUndefined()
  })

  it('falls back to direct when proxyMode is manual but customProxy is empty', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      proxyMode: 'manual',
      customProxy: '',
    })
    expect(opts['proxy-mode']).toBeUndefined()
    expect(opts['all-proxy']).toBe('')
  })

  it('inherits the app download proxy when manual task proxy has no custom address', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      proxyMode: 'manual',
      customProxy: '',
      appProxy: {
        mode: 'manual',
        server: 'http://127.0.0.1:7890',
        username: 'global-user',
        password: 'global-pass',
        bypass: 'localhost;127.*',
        scope: ['download'],
      },
    })
    expect(opts['proxy-mode']).toBeUndefined()
    expect(opts['all-proxy']).toBe('http://127.0.0.1:7890')
    expect(opts['all-proxy-user']).toBe('global-user')
    expect(opts['all-proxy-passwd']).toBe('global-pass')
    expect(opts['no-proxy']).toBe('localhost;127.*')
  })

  it('does not send all-proxy when proxyMode is direct even with customProxy set', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      proxyMode: 'direct',
      customProxy: 'http://10.0.0.1:8080',
    })
    expect(opts['proxy-mode']).toBeUndefined()
    expect(opts['all-proxy']).toBe('')
  })

  it('does not treat userinfo in proxy server as the credential source', () => {
    const opts = buildEngineOptions({
      ...baseForm,
      proxyMode: 'manual',
      customProxy: 'http://user:pass@proxy.example.com:8080',
    })
    expect(opts['all-proxy']).toBe('http://user:pass@proxy.example.com:8080')
    expect(opts['all-proxy-user']).toBeUndefined()
    expect(opts['all-proxy-passwd']).toBeUndefined()
  })
})

// ── classifySubmitError ─────────────────────────────────────────────

describe('classifySubmitError', () => {
  beforeEach(() => {
    mockIsEngineReady.mockReturnValue(true)
  })

  it('returns engine-not-ready when message contains "not initialized"', () => {
    expect(classifySubmitError(new Error('Aria2 client not initialized'))).toBe('engine-not-ready')
  })

  it('returns engine-not-ready when engine is not ready', () => {
    mockIsEngineReady.mockReturnValue(false)
    expect(classifySubmitError(new Error('some error'))).toBe('engine-not-ready')
  })

  it('returns duplicate for "already exists" errors', () => {
    expect(classifySubmitError(new Error('GID already exists'))).toBe('duplicate')
  })

  it('returns duplicate for "duplicate download" errors', () => {
    expect(classifySubmitError(new Error('duplicate download detected'))).toBe('duplicate')
  })

  it('returns generic for unknown errors', () => {
    expect(classifySubmitError(new Error('network timeout'))).toBe('generic')
  })

  it('handles non-Error values', () => {
    expect(classifySubmitError('some string error')).toBe('generic')
  })

  it('classifies duplicate Tauri AppError objects', () => {
    expect(classifySubmitError({ Aria2: 'aria2 RPC error [1]: GID already exists' })).toBe('duplicate')
  })
})

// ── submitBatchItems ────────────────────────────────────────────────

describe('submitBatchItems', () => {
  const mockTaskStore = {
    addTorrent: vi.fn().mockResolvedValue('gid1'),
    registerTorrentSource: vi.fn(),
  } as unknown as ReturnType<typeof import('@/stores/task').useTaskStore>

  const baseOptions: Aria2EngineOptions = { dir: '/dl', split: '16' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits torrent items via addTorrent', async () => {
    const items: BatchItem[] = [
      { id: 1, kind: 'torrent', source: 'a.torrent', payload: 'base64', status: 'pending' } as unknown as BatchItem,
    ]

    await submitBatchItems(items, baseOptions, mockTaskStore)

    expect(mockTaskStore.addTorrent).toHaveBeenCalledWith({
      torrent: 'base64',
      options: expect.objectContaining({ dir: '/dl' }),
    })
    expect(items[0].status).toBe('submitted')
  })

  it('skips URI items (handled separately)', async () => {
    const items: BatchItem[] = [
      {
        id: 3,
        kind: 'uri',
        source: 'http://e.com',
        payload: 'http://e.com',
        status: 'pending',
      } as unknown as BatchItem,
    ]

    await submitBatchItems(items, baseOptions, mockTaskStore)

    expect(mockTaskStore.addTorrent).not.toHaveBeenCalled()
  })

  it('removes out option for torrent items', async () => {
    const items: BatchItem[] = [
      { id: 4, kind: 'torrent', source: 'c.torrent', payload: 'b64', status: 'pending' } as unknown as BatchItem,
    ]
    const opts = { ...baseOptions, out: 'custom.zip' }

    await submitBatchItems(items, opts, mockTaskStore)

    const passedOpts = (mockTaskStore.addTorrent as ReturnType<typeof vi.fn>).mock.calls[0][0].options
    expect(passedOpts.out).toBeUndefined()
  })

  it('includes select-file when partial selection', async () => {
    const items: BatchItem[] = [
      {
        id: 5,
        kind: 'torrent',
        source: 'd.torrent',
        payload: 'b64',
        status: 'pending',
        selectedFileIndices: [1, 3],
        torrentMeta: { files: [{ idx: 1 }, { idx: 2 }, { idx: 3 }] },
      } as unknown as BatchItem,
    ]

    await submitBatchItems(items, baseOptions, mockTaskStore)

    const passedOpts = (mockTaskStore.addTorrent as ReturnType<typeof vi.fn>).mock.calls[0][0].options
    expect(passedOpts['select-file']).toBe('1,3')
  })

  it('marks items as failed on error and returns failure count', async () => {
    ;(mockTaskStore.addTorrent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('engine down'))

    const items: BatchItem[] = [
      { id: 6, kind: 'torrent', source: 'e.torrent', payload: 'b64', status: 'pending' } as unknown as BatchItem,
    ]

    const failures = await submitBatchItems(items, baseOptions, mockTaskStore)

    expect(failures).toBe(1)
    expect(items[0].status).toBe('failed')
    expect(items[0].error).toBe('engine down')
  })

  it('stores readable failure text for structured Tauri errors', async () => {
    ;(mockTaskStore.addTorrent as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      Aria2: 'aria2 RPC error [1]: Unsupported URI scheme',
    })

    const items: BatchItem[] = [
      { id: 8, kind: 'torrent', source: 'e.torrent', payload: 'b64', status: 'pending' } as unknown as BatchItem,
    ]

    const failures = await submitBatchItems(items, baseOptions, mockTaskStore)

    expect(failures).toBe(1)
    expect(items[0].error).toBe('Aria2 Next error [1]: Unsupported URI scheme')
  })

  it('skips already submitted items', async () => {
    const items: BatchItem[] = [
      { id: 7, kind: 'torrent', source: 'f.torrent', payload: 'b64', status: 'submitted' } as unknown as BatchItem,
    ]

    await submitBatchItems(items, baseOptions, mockTaskStore)
    expect(mockTaskStore.addTorrent).not.toHaveBeenCalled()
  })
})

// ── submitManualUris ────────────────────────────────────────────────

describe('submitManualUris', () => {
  const mockTaskStore = {
    addUri: vi.fn().mockResolvedValue(['gid1']),
    addMagnetUri: vi.fn().mockResolvedValue('magnet-gid'),
    addTorrent: vi.fn().mockResolvedValue('torrent-gid'),
    registerTorrentSource: vi.fn(),
  } as unknown as ReturnType<typeof import('@/stores/task').useTaskStore>

  const baseForm: AddTaskForm = {
    uris: '',
    out: '',
    dir: '/dl',
    split: 16,
    userAgent: '',
    authorization: '',
    referer: '',
    cookie: '',
    httpAuthUsername: '',
    httpAuthPassword: '',
    saveHttpAuth: true,
    proxyMode: 'direct',
    customProxy: '',
    requestHeaders: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when uris is empty/whitespace', async () => {
    await submitManualUris({ ...baseForm, uris: '  ' }, {}, mockTaskStore)
    expect(mockTaskStore.addUri).not.toHaveBeenCalled()
  })

  it('submits single URI with extension — outs contains empty string (no HEAD needed)', async () => {
    await submitManualUris({ ...baseForm, uris: 'http://example.com/file.zip' }, { dir: '/dl' }, mockTaskStore)

    const call = (mockTaskStore.addUri as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.uris).toEqual(['http://example.com/file.zip'])
    // Each URI produces an empty string (= let aria2 decide), not a flat []
    expect(call.outs).toEqual([''])
    expect(call.options).toEqual({ dir: '/dl' })
  })

  it('submits manual remote torrent URLs as ordinary URI downloads', async () => {
    const { invoke } = await import('@tauri-apps/api/core')

    await submitManualUris(
      { ...baseForm, uris: 'https://example.com/linux.torrent?token=abc' },
      { dir: '/dl' },
      mockTaskStore,
    )

    expect(invoke).not.toHaveBeenCalledWith('fetch_remote_bytes', expect.anything())
    expect(mockTaskStore.addTorrent).not.toHaveBeenCalled()
    expect(mockTaskStore.addUri).toHaveBeenCalledWith({
      uris: ['https://example.com/linux.torrent?token=abc'],
      outs: [''],
      options: { dir: '/dl' },
    })
  })

  it('passes Thunder links to the engine for manual URI tasks', async () => {
    const thunder = 'thunder://' + btoa('AAhttps://example.com/file.zipZZ')

    await submitManualUris({ ...baseForm, uris: thunder }, { dir: '/dl' }, mockTaskStore)

    const call = (mockTaskStore.addUri as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.uris).toEqual([thunder])
    expect(call.outs).toEqual([''])
  })

  it('generates numbered outs for multi-URI with out specified', async () => {
    await submitManualUris(
      { ...baseForm, uris: 'http://a.com/1\nhttp://b.com/2', out: 'file.zip' },
      { dir: '/dl' },
      mockTaskStore,
    )

    const call = (mockTaskStore.addUri as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.uris).toHaveLength(2)
    // Should have generated numbered filenames (fallback since buildOuts may return empty)
    expect(call.outs.length).toBeGreaterThan(0)
  })

  it('does not invoke HEAD for percent-encoded URIs with extension — aria2 handles decode natively', async () => {
    await submitManualUris({ ...baseForm, uris: 'http://example.com/AAA%20BBB.mp3' }, { dir: '/dl' }, mockTaskStore)

    const call = (mockTaskStore.addUri as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // .mp3 has an extension → hasExtension returns true → no HEAD request
    expect(call.outs).toEqual([''])
  })

  it('invokes resolve_filename for extensionless URL paths', async () => {
    // This URL has no extension in the path — resolve_filename is invoked
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce('215.zip')

    await submitManualUris(
      { ...baseForm, uris: 'https://datashop.cboe.com/download/sample/215' },
      { dir: '/dl' },
      mockTaskStore,
    )

    expect(invoke).toHaveBeenCalledWith('resolve_filename', {
      url: 'https://datashop.cboe.com/download/sample/215',
      proxy: null,
    })
    const call = (mockTaskStore.addUri as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.outs).toEqual(['215.zip'])
  })

  it('passes referer and cookie to resolve_filename for authenticated extensionless URLs', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Итоги_2026.docx')

    const result = await submitManualUris(
      {
        ...baseForm,
        uris: 'https://mail-attachment.googleusercontent.com/attachment/u/0/',
        referer: 'https://mail.google.com/mail/u/0/#inbox',
        cookie: 'COMPASS=gmail=abc',
      },
      { dir: '/dl', referer: 'https://mail.google.com/mail/u/0/#inbox', header: ['Cookie: COMPASS=gmail=abc'] },
      mockTaskStore,
    )

    expect(invoke).toHaveBeenCalledWith('resolve_filename', {
      url: 'https://mail-attachment.googleusercontent.com/attachment/u/0/',
      proxy: null,
      referer: 'https://mail.google.com/mail/u/0/#inbox',
      cookie: 'COMPASS=gmail=abc',
    })
    const call = (mockTaskStore.addUri as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.outs).toEqual(['Итоги_2026.docx'])
    expect(result.submittedTaskNames).toEqual(['Итоги_2026.docx'])
  })

  it('sanitizes referer and cookie before passing them to resolve_filename', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce('safe.zip')

    await submitManualUris(
      {
        ...baseForm,
        uris: 'https://example.com/download',
        referer: 'https://example.com/\r\nInjected: bad',
        cookie: 'session=abc\nX-Evil: 1',
      },
      { dir: '/dl' },
      mockTaskStore,
    )

    expect(invoke).toHaveBeenCalledWith('resolve_filename', {
      url: 'https://example.com/download',
      proxy: null,
      referer: 'https://example.com/Injected: bad',
      cookie: 'session=abcX-Evil: 1',
    })
  })

  it('does not include magnet URIs in regular addUri call (they use separate addMagnetUri path)', async () => {
    await submitManualUris(
      { ...baseForm, uris: 'http://example.com/file%20name.zip\nmagnet:?xt=urn:btih:abc123' },
      { dir: '/dl' },
      mockTaskStore,
    )

    const call = (mockTaskStore.addUri as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // Only the regular URI should be in the addUri call
    expect(call.uris).toEqual(['http://example.com/file%20name.zip'])
    expect(call.outs).toEqual(['']) // .zip has extension → empty string (no HEAD)
  })

  it('does not invoke resolve_filename when user has specified out', async () => {
    const { invoke } = await import('@tauri-apps/api/core')

    await submitManualUris(
      { ...baseForm, uris: 'http://example.com/AAA%20BBB.mp3', out: 'custom.mp3' },
      { dir: '/dl', out: 'custom.mp3' },
      mockTaskStore,
    )

    // User provided explicit out → buildOuts handles naming, resolve_filename not called
    expect(invoke).not.toHaveBeenCalledWith('resolve_filename', expect.anything())
  })

  it('returns structured magnet failures without throwing away successful submissions', async () => {
    ;(mockTaskStore.addMagnetUri as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('magnet-gid-1')
      .mockRejectedValueOnce(new Error('invalid magnet'))

    const result = await submitManualUris(
      {
        ...baseForm,
        uris: 'magnet:?xt=urn:btih:good\nmagnet:?xt=urn:btih:bad',
      },
      { dir: '/dl' },
      mockTaskStore,
    )

    expect(result).toEqual({
      submittedTaskNames: [],
      magnetGids: ['magnet-gid-1'],
      magnetFailures: [{ uri: 'magnet:?xt=urn:btih:bad', error: 'invalid magnet' }],
      m3u8Merged: [],
    })
  })

  it('rejects a master playlist (EXT-X-STREAM-INF) without submitting any segments', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720',
      'https://cdn.example.com/hls/720p/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=640000,RESOLUTION=640x360',
      'https://cdn.example.com/hls/360p/index.m3u8',
    ].join('\n')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Array.from(new TextEncoder().encode(master)))

    await expect(
      submitManualUris({ ...baseForm, uris: 'https://cdn.example.com/hls/master.m3u8' }, { dir: '/dl' }, mockTaskStore),
    ).rejects.toMatchObject({ name: 'M3u8SubmitFailure', reasonCode: 'master-playlist' })

    expect(mockTaskStore.addUri).not.toHaveBeenCalled()
  })

  it('rejects a live stream (no EXT-X-ENDLIST) without submitting any segments', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const live = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:2680',
      '#EXTINF:6.0,',
      'https://cdn.example.com/live/seg-2680.ts',
      '#EXTINF:6.0,',
      'https://cdn.example.com/live/seg-2681.ts',
    ].join('\n')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Array.from(new TextEncoder().encode(live)))

    await expect(
      submitManualUris({ ...baseForm, uris: 'https://cdn.example.com/live/index.m3u8' }, { dir: '/dl' }, mockTaskStore),
    ).rejects.toMatchObject({ name: 'M3u8SubmitFailure', reasonCode: 'live-stream' })

    expect(mockTaskStore.addUri).not.toHaveBeenCalled()
  })

  it('rejects an event-live stream (PLAYLIST-TYPE:EVENT) without submitting any segments', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const event = [
      '#EXTM3U',
      '#EXT-X-PLAYLIST-TYPE:EVENT',
      '#EXTINF:6.006,',
      'https://cdn.example.com/event/seg-0.ts',
    ].join('\n')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Array.from(new TextEncoder().encode(event)))

    await expect(
      submitManualUris(
        { ...baseForm, uris: 'https://cdn.example.com/event/index.m3u8' },
        { dir: '/dl' },
        mockTaskStore,
      ),
    ).rejects.toMatchObject({ name: 'M3u8SubmitFailure', reasonCode: 'live-stream' })

    expect(mockTaskStore.addUri).not.toHaveBeenCalled()
  })

  it('downloads and merges a VOD playlist (EXT-X-ENDLIST present)', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    setActivePinia(createPinia())
    const vod = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'https://cdn.example.com/movie/seg-0.ts',
      '#EXTINF:10,',
      'https://cdn.example.com/movie/seg-1.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Array.from(new TextEncoder().encode(vod)))

    const result = await submitManualUris(
      { ...baseForm, uris: 'https://cdn.example.com/movie.m3u8' },
      { dir: '/dl' },
      mockTaskStore,
    )

    // Two segments submitted to aria2 as individual tasks.
    const addUriCalls = (mockTaskStore.addUri as ReturnType<typeof vi.fn>).mock.calls
    expect(addUriCalls).toHaveLength(2)
    for (const call of addUriCalls) {
      expect(call[0].options['auto-file-renaming']).toBe('false')
    }

    expect(invoke).toHaveBeenCalledWith(
      'merge_m3u8_segments',
      expect.objectContaining({
        params: expect.objectContaining({
          tempDir: expect.stringContaining('.motrix-m3u8-movie-'),
          finalPath: '/dl/movie.mp4',
          ffmpegPath: '/usr/local/bin/ffmpeg',
          cleanup: true,
        }),
      }),
    )
    expect(invoke).toHaveBeenCalledWith('check_ffmpeg', { path: '/usr/local/bin/ffmpeg' })
    expect(result.m3u8Merged).toEqual([{ taskName: 'movie.mp4', outputPath: '/dl/movie.mp4' }])
  })

  it('fails fast before submitting any segments when ffmpeg is not configured', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    setActivePinia(createPinia())
    const vod = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'https://cdn.example.com/movie/seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Array.from(new TextEncoder().encode(vod)))

    const originalFfmpegPath = mockPreferenceStore.config.ffmpegPath
    mockPreferenceStore.config.ffmpegPath = ''
    try {
      await expect(
        submitManualUris({ ...baseForm, uris: 'https://cdn.example.com/movie.m3u8' }, { dir: '/dl' }, mockTaskStore),
      ).rejects.toMatchObject({
        name: 'M3u8SubmitFailure',
        reasonCode: 'merge-failed',
        detail: expect.stringContaining('no ffmpeg configured'),
      })
    } finally {
      mockPreferenceStore.config.ffmpegPath = originalFfmpegPath
    }

    expect(mockTaskStore.addUri).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith('merge_m3u8_segments', expect.anything())
  })

  it('fails fast when the configured ffmpeg path fails the check_ffmpeg probe', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    setActivePinia(createPinia())
    const vod = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'https://cdn.example.com/movie/seg-0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
    ;(invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(Array.from(new TextEncoder().encode(vod)))
      .mockRejectedValueOnce(new Error('path does not exist: /usr/local/bin/ffmpeg'))

    await expect(
      submitManualUris({ ...baseForm, uris: 'https://cdn.example.com/movie.m3u8' }, { dir: '/dl' }, mockTaskStore),
    ).rejects.toMatchObject({
      name: 'M3u8SubmitFailure',
      reasonCode: 'merge-failed',
      detail: expect.stringContaining('ffmpeg check failed'),
    })

    expect(mockTaskStore.addUri).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith('merge_m3u8_segments', expect.anything())
  })
})

describe('useAddTaskSubmit', () => {
  const baseForm: AddTaskForm = {
    uris: '',
    out: '',
    dir: '/dl',
    split: 16,
    userAgent: '',
    authorization: '',
    referer: '',
    cookie: '',
    httpAuthUsername: '',
    httpAuthPassword: '',
    saveHttpAuth: true,
    proxyMode: 'direct',
    customProxy: '',
    requestHeaders: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAppStore.pendingBatch = []
    mockPreferenceStore.config.newTaskShowDownloading = true
    mockPreferenceStore.config.fileCategoryEnabled = false
    mockPreferenceStore.config.fileCategories = []
  })

  it('keeps AddTask open when a magnet submission fails', async () => {
    mockTaskStoreForHook.addMagnetUri.mockRejectedValueOnce(new Error('invalid magnet'))
    const onClose = vi.fn()

    const { handleSubmit } = useAddTaskSubmit({
      form: ref({ ...baseForm, uris: 'magnet:?xt=urn:btih:bad' }),
      onClose,
    })

    await handleSubmit()

    expect(onClose).not.toHaveBeenCalled()
    expect(mockMessage.warning).toHaveBeenCalledWith('1 task.failed', { closable: true })
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('shows readable toast text for structured Tauri add-uri errors', async () => {
    mockTaskStoreForHook.addUri.mockRejectedValueOnce({
      Aria2: 'aria2 RPC error [1]: Unsupported URI scheme',
    })
    const onClose = vi.fn()

    const { handleSubmit } = useAddTaskSubmit({
      form: ref({ ...baseForm, uris: '23222233' }),
      onClose,
    })

    await handleSubmit()

    expect(onClose).not.toHaveBeenCalled()
    expect(mockMessage.error).toHaveBeenCalledWith('task.error-aria2-next [1]: Unsupported URI scheme', {
      closable: true,
    })
  })

  it('uses the resolved output filename in the start toast for extensionless URLs', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce('ИТОГИ ЛДУ 2026.xlsx')
    const onClose = vi.fn()

    const { handleSubmit } = useAddTaskSubmit({
      form: ref({
        ...baseForm,
        uris: 'http://127.0.0.1:18080/attachment/u/0/?ui=2&disp=safe',
      }),
      onClose,
    })

    await handleSubmit()

    expect(mockMessage.info).toHaveBeenCalledWith('task.download-start-message:ИТОГИ ЛДУ 2026.xlsx')
  })
})

// ── resolveM3u8RuntimeConfig ─────────────────────────────────────────

describe('resolveM3u8RuntimeConfig', () => {
  it('falls back to DEFAULT_APP_CONFIG when keys are missing', () => {
    const cfg = { ffmpegPath: '/ffmpeg' } as AppConfig
    expect(resolveM3u8RuntimeConfig(cfg)).toEqual({
      maxRetries: D.m3u8MaxRetries,
      retryDelaySec: D.m3u8RetryDelaySec,
      segmentTimeoutSec: D.m3u8SegmentTimeoutSec,
      concurrency: D.m3u8Concurrency,
      autoCleanup: D.m3u8AutoCleanup,
    })
  })

  it('reads user-provided values', () => {
    const cfg = {
      m3u8MaxRetries: 2,
      m3u8RetryDelaySec: 7,
      m3u8SegmentTimeoutSec: 600,
      m3u8Concurrency: 3,
      m3u8AutoCleanup: false,
    } as AppConfig
    expect(resolveM3u8RuntimeConfig(cfg)).toEqual({
      maxRetries: 2,
      retryDelaySec: 7,
      segmentTimeoutSec: 600,
      concurrency: 3,
      autoCleanup: false,
    })
  })

  it('treats explicit zeros as disabled (no fallback)', () => {
    const cfg = {
      m3u8MaxRetries: 0,
      m3u8SegmentTimeoutSec: 0,
      m3u8RetryDelaySec: 0,
    } as AppConfig
    const runtime = resolveM3u8RuntimeConfig(cfg)
    expect(runtime.maxRetries).toBe(0)
    expect(runtime.segmentTimeoutSec).toBe(0)
    expect(runtime.retryDelaySec).toBe(0)
  })
})

// ── runWithConcurrency ───────────────────────────────────────────────

describe('runWithConcurrency', () => {
  it('completes all items regardless of concurrency', async () => {
    const calls: number[] = []
    await runWithConcurrency(2, [0, 1, 2, 3, 4], async (item) => {
      calls.push(item)
    })
    expect(calls.sort()).toEqual([0, 1, 2, 3, 4])
  })

  it('never runs more than the limit in parallel', async () => {
    let active = 0
    let peak = 0
    await runWithConcurrency(3, [0, 1, 2, 3, 4, 5, 6, 7], async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBe(3)
  })

  it('clamps a non-positive limit to 1', async () => {
    const calls: number[] = []
    await runWithConcurrency(0, [0, 1, 2], async (item) => {
      calls.push(item)
    })
    expect(calls).toEqual([0, 1, 2])
  })

  it('handles empty input without running anything', async () => {
    const fn = vi.fn()
    await runWithConcurrency(4, [], fn)
    expect(fn).not.toHaveBeenCalled()
  })

  it('propagates worker errors', async () => {
    await expect(
      runWithConcurrency(2, [0, 1, 2], async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})

// ── M3u8SubmitFailure ────────────────────────────────────────────────

describe('M3u8SubmitFailure', () => {
  const t = vi.fn((key: string) => {
    const known: Record<string, string> = {
      'task.m3u8-max-retries': 'Max retries reached',
      'task.m3u8-merge-failed': 'FFmpeg merge failed',
      'task.m3u8-master-playlist': 'Master playlists are not supported',
      'task.m3u8-live-stream': 'Live streams are not supported',
    }
    return known[key] ?? key
  })

  it('carries the task name and reason code', () => {
    const err = new M3u8SubmitFailure('movie.mp4', 'max-retries')

    expect(err).toBeInstanceOf(Error)
    expect(err.taskName).toBe('movie.mp4')
    expect(err.reasonCode).toBe('max-retries')
  })

  it('localizes known reason codes', () => {
    expect(new M3u8SubmitFailure('movie.mp4', 'max-retries').reasonText(t as never)).toBe('Max retries reached')
    expect(new M3u8SubmitFailure('movie.mp4', 'merge-failed').reasonText(t as never)).toBe('FFmpeg merge failed')
    expect(new M3u8SubmitFailure('movie.mp4', 'master-playlist').reasonText(t as never)).toBe(
      'Master playlists are not supported',
    )
    expect(new M3u8SubmitFailure('movie.mp4', 'live-stream').reasonText(t as never)).toBe(
      'Live streams are not supported',
    )
  })

  it('falls back to the max-retries message for unknown reason codes', () => {
    expect(new M3u8SubmitFailure('movie.mp4', 'bogus').reasonText(t as never)).toBe('Max retries reached')
  })

  it('appends the optional diagnostic detail after the localized reason', () => {
    expect(new M3u8SubmitFailure('movie.mp4', 'merge-failed', 'no ffmpeg configured').reasonText(t as never)).toBe(
      'FFmpeg merge failed: no ffmpeg configured',
    )
    // detail is optional — absent detail keeps the plain localized text.
    expect(new M3u8SubmitFailure('movie.mp4', 'merge-failed').reasonText(t as never)).toBe('FFmpeg merge failed')
  })
})
