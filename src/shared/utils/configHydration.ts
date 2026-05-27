/** @fileoverview Centralized AppConfig hydration, migration, and repair. */
import {
  COLOR_SCHEMES,
  DEFAULT_APP_CONFIG,
  FILE_ALLOCATION_OPTIONS,
  LOG_LEVELS,
  PROXY_SCOPE_OPTIONS,
  UPDATE_CHANNELS,
} from '@shared/constants'
import { runMigrations, type MigrationResult } from '@shared/utils/configMigration'
import { normalizeProxyMode } from '@shared/utils/proxyPolicy'
import type {
  AppConfig,
  ClipboardConfig,
  PortConflictRecoveryConfig,
  ProtocolsConfig,
  ProxyConfig,
} from '@shared/types'

export interface HydratedAppConfig {
  config: AppConfig
  migration: MigrationResult
  repairs: string[]
  shouldPersist: boolean
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAllowed<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && allowed.includes(value)
}

function repairEnum<T extends readonly string[]>(
  config: Record<string, unknown>,
  key: keyof AppConfig & string,
  allowed: T,
  fallback: T[number],
  repairs: string[],
): void {
  if (isAllowed(config[key], allowed)) return
  config[key] = fallback
  repairs.push(key)
}

function normalizePort(value: unknown, fallback: number, key: string, repairs: string[]): number {
  const port = Number(value)
  if (Number.isInteger(port) && port >= 0 && port <= 65535) return port
  repairs.push(key)
  return fallback
}

function isValidPort(value: unknown): boolean {
  const port = Number(value)
  return Number.isInteger(port) && port >= 0 && port <= 65535
}

function normalizePositiveNumber(value: unknown, fallback: number, key: string, repairs: string[]): number {
  const number = Number(value)
  if (Number.isFinite(number) && number >= 0) return number
  repairs.push(key)
  return fallback
}

function normalizeProxy(value: unknown, repairs: string[]): ProxyConfig {
  const defaults = clonePlain(DEFAULT_APP_CONFIG.proxy)
  const saved = isRecord(value) ? value : {}
  const merged = { ...defaults, ...saved } as ProxyConfig
  const mode = normalizeProxyMode(merged.mode)

  if (mode !== merged.mode) {
    repairs.push('proxy.mode')
  }

  const scope = Array.isArray(merged.scope) ? merged.scope.filter((item) => PROXY_SCOPE_OPTIONS.includes(item)) : []
  if (scope.length !== (Array.isArray(merged.scope) ? merged.scope.length : 0)) {
    repairs.push('proxy.scope')
  }

  return {
    ...merged,
    mode,
    enable: typeof merged.enable === 'boolean' ? merged.enable : defaults.enable,
    server: typeof merged.server === 'string' ? merged.server : defaults.server,
    bypass: typeof merged.bypass === 'string' ? merged.bypass : defaults.bypass,
    scope: scope.length ? scope : [...PROXY_SCOPE_OPTIONS],
  }
}

function normalizeProtocols(value: unknown): ProtocolsConfig {
  const defaults = DEFAULT_APP_CONFIG.protocols
  const saved = isRecord(value) ? value : {}
  return {
    magnet: typeof saved.magnet === 'boolean' ? saved.magnet : defaults.magnet,
    ed2k: typeof saved.ed2k === 'boolean' ? saved.ed2k : defaults.ed2k,
    thunder: typeof saved.thunder === 'boolean' ? saved.thunder : defaults.thunder,
    motrixnext: typeof saved.motrixnext === 'boolean' ? saved.motrixnext : defaults.motrixnext,
  }
}

function normalizeClipboard(value: unknown): ClipboardConfig {
  const defaults = DEFAULT_APP_CONFIG.clipboard
  const saved = isRecord(value) ? value : {}
  return {
    enable: typeof saved.enable === 'boolean' ? saved.enable : defaults.enable,
    http: typeof saved.http === 'boolean' ? saved.http : defaults.http,
    ftp: typeof saved.ftp === 'boolean' ? saved.ftp : defaults.ftp,
    magnet: typeof saved.magnet === 'boolean' ? saved.magnet : defaults.magnet,
    ed2k: typeof saved.ed2k === 'boolean' ? saved.ed2k : defaults.ed2k,
    thunder: typeof saved.thunder === 'boolean' ? saved.thunder : defaults.thunder,
    btHash: typeof saved.btHash === 'boolean' ? saved.btHash : defaults.btHash,
  }
}

