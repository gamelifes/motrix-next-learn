//! Engine management for the bundled Motrix Next engine sidecar.
//!
//! Split into focused sub-modules:
//! - [`state`] — `EngineState` struct, ANSI stripping, log routing
//! - [`lifecycle`] — `start_engine`, `stop_engine`, `restart_engine`
//! - [`args`] — CLI argument builder for aria2c
//! - [`cleanup`] — Port cleanup and process identification

mod args;
mod cleanup;
mod lifecycle;
mod state;

pub use lifecycle::{restart_engine, start_engine, stop_engine};
pub(crate) use state::path_to_safe_string;
pub use state::EngineState;
