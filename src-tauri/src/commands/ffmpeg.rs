//! FFmpeg executable detection command.
//!
//! Frontend calls `check_ffmpeg(path)` from the preferences page to verify
//! the user-supplied path is a valid, executable ffmpeg binary. Returns
//! the first line of `ffmpeg -version` output (which contains the version
//! string, e.g. "ffmpeg version 6.1.1 Copyright ...") so the UI can
//! display a confirmation.

use crate::error::AppError;
use std::path::Path;
use std::process::Command;

/// Result returned to the frontend on a successful probe.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegProbeResult {
    /// First line of `ffmpeg -version` stdout (version + copyright header).
    pub version_line: String,
}

/// Probe an ffmpeg executable path.
///
/// Returns the first line of stdout from `ffmpeg -version`. Fails with
/// `AppError::Ffmpeg` when:
/// - `path` is empty
/// - the path does not exist on disk
/// - the file is not executable / not a binary
/// - `ffmpeg -version` exits non-zero
#[tauri::command]
pub async fn check_ffmpeg(path: String) -> Result<FfmpegProbeResult, AppError> {
    if path.trim().is_empty() {
        return Err(AppError::Ffmpeg("path is empty".into()));
    }
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::Ffmpeg(format!("path does not exist: {path}")));
    }
    // Run synchronously inside spawn_blocking — ffmpeg -version completes
    // in <100ms on every platform we ship.
    let path_clone = path.clone();
    let output = tokio::task::spawn_blocking(move || Command::new(&path_clone).arg("-version").output())
        .await
        .map_err(|e| AppError::Ffmpeg(format!("failed to spawn probe task: {e}")))?
        .map_err(|e| AppError::Ffmpeg(format!("failed to execute {path}: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Ffmpeg(format!(
            "ffmpeg -version exited with status {}: {}",
            output.status,
            if stderr.is_empty() { "<no stderr>" } else { &stderr }
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let version_line = stdout
        .lines()
        .next()
        .map(|line| line.trim().to_string())
        .ok_or_else(|| AppError::Ffmpeg("ffmpeg -version produced no output".into()))?;

    if !version_line.to_lowercase().contains("ffmpeg") {
        return Err(AppError::Ffmpeg(format!(
            "binary at {path} does not look like ffmpeg: first line = {version_line:?}"
        )));
    }

    log::info!("check_ffmpeg: ok path={path} version_line={version_line:?}");
    Ok(FfmpegProbeResult { version_line })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn rejects_empty_path() {
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(check_ffmpeg(String::new()));
        assert!(matches!(result, Err(AppError::Ffmpeg(_))));
    }

    #[test]
    fn rejects_nonexistent_path() {
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(check_ffmpeg("/no/such/ffmpeg-binary".to_string()));
        assert!(matches!(result, Err(AppError::Ffmpeg(_))));
    }

    /// Validates the success path by writing a tiny shell script that
    /// mimics `ffmpeg -version` and probing it directly. We use `/bin/sh`
    /// as the interpreter so the test runs on every Unix host CI uses.
    #[cfg(unix)]
    #[test]
    fn accepts_bare_bones_ffmpeg_emulator() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fake = dir.path().join("fake-ffmpeg.sh");
        let mut f = std::fs::File::create(&fake).expect("create fake ffmpeg");
        writeln!(f, "#!/bin/sh\necho 'ffmpeg version 6.1.1 Copyright (c) 2000-2024'").unwrap();
        drop(f);
        std::fs::set_permissions(&fake, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();

        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(check_ffmpeg(fake.to_string_lossy().to_string()))
            .expect("probe should succeed");
        assert!(result.version_line.to_lowercase().contains("ffmpeg"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_binary_that_does_not_look_like_ffmpeg() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fake = dir.path().join("not-ffmpeg.sh");
        let mut f = std::fs::File::create(&fake).expect("create");
        writeln!(f, "#!/bin/sh\necho 'totally unrelated tool 1.0'").unwrap();
        drop(f);
        std::fs::set_permissions(&fake, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();

        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(check_ffmpeg(fake.to_string_lossy().to_string()));
        assert!(matches!(result, Err(AppError::Ffmpeg(_))));
    }
}
