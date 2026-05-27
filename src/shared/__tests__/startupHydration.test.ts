/**
 * @fileoverview Structural tests for startup preference hydration.
 *
 * User preferences must be loaded before Vue mounts so root-level theme,
 * color-scheme, and locale watchers see persisted values on first render.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const SRC_ROOT = path.resolve(__dirname, '../../..')

describe('main.ts — startup hydration ordering', () => {
  let mainSource: string

  beforeAll(() => {
    mainSource = fs.readFileSync(path.join(SRC_ROOT, 'src', 'main.ts'), 'utf-8')
  })

  it('loads preferences before mounting Vue', () => {
    const loadIdx = mainSource.indexOf('await preferenceStore.loadPreference()')
    const mountIdx = mainSource.indexOf("app.mount('#app')")

    expect(loadIdx).toBeGreaterThanOrEqual(0)
    expect(mountIdx).toBeGreaterThanOrEqual(0)
    expect(loadIdx).toBeLessThan(mountIdx)
  })

  it('applies locale before mounting Vue', () => {
    const localeIdx = mainSource.indexOf('setI18nLocale(i18n, resolvedLocale)')
    const mountIdx = mainSource.indexOf("app.mount('#app')")

    expect(localeIdx).toBeGreaterThanOrEqual(0)
    expect(mountIdx).toBeGreaterThanOrEqual(0)
    expect(localeIdx).toBeLessThan(mountIdx)
  })

  it('keeps runtime engine startup after Vue mount', () => {
    const mountIdx = mainSource.indexOf("app.mount('#app')")
    const engineIdx = mainSource.indexOf('const enginePromise = initEngine')

    expect(mountIdx).toBeGreaterThanOrEqual(0)
    expect(engineIdx).toBeGreaterThanOrEqual(0)
    expect(mountIdx).toBeLessThan(engineIdx)
  })
})
