import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..')

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf-8')
}

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endNeedle, start + startNeedle.length)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('port auto-switch coverage', () => {
  it('returns the actual extension API port after bind recovery', () => {
    const commandSource = readProjectFile('src-tauri/src/commands/http_api.rs')
    const serviceSource = readProjectFile('src-tauri/src/services/http_api.rs')

    expect(commandSource).toContain(
      'pub async fn restart_http_api(app: tauri::AppHandle, port: u16) -> Result<u16, AppError>',
    )
    expect(serviceSource).toContain(
      'pub async fn restart_on_port(app: &AppHandle, new_port: u16) -> Result<u16, AppError>',
    )
    expect(serviceSource).toContain('let port = handle.port();')
    expect(serviceSource).toContain('Ok(port)')
  })

  it('does not perform duplicate extension API recovery in runtime service startup', () => {
    const source = readProjectFile('src-tauri/src/services/mod.rs')
    const httpApiBlock = sliceBetween(
      source,
      'let desired_port = http_api::read_extension_api_port(app).await;',
      'log::info!("runtime_services: spawned',
    )

    expect(httpApiBlock).toContain('http_api::restart_on_port(app, desired_port).await')
    expect(httpApiBlock).not.toContain('recover_extension_api_port')
  })

  it('keeps extension API port recovery out of the engine restart lifecycle', () => {
    const source = readProjectFile('src-tauri/src/services/port_guard.rs')
    expect(source).toMatch(
      /const ENGINE_PORT_KINDS: \[PortKind; 5\]\s*=\s*\[\s*PortKind::Rpc,\s*PortKind::Bt,\s*PortKind::Dht,\s*PortKind::Ed2k,\s*PortKind::Ed2kUdp,?\s*\];/,
    )
    const enginePortBlock = sliceBetween(
      source,
      'pub(crate) fn reconcile_engine_ports(app: &AppHandle) -> Result<Vec<PortSwitch>, AppError>',
      'pub(crate) fn reconcile_bt_ports(app: &AppHandle) -> Result<Vec<PortSwitch>, AppError>',
    )

    expect(enginePortBlock).toContain('for kind in ENGINE_PORT_KINDS')
    expect(enginePortBlock).not.toContain('PortKind::ExtensionApi')
  })

  it('syncs preferences from disk after backend startup port reconciliation', () => {
    const storeSource = readProjectFile('src/stores/preference.ts')
    const mainSource = readProjectFile('src/main.ts')

    expect(storeSource).toContain('async function reloadPreferenceFromDisk()')
    expect(storeSource).toContain('reloadPreferenceFromDisk,')
    expect(mainSource).toContain('await preferenceStore.reloadPreferenceFromDisk()')
  })

  it('updates the active advanced form when extension API recovery chooses a fallback port', () => {
    const source = readProjectFile('src/components/preference/Advanced.vue')

    expect(source).toContain("const appliedPort = await invoke<number>('restart_http_api', { port: newPort })")
    expect(source).toContain('f.extensionApiPort = appliedPort')
    expect(source).toContain('preferenceStore.updatePreference({ extensionApiPort: appliedPort })')
    expect(source).toContain("message.success(t('preferences.extension-api-port-applied', { port: appliedPort }))")
  })

  it('emits a unified failure event when automatic port switching cannot recover', () => {
    const portGuardSource = readProjectFile('src-tauri/src/services/port_guard.rs')
    const appEventsSource = readProjectFile('src/composables/useAppEvents.ts')

    expect(portGuardSource).toContain('PortSwitchFailureReason')
    expect(portGuardSource).toContain('port-auto-switch-failed')
    expect(appEventsSource).toContain("listen<PortSwitchFailureEvent>('port-auto-switch-failed'")
    expect(appEventsSource).toContain("t('preferences.port-auto-switch-disabled'")
    expect(appEventsSource).toContain("t('preferences.port-auto-switch-no-available-port'")
    expect(appEventsSource).toContain("t('preferences.port-auto-switch-bind-failed'")
  })
})
