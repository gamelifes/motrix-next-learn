/**
 * @fileoverview Pure functions for the ED2K preference tab.
 *
 * ED2K uses server endpoints, server.met, nodes.dat, and shared files.
 * These options are Aria2 Next startup options, so changes require an engine
 * restart instead of hot reloading through changeGlobalOption.
 */
import type { AppConfig } from '@shared/types'
import { DEFAULT_APP_CONFIG as D } from '@shared/constants'
import { convertCommaToLine, convertLineToComma, generateRandomInt } from '@shared/utils'

export const ED2K_SEARCH_POLL_INTERVAL_MS = 1000
export const ED2K_SEARCH_MAX_DURATION_MS = 90000
export const ED2K_SEARCH_MIN_TIMEOUT_SECONDS = 10
export const ED2K_SEARCH_MAX_TIMEOUT_SECONDS = 600

export type Ed2kSearchOutcome = 'completed' | 'cancelled' | 'failed'

export interface Ed2kForm {
  [key: string]: unknown
  ed2kListenPort: number
  ed2kServer: string
  ed2kServerList: string
  ed2kNodeList: string
  ed2kUploadSlots: number
  ed2kShareFiles: string
  ed2kSearchTimeout: number
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinLines(value: string): string {
  return splitLines(value).join('\n')
}

function normalizePathLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function buildEd2kForm(config: AppConfig): Ed2kForm {
  return {
    ed2kListenPort: Number(config.ed2kListenPort ?? D.ed2kListenPort),
    ed2kServer: convertCommaToLine(config.ed2kServer ?? D.ed2kServer),
    ed2kServerList: config.ed2kServerList ?? D.ed2kServerList,
    ed2kNodeList: config.ed2kNodeList ?? D.ed2kNodeList,
    ed2kUploadSlots: Number(config.ed2kUploadSlots ?? D.ed2kUploadSlots),
    ed2kShareFiles: (config.ed2kShareFiles ?? D.ed2kShareFiles).join('\n'),
    ed2kSearchTimeout: Number(config.ed2kSearchTimeout ?? D.ed2kSearchTimeout),
  }
}

export function buildEd2kSystemConfig(f: Ed2kForm): Record<string, string> {
  return {
    'ed2k-listen-port': String(f.ed2kListenPort),
    'ed2k-server': convertLineToComma(joinLines(f.ed2kServer)),
    'ed2k-server-list': String(f.ed2kServerList).trim(),
    'ed2k-node-list': String(f.ed2kNodeList).trim(),
    'ed2k-upload-slots': String(f.ed2kUploadSlots),
    'ed2k-share-file': normalizePathLines(f.ed2kShareFiles).join('\n'),
  }
}

export function transformEd2kForStore(f: Ed2kForm): Partial<AppConfig> {
  return {
    ed2kListenPort: Number(f.ed2kListenPort),
    ed2kServer: convertLineToComma(joinLines(f.ed2kServer)),
    ed2kServerList: String(f.ed2kServerList).trim(),
    ed2kNodeList: String(f.ed2kNodeList).trim(),
    ed2kUploadSlots: Number(f.ed2kUploadSlots),
    ed2kShareFiles: normalizePathLines(f.ed2kShareFiles),
    ed2kSearchTimeout: Number(f.ed2kSearchTimeout),
  }
}

export function validateServerLines(value: string): boolean {
  return splitLines(value).every((line) => {
    const separator = line.lastIndexOf(':')
    if (separator <= 0 || separator === line.length - 1) return false
    const host = line.slice(0, separator).trim()
    const port = Number(line.slice(separator + 1))
    return !!host && Number.isInteger(port) && port > 0 && port <= 65535
  })
}

export function validateEd2kForm(f: Ed2kForm): string | null {
  if (!Number.isInteger(f.ed2kListenPort) || f.ed2kListenPort < 0 || f.ed2kListenPort > 65535) {
    return 'preferences.ed2k-invalid-listen-port'
  }
  if (!Number.isInteger(f.ed2kUploadSlots) || f.ed2kUploadSlots < 1 || f.ed2kUploadSlots > 100) {
    return 'preferences.ed2k-invalid-upload-slots'
  }
  if (
    !Number.isInteger(f.ed2kSearchTimeout) ||
    f.ed2kSearchTimeout < ED2K_SEARCH_MIN_TIMEOUT_SECONDS ||
    f.ed2kSearchTimeout > ED2K_SEARCH_MAX_TIMEOUT_SECONDS
  ) {
    return 'preferences.ed2k-invalid-search-timeout'
  }
  if (!validateServerLines(f.ed2kServer)) {
    return 'preferences.ed2k-invalid-server'
  }
  return null
}

export function randomEd2kPort(): number {
  return generateRandomInt(30000, 34999)
}

export function getEd2kSearchToastKey(outcome: Ed2kSearchOutcome, resultCount: number): string {
  if (outcome === 'cancelled') {
    return resultCount > 0 ? 'preferences.ed2k-search-cancelled-with-results' : 'preferences.ed2k-search-cancelled'
  }
  if (outcome === 'failed') return 'preferences.ed2k-search-failed'
  return resultCount > 0 ? 'preferences.ed2k-search-completed' : 'preferences.ed2k-search-empty'
}

export interface Ed2kSearchPollState {
  elapsedMs: number
  resultCount: number
  previousResultCount: number
  stablePolls: number
  moreResults?: boolean
  maxDurationMs?: number
}

export function shouldFinishEd2kSearchPoll(state: Ed2kSearchPollState): boolean {
  return state.elapsedMs >= (state.maxDurationMs ?? ED2K_SEARCH_MAX_DURATION_MS)
}
