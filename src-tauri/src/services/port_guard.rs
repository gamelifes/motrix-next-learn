//! Automatic local port conflict recovery.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeSet;
use std::net::{TcpListener, UdpSocket};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PortKind {
    Rpc,
    ExtensionApi,
    Bt,
    Dht,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PortRange {
    start: u16,
    end: u16,
}

const ENGINE_PORT_KINDS: [PortKind; 3] = [PortKind::Rpc, PortKind::Bt, PortKind::Dht];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PortSwitch {
    kind: PortKind,
    old_port: u16,
    new_port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PortSwitchFailureReason {
    Disabled,
    NoAvailablePort,
    BindFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PortSwitchFailureSource {
    Startup,
    BtRuntime,
    ExtensionApi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PortSwitchFailure {
    kind: PortKind,
    port: u16,
    reason: PortSwitchFailureReason,
    source: PortSwitchFailureSource,
}

fn range_for(kind: PortKind) -> PortRange {
    match kind {
        PortKind::Rpc | PortKind::ExtensionApi => PortRange {
            start: 16800,
            end: 19999,
        },
        PortKind::Bt => PortRange {
            start: 20000,
            end: 24999,
        },
        PortKind::Dht => PortRange {
            start: 25000,
            end: 29999,
        },
    }
}

pub(crate) fn aria2_bt_bind_error_line(line: &str) -> bool {
    line.contains("failed to bind TCP port")
        || line.contains("failed to bind UDP port")
        || line.contains("Errors occurred while binding port")
}

fn auto_switch_enabled(app: &AppHandle) -> bool {
    app.store("config.json")
        .ok()
        .and_then(|s| s.get("preferences"))
        .and_then(|p| p.get("autoChangeConflictingPorts")?.as_bool())
        .unwrap_or(true)
}

fn choose_available_port(kind: PortKind, reserved: &BTreeSet<u16>) -> Option<u16> {
    let range = range_for(kind);
    (range.start..=range.end).find(|port| !reserved.contains(port) && port_available(*port))
}

pub(crate) fn reconcile_engine_ports(app: &AppHandle) -> Result<Vec<PortSwitch>, AppError> {
    let prefs_store = app
        .store("config.json")
        .map_err(|e| AppError::Store(format!("Failed to open config.json: {e}")))?;
    let system_store = app
        .store("system.json")
        .map_err(|e| AppError::Store(format!("Failed to open system.json: {e}")))?;

    let mut prefs = prefs_store.get("preferences").unwrap_or_else(|| json!({}));
    let current = PortSnapshot::from_preferences(&prefs);
    let mut reserved = current.all_ports();
    let mut next = current;
    let mut switches = Vec::new();
    let auto_switch = auto_switch_enabled(app);

    for kind in ENGINE_PORT_KINDS {
        let port = next.get(kind);
        if port_available(port) {
            continue;
        }
        if !auto_switch {
            emit_failure(
                app,
                PortSwitchFailure {
                    kind,
                    port,
                    reason: PortSwitchFailureReason::Disabled,
                    source: PortSwitchFailureSource::Startup,
                },
            );
            continue;
        }
        reserved.remove(&port);
        let Some(new_port) = choose_available_port(kind, &reserved) else {
            emit_failure(
                app,
                PortSwitchFailure {
                    kind,
                    port,
                    reason: PortSwitchFailureReason::NoAvailablePort,
                    source: PortSwitchFailureSource::Startup,
                },
            );
            return Err(AppError::Engine(format!("No available port for {kind:?}")));
        };
        reserved.insert(new_port);
        next.set(kind, new_port);
        switches.push(PortSwitch {
            kind,
            old_port: port,
            new_port,
        });
    }

    if switches.is_empty() {
        return Ok(Vec::new());
    }

    persist_snapshot(&prefs_store, &system_store, &mut prefs, next)?;
    emit_switches(app, &switches);
    Ok(switches)
}

pub(crate) fn reconcile_bt_ports(app: &AppHandle) -> Result<Vec<PortSwitch>, AppError> {
    if !auto_switch_enabled(app) {
        let prefs_store = app
            .store("config.json")
            .map_err(|e| AppError::Store(format!("Failed to open config.json: {e}")))?;
        let prefs = prefs_store.get("preferences").unwrap_or_else(|| json!({}));
        let current = PortSnapshot::from_preferences(&prefs);
        emit_failure(
            app,
            PortSwitchFailure {
                kind: PortKind::Bt,
                port: current.bt,
                reason: PortSwitchFailureReason::Disabled,
                source: PortSwitchFailureSource::BtRuntime,
            },
        );
        return Ok(Vec::new());
    }

    let prefs_store = app
        .store("config.json")
        .map_err(|e| AppError::Store(format!("Failed to open config.json: {e}")))?;
    let system_store = app
        .store("system.json")
        .map_err(|e| AppError::Store(format!("Failed to open system.json: {e}")))?;

    let mut prefs = prefs_store.get("preferences").unwrap_or_else(|| json!({}));
    let current = PortSnapshot::from_preferences(&prefs);
    let mut reserved = current.all_ports();
    let mut next = current;
    let mut switches = Vec::new();

    for kind in [PortKind::Bt, PortKind::Dht] {
        let old_port = next.get(kind);
        reserved.remove(&old_port);
        let Some(new_port) = choose_available_port(kind, &reserved) else {
            emit_failure(
                app,
                PortSwitchFailure {
                    kind,
                    port: old_port,
                    reason: PortSwitchFailureReason::NoAvailablePort,
                    source: PortSwitchFailureSource::BtRuntime,
                },
            );
            return Err(AppError::Engine(format!("No available port for {kind:?}")));
        };
        reserved.insert(new_port);
        next.set(kind, new_port);
        switches.push(PortSwitch {
            kind,
            old_port,
            new_port,
        });
    }

    persist_snapshot(&prefs_store, &system_store, &mut prefs, next)?;
    emit_switches(app, &switches);
    Ok(switches)
}

pub(crate) async fn recover_extension_api_port(
    app: &AppHandle,
    old_port: u16,
) -> Result<u16, AppError> {
    if !auto_switch_enabled(app) {
        emit_failure(
            app,
            PortSwitchFailure {
                kind: PortKind::ExtensionApi,
                port: old_port,
                reason: PortSwitchFailureReason::Disabled,
                source: PortSwitchFailureSource::ExtensionApi,
            },
        );
        return Err(AppError::Io(format!(
            "Failed to bind HTTP API on port {old_port}"
        )));
    }

    let prefs_store = app
        .store("config.json")
        .map_err(|e| AppError::Store(format!("Failed to open config.json: {e}")))?;
    let system_store = app
        .store("system.json")
        .map_err(|e| AppError::Store(format!("Failed to open system.json: {e}")))?;

    let mut prefs = prefs_store.get("preferences").unwrap_or_else(|| json!({}));
    let mut snapshot = PortSnapshot::from_preferences(&prefs);
    let mut reserved = snapshot.all_ports();
    reserved.remove(&old_port);
    let Some(new_port) = choose_available_port(PortKind::ExtensionApi, &reserved) else {
        emit_failure(
            app,
            PortSwitchFailure {
                kind: PortKind::ExtensionApi,
                port: old_port,
                reason: PortSwitchFailureReason::NoAvailablePort,
                source: PortSwitchFailureSource::ExtensionApi,
            },
        );
        return Err(AppError::Engine("No available extension API port".into()));
    };

    snapshot.extension_api = new_port;
    persist_snapshot(&prefs_store, &system_store, &mut prefs, snapshot)?;
    emit_switches(
        app,
        &[PortSwitch {
            kind: PortKind::ExtensionApi,
            old_port,
            new_port,
        }],
    );
    Ok(new_port)
}

pub(crate) fn emit_bind_failed(
    app: &AppHandle,
    kind: PortKind,
    port: u16,
    source: PortSwitchFailureSource,
) {
    emit_failure(
        app,
        PortSwitchFailure {
            kind,
            port,
            reason: PortSwitchFailureReason::BindFailed,
            source,
        },
    );
}

#[derive(Debug, Clone, Copy)]
struct PortSnapshot {
    rpc: u16,
    extension_api: u16,
    bt: u16,
    dht: u16,
}

impl PortSnapshot {
    fn from_preferences(prefs: &serde_json::Value) -> Self {
        Self {
            rpc: read_u16(prefs, "rpcListenPort", 16800),
            extension_api: read_u16(prefs, "extensionApiPort", 16801),
            bt: read_u16(prefs, "listenPort", 21301),
            dht: read_u16(prefs, "dhtListenPort", 26701),
        }
    }

    fn all_ports(self) -> BTreeSet<u16> {
        BTreeSet::from([self.rpc, self.extension_api, self.bt, self.dht])
    }

    fn get(self, kind: PortKind) -> u16 {
        match kind {
            PortKind::Rpc => self.rpc,
            PortKind::ExtensionApi => self.extension_api,
            PortKind::Bt => self.bt,
            PortKind::Dht => self.dht,
        }
    }

    fn set(&mut self, kind: PortKind, port: u16) {
        match kind {
            PortKind::Rpc => self.rpc = port,
            PortKind::ExtensionApi => self.extension_api = port,
            PortKind::Bt => self.bt = port,
            PortKind::Dht => self.dht = port,
        }
    }
}

fn read_u16(prefs: &serde_json::Value, key: &str, fallback: u16) -> u16 {
    prefs
        .get(key)
        .and_then(|v| {
            v.as_u64()
                .map(|n| n as u16)
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .unwrap_or(fallback)
}

fn persist_snapshot<R: tauri::Runtime>(
    prefs_store: &tauri_plugin_store::Store<R>,
    system_store: &tauri_plugin_store::Store<R>,
    prefs: &mut serde_json::Value,
    snapshot: PortSnapshot,
) -> Result<(), AppError> {
    let obj = prefs
        .as_object_mut()
        .ok_or_else(|| AppError::Store("preferences must be an object".into()))?;

    obj.insert("rpcListenPort".into(), json!(snapshot.rpc));
    obj.insert("extensionApiPort".into(), json!(snapshot.extension_api));
    obj.insert("listenPort".into(), json!(snapshot.bt));
    obj.insert("dhtListenPort".into(), json!(snapshot.dht));
    obj.insert("autoChangeConflictingPorts".into(), json!(true));

    prefs_store.set("preferences", prefs.clone());
    prefs_store
        .save()
        .map_err(|e| AppError::Store(format!("Failed to save config.json: {e}")))?;

    system_store.set("rpc-listen-port", json!(snapshot.rpc.to_string()));
    system_store.set("listen-port", json!(snapshot.bt.to_string()));
    system_store.set("dht-listen-port", json!(snapshot.dht.to_string()));
    system_store
        .save()
        .map_err(|e| AppError::Store(format!("Failed to save system.json: {e}")))?;

    Ok(())
}

fn emit_switches(app: &AppHandle, switches: &[PortSwitch]) {
    if switches.is_empty() {
        return;
    }
    log::warn!("port_guard:auto-switched ports={switches:?}");
    let _ = app.emit("port-auto-switched", switches);
}

fn emit_failure(app: &AppHandle, failure: PortSwitchFailure) {
    log::warn!("port_guard:auto-switch failed={failure:?}");
    let _ = app.emit("port-auto-switch-failed", failure);
}

fn port_available(port: u16) -> bool {
    tcp_available(port) && udp_available(port)
}

fn tcp_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn udp_available(port: u16) -> bool {
    UdpSocket::bind(("127.0.0.1", port)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_ranges_match_exposed_settings() {
        assert_eq!(
            range_for(PortKind::Rpc),
            PortRange {
                start: 16800,
                end: 19999
            }
        );
        assert_eq!(range_for(PortKind::ExtensionApi), range_for(PortKind::Rpc));
        assert_eq!(
            range_for(PortKind::Bt),
            PortRange {
                start: 20000,
                end: 24999
            }
        );
        assert_eq!(
            range_for(PortKind::Dht),
            PortRange {
                start: 25000,
                end: 29999
            }
        );
    }

    #[test]
    fn engine_port_reconciliation_excludes_extension_api() {
        assert_eq!(
            ENGINE_PORT_KINDS,
            [PortKind::Rpc, PortKind::Bt, PortKind::Dht]
        );
        assert!(!ENGINE_PORT_KINDS.contains(&PortKind::ExtensionApi));
    }

    #[test]
    fn choose_available_port_skips_reserved_ports() {
        let range = range_for(PortKind::Bt);
        let reserved = BTreeSet::from([range.start]);

        let chosen = choose_available_port(PortKind::Bt, &reserved).expect("available BT port");

        assert_ne!(chosen, range.start);
        assert!(chosen >= range.start);
        assert!(chosen <= range.end);
    }

    #[test]
    fn choose_available_port_rejects_tcp_conflicts() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral TCP port");
        let occupied = listener.local_addr().expect("local addr").port();
        let reserved = BTreeSet::new();

        if occupied >= range_for(PortKind::Rpc).start && occupied <= range_for(PortKind::Rpc).end {
            let chosen =
                choose_available_port(PortKind::Rpc, &reserved).expect("available RPC port");
            assert_ne!(chosen, occupied);
        }
    }

    #[test]
    fn aria2_bt_bind_error_line_detects_runtime_bt_port_failures() {
        assert!(aria2_bt_bind_error_line(
            "05/14 10:24:11 [ERROR] IPv4 BitTorrent: failed to bind TCP port 21301"
        ));
        assert!(aria2_bt_bind_error_line(
            "Exception: [BtSetup.cc:212] errorCode=1 Errors occurred while binding port."
        ));
        assert!(!aria2_bt_bind_error_line(
            "05/14 10:24:11 [NOTICE] IPv4 RPC: listening on TCP port 16800"
        ));
    }
}
