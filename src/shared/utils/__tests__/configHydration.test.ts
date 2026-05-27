/** @fileoverview Tests for centralized AppConfig hydration. */
import { describe, expect, it } from 'vitest'
import {
  COLOR_SCHEMES,
  DEFAULT_APP_CONFIG,
  FILE_ALLOCATION_OPTIONS,
  LOG_LEVELS,
  PROXY_SCOPE_OPTIONS,
  UPDATE_CHANNELS,
} from '@shared/constants'
import { CONFIG_VERSION } from '@shared/utils/configMigration'
import { hydrateAppConfig } from '@shared/utils/configHydration'
import type { AppConfig } from '@shared/types'

describe('hydrateAppConfig', () => {
  it('hydrates missing top-level fields from defaults', () => {
    const result = hydrateAppConfig({ theme: 'dark', locale: 'ja' })

    expect(result.config.theme).toBe('dark')
    expect(result.config.locale).toBe('ja')
    expect(result.config.colorScheme).toBe(DEFAULT_APP_CONFIG.colorScheme)
    expect(result.config.maxConcurrentDownloads).toBe(DEFAULT_APP_CONFIG.maxConcurrentDownloads)
  })

  it('deep-hydrates fixed nested objects without overwriting saved subfields', () => {
    const result = hydrateAppConfig({
      configVersion: CONFIG_VERSION,
      proxy: { mode: 'manual', enable: true, server: 'http://127.0.0.1:7890' } as AppConfig['proxy'],
      protocols: { magnet: false } as AppConfig['protocols'],
      clipboard: { enable: false, http: false } as AppConfig['clipboard'],
      portConflictRecovery: { enabled: false, rangeStart: 24050 } as AppConfig['portConflictRecovery'],
    })

    expect(result.config.proxy).toEqual({
      ...DEFAULT_APP_CONFIG.proxy,
      mode: 'manual',
      enable: true,
      server: 'http://127.0.0.1:7890',
    })
    expect(result.config.protocols).toEqual({ ...DEFAULT_APP_CONFIG.protocols, magnet: false })
    expect(result.config.clipboard).toEqual({ ...DEFAULT_APP_CONFIG.clipboard, enable: false, http: false })
    expect(result.config.portConflictRecovery).toEqual({
      ...DEFAULT_APP_CONFIG.portConflictRecovery,
      enabled: false,
      rangeStart: 24050,
    })
  })

  it('preserves user-owned arrays including intentionally empty arrays', () => {
    const result = hydrateAppConfig({
      configVersion: CONFIG_VERSION,
      trackerSource: [],
      customTrackerUrls: ['https://example.com/trackers.txt'],
      historyDirectories: [],
      favoriteDirectories: ['/downloads'],
      fileCategories: [],
    })

    expect(result.config.trackerSource).toEqual([])
    expect(result.config.customTrackerUrls).toEqual(['https://example.com/trackers.txt'])
    expect(result.config.historyDirectories).toEqual([])
    expect(result.config.favoriteDirectories).toEqual(['/downloads'])
    expect(result.config.fileCategories).toEqual([])
  })

  it('repairs invalid scalar enums and records repair names', () => {
    const result = hydrateAppConfig({
      configVersion: CONFIG_VERSION,
      theme: 'neon' as AppConfig['theme'],
      colorScheme: 'missing-scheme',
      updateChannel: 'nightly' as AppConfig['updateChannel'],
      logLevel: 'verbose',
      fileAllocation: 'magic',
    })

    expect(result.config.theme).toBe(DEFAULT_APP_CONFIG.theme)
    expect(result.config.colorScheme).toBe(DEFAULT_APP_CONFIG.colorScheme)
    expect(result.config.updateChannel).toBe(DEFAULT_APP_CONFIG.updateChannel)
    expect(result.config.logLevel).toBe(DEFAULT_APP_CONFIG.logLevel)
    expect(result.config.fileAllocation).toBe(DEFAULT_APP_CONFIG.fileAllocation)
    expect(result.repairs).toEqual(
      expect.arrayContaining(['theme', 'colorScheme', 'updateChannel', 'logLevel', 'fileAllocation']),
    )
  })

  it('repairs invalid nested values and keeps valid nested values', () => {
    const result = hydrateAppConfig({
      configVersion: CONFIG_VERSION,
      proxy: { ...DEFAULT_APP_CONFIG.proxy, mode: 'broken' as AppConfig['proxy']['mode'], scope: ['download', 'bad'] },
      portConflictRecovery: {
        ...DEFAULT_APP_CONFIG.portConflictRecovery,
        rangeStart: 70000,
        rangeEnd: 65000,
        bt: false,
      },
    })

    expect(result.config.proxy.mode).toBe('direct')
    expect(result.config.proxy.scope).toEqual(['download'])
    expect(result.config.portConflictRecovery.rangeStart).toBe(DEFAULT_APP_CONFIG.portConflictRecovery.rangeStart)
    expect(result.config.portConflictRecovery.rangeEnd).toBe(DEFAULT_APP_CONFIG.portConflictRecovery.rangeEnd)
    expect(result.config.portConflictRecovery.bt).toBe(false)
    expect(result.repairs).toEqual(expect.arrayContaining(['proxy.mode', 'portConflictRecovery.range']))
  })

  it('preserves secret generation semantics', () => {
    const missing = hydrateAppConfig({ configVersion: CONFIG_VERSION })
    const cleared = hydrateAppConfig({
      configVersion: CONFIG_VERSION,
      rpcSecret: '',
      extensionApiSecret: '',
    })

    expect(missing.config.rpcSecret).toBeUndefined()
    expect(missing.config.extensionApiSecret).toBeUndefined()
    expect(cleared.config.rpcSecret).toBe('')
    expect(cleared.config.extensionApiSecret).toBe('')
  })

  it('returns migration and persistence signals', () => {
    const migrated = hydrateAppConfig({ proxy: { ...DEFAULT_APP_CONFIG.proxy, scope: [] } })
    const current = hydrateAppConfig({ configVersion: CONFIG_VERSION, theme: 'light' })

    expect(migrated.migration.migrated).toBe(true)
    expect(migrated.config.configVersion).toBe(CONFIG_VERSION)
    expect(migrated.shouldPersist).toBe(true)
    expect(current.migration.migrated).toBe(false)
    expect(current.shouldPersist).toBe(false)
  })

  it('does not downgrade configs from a future schema version', () => {
    const future = CONFIG_VERSION + 10
    const result = hydrateAppConfig({ configVersion: future, theme: 'light' })

    expect(result.config.configVersion).toBe(future)
    expect(result.migration.migrated).toBe(false)
  })

  it('keeps defaults aligned with allowed enum sets', () => {
    expect(['auto', 'light', 'dark']).toContain(DEFAULT_APP_CONFIG.theme)
    expect(COLOR_SCHEMES.some((scheme) => scheme.id === DEFAULT_APP_CONFIG.colorScheme)).toBe(true)
    expect(UPDATE_CHANNELS).toContain(DEFAULT_APP_CONFIG.updateChannel)
    expect(LOG_LEVELS).toContain(DEFAULT_APP_CONFIG.logLevel)
    expect(FILE_ALLOCATION_OPTIONS).toContain(DEFAULT_APP_CONFIG.fileAllocation)
    expect(DEFAULT_APP_CONFIG.proxy.scope).toEqual(PROXY_SCOPE_OPTIONS)
  })
})