function normalizePortRecovery(value: unknown, repairs: string[]): PortConflictRecoveryConfig {
  const defaults = DEFAULT_APP_CONFIG.portConflictRecovery
  const saved = isRecord(value) ? value : {}
  const endpointsAreValid =
    (saved.rangeStart === undefined || isValidPort(saved.rangeStart)) &&
    (saved.rangeEnd === undefined || isValidPort(saved.rangeEnd))
  const rangeStart = normalizePort(saved.rangeStart, defaults.rangeStart, 'portConflictRecovery.range', repairs)
  const rangeEnd = normalizePort(saved.rangeEnd, defaults.rangeEnd, 'portConflictRecovery.range', repairs)
  const validRange = endpointsAreValid && rangeStart <= rangeEnd

  if (!validRange) {
    repairs.push('portConflictRecovery.range')
  }

  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : defaults.enabled,
    rangeStart: validRange ? rangeStart : defaults.rangeStart,
    rangeEnd: validRange ? rangeEnd : defaults.rangeEnd,
    rpc: typeof saved.rpc === 'boolean' ? saved.rpc : defaults.rpc,
    extensionApi: typeof saved.extensionApi === 'boolean' ? saved.extensionApi : defaults.extensionApi,
    bt: typeof saved.bt === 'boolean' ? saved.bt : defaults.bt,
    dht: typeof saved.dht === 'boolean' ? saved.dht : defaults.dht,
    ed2k: typeof saved.ed2k === 'boolean' ? saved.ed2k : defaults.ed2k,
    ed2kUdp: typeof saved.ed2kUdp === 'boolean' ? saved.ed2kUdp : defaults.ed2kUdp,
  }
}

function normalizeScalarValues(config: Record<string, unknown>, repairs: string[]): void {
  repairEnum(config, 'theme', ['auto', 'light', 'dark'] as const, DEFAULT_APP_CONFIG.theme, repairs)
  repairEnum(
    config,
    'colorScheme',
    COLOR_SCHEMES.map((scheme) => scheme.id),
    DEFAULT_APP_CONFIG.colorScheme,
    repairs,
  )
  repairEnum(config, 'updateChannel', UPDATE_CHANNELS, DEFAULT_APP_CONFIG.updateChannel, repairs)
  repairEnum(config, 'logLevel', LOG_LEVELS, DEFAULT_APP_CONFIG.logLevel, repairs)
  repairEnum(config, 'fileAllocation', FILE_ALLOCATION_OPTIONS, DEFAULT_APP_CONFIG.fileAllocation, repairs)

  config.rpcListenPort = normalizePort(config.rpcListenPort, DEFAULT_APP_CONFIG.rpcListenPort, 'rpcListenPort', repairs)
  config.extensionApiPort = normalizePort(
    config.extensionApiPort,
    DEFAULT_APP_CONFIG.extensionApiPort,
    'extensionApiPort',
    repairs,
  )
  config.listenPort = normalizePort(config.listenPort, DEFAULT_APP_CONFIG.listenPort, 'listenPort', repairs)
  config.dhtListenPort = normalizePort(config.dhtListenPort, DEFAULT_APP_CONFIG.dhtListenPort, 'dhtListenPort', repairs)
  config.ed2kListenPort = normalizePort(
    config.ed2kListenPort,
    DEFAULT_APP_CONFIG.ed2kListenPort,
    'ed2kListenPort',
    repairs,
  )
  config.ed2kUdpListenPort = normalizePort(
    config.ed2kUdpListenPort,
    DEFAULT_APP_CONFIG.ed2kUdpListenPort,
    'ed2kUdpListenPort',
    repairs,
  )

  config.split = normalizePositiveNumber(config.split, DEFAULT_APP_CONFIG.split, 'split', repairs)
  config.maxConcurrentDownloads = normalizePositiveNumber(
    config.maxConcurrentDownloads,
    DEFAULT_APP_CONFIG.maxConcurrentDownloads,
    'maxConcurrentDownloads',
    repairs,
  )
  config.maxConnectionPerServer = normalizePositiveNumber(
    config.maxConnectionPerServer,
    DEFAULT_APP_CONFIG.maxConnectionPerServer,
    'maxConnectionPerServer',
    repairs,
  )
  config.btMaxPeers = normalizePositiveNumber(config.btMaxPeers, DEFAULT_APP_CONFIG.btMaxPeers, 'btMaxPeers', repairs)
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * Converts a partial persisted config into a complete, runtime-safe AppConfig.
 *
 * Migrations handle semantic schema changes. Hydration handles default
 * materialization and defensive repair for malformed persisted values.
 */
export function hydrateAppConfig(saved?: Partial<AppConfig> | null): HydratedAppConfig {
  const defaults = clonePlain(DEFAULT_APP_CONFIG) as AppConfig
  const input = saved && isRecord(saved) ? (clonePlain(saved) as Partial<AppConfig>) : null
  const migration = input
    ? runMigrations(input)
    : { migrated: false, targetVersion: DEFAULT_APP_CONFIG.configVersion, errors: [] }
  const merged = { ...defaults, ...(input ?? {}) } as AppConfig
  const repairs: string[] = []
  const record = merged as Record<string, unknown>

  merged.proxy = normalizeProxy(input?.proxy ?? merged.proxy, repairs)
  merged.protocols = normalizeProtocols(input?.protocols ?? merged.protocols)
  merged.clipboard = normalizeClipboard(input?.clipboard ?? merged.clipboard)
  merged.portConflictRecovery = normalizePortRecovery(
    input?.portConflictRecovery ?? merged.portConflictRecovery,
    repairs,
  )

  normalizeScalarValues(record, repairs)

  if (input && !('rpcSecret' in input)) {
    delete record.rpcSecret
  }
  if (input && !('extensionApiSecret' in input)) {
    delete record.extensionApiSecret
  }

  return {
    config: merged,
    migration,
    repairs: dedupe(repairs),
    shouldPersist: migration.migrated || repairs.length > 0,
  }
}
