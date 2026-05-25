//! Engine management for the bundled Motrix Next engine sidecar.
//!
//! Split into focused sub-modules:
//! - [`state`] — `EngineState` struct, ANSI stripping, log routing
//! - [`lifecycle`] — `start_engine`, `stop_engine`, `restart_engine`
//! - [`args`] — CLI argument builder for Aria2 Next
//! - [`cleanup`] — Port cleanup and process identification

mod args;
mod cleanup;
mod lifecycle;
mod state;

pub(crate) use args::SUPPORTED_ENGINE_KEYS;
pub use lifecycle::{restart_engine, start_engine, stop_engine};
pub(crate) use state::path_to_safe_string;
pub use state::EngineState;
