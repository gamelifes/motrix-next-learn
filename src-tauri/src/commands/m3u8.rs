//! M3U8 HLS playlist merging command.
//!
//! Frontend flow: download m3u8 playlist text → resolve segment URLs →
//! submit one aria2 task per segment (with `dir` = tempDir, no `out` so
//! aria2 uses each segment's URL basename) → wait for all segments to
//! complete → call `merge_m3u8_segments` here to concat them via ffmpeg
//! into a single MP4 and remove the temp directory.
//!
//! This command is **synchronous** from the frontend's perspective: it
//! blocks until ffmpeg finishes (typically <1s per 100MB of TS) and
//! returns the final output path. Failures preserve the temp directory
//! so the user can manually retry (see AGENTS.md A″).

use crate::error::AppError;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows `CREATE_NO_WINDOW` flag — prevents a console window from popping
/// up when spawning child processes. Required for headless ffmpeg merges.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Parameters for `merge_m3u8_segments`.
///
/// All paths are absolute, native-separated. Tauri IPC delivers camelCase
/// JSON keys (Tauri auto-converts to snake_case on the Rust side).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeM3u8SegmentsParams {
    /// Directory containing downloaded `.ts` files (one per segment). Must
    /// exist and contain at least one `.ts` file.
    pub temp_dir: String,
    /// Absolute path of the final merged MP4. Parent directory must exist.
    pub final_path: String,
    /// Absolute path to the user-configured ffmpeg executable.
    pub ffmpeg_path: String,
    /// Ordered list of segment filenames (relative to `temp_dir`) in
    /// playlist order. When provided, segments are concatenated in this
    /// exact order instead of lexicographic filesystem order.
    #[serde(default)]
    pub segment_files: Vec<String>,
    /// Whether to remove the temp directory after a successful merge. The
    /// frontend forwards the user's `m3u8.autoCleanup` preference; `false`
    /// keeps the `.ts` sources for manual inspection.
    #[serde(default = "default_true")]
    pub cleanup: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeM3u8SegmentsResult {
    /// Absolute path of the produced file (== params.final_path on success).
    pub final_path: String,
    /// Number of `.ts` segments that were concatenated.
    pub segment_count: usize,
}

/// Validates preconditions without launching ffmpeg. Split out so unit
/// tests can exercise the parser/validator without spawning processes.
///
/// When `segment_files` is non-empty, segments are resolved in playlist
/// order (the provided filenames are joined to `temp_dir` and each must
/// exist). Otherwise falls back to reading the directory and sorting
/// lexicographically — kept for backward compatibility and tests.
fn collect_and_validate_segments(
    temp_dir: &Path,
    segment_files: &[String],
) -> Result<Vec<PathBuf>, AppError> {
    if !temp_dir.is_dir() {
        return Err(AppError::M3u8(format!(
            "temp_dir is not a directory: {}",
            temp_dir.display()
        )));
    }

    if !segment_files.is_empty() {
        // Playlist-order path: resolve each filename relative to temp_dir.
        let mut segments = Vec::with_capacity(segment_files.len());
        for name in segment_files {
            let path = temp_dir.join(name);
            if !path.is_file() {
                return Err(AppError::M3u8(format!(
                    "segment file not found: {}",
                    path.display()
                )));
            }
            segments.push(path);
        }
        return Ok(segments);
    }

    // Fallback: read directory and sort lexicographically (for tests / legacy).
    let mut segments: Vec<PathBuf> = std::fs::read_dir(temp_dir)
        .map_err(|e| AppError::Io(format!("read_dir({}): {e}", temp_dir.display())))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|p| p.is_file())
        .filter(|p| {
            p.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("ts"))
                .unwrap_or(false)
        })
        .collect();
    segments.sort();
    if segments.is_empty() {
        return Err(AppError::M3u8(format!(
            "no .ts segments found in {}",
            temp_dir.display()
        )));
    }
    Ok(segments)
}

/// Writes the ffmpeg concat demuxer filelist to disk and returns its path.
fn write_filelist(temp_dir: &Path, segments: &[PathBuf]) -> Result<PathBuf, AppError> {
    let list_path = temp_dir.join("filelist.txt");
    let mut content = String::new();
    for seg in segments {
        // ffmpeg concat demuxer requires:
        //   file '<path>'          ← single-quoted absolute path
        //   ...or
        //   file <path>            ← unquoted (no spaces)
        // We always single-quote to handle Windows paths with spaces,
        // single quotes inside paths, etc. — single quotes inside paths
        // are escaped as `'\''` per the spec.
        let seg_str = seg.to_string_lossy();
        let escaped = seg_str.replace('\'', "'\\''");
        content.push_str(&format!("file '{escaped}'\n"));
    }
    std::fs::write(&list_path, content)
        .map_err(|e| AppError::Io(format!("write filelist.txt: {e}")))?;
    log::info!(
        "merge_m3u8_segments: wrote {} entries to {}",
        segments.len(),
        list_path.display()
    );
    Ok(list_path)
}

/// Run ffmpeg to concatenate the segments into the final path.
///
/// Returns `Ok(())` on exit code 0; otherwise returns the trimmed stderr
/// so the frontend can show a meaningful error.
fn run_ffmpeg_concat(
    ffmpeg_path: &str,
    filelist: &Path,
    final_path: &Path,
) -> Result<(), AppError> {
    let mut cmd = Command::new(ffmpeg_path);
    cmd.args([
        "-y", // overwrite output without prompting
        "-f", "concat", "-safe", "0", "-i",
    ])
    .arg(filelist)
    .args(["-c", "copy"]) // remux only, no re-encode
    .arg(final_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .map_err(|e| AppError::Ffmpeg(format!("failed to spawn ffmpeg: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let code = output.status.code().unwrap_or(-1);
        return Err(AppError::Ffmpeg(format!(
            "ffmpeg exited with code {code}: {}",
            if stderr.is_empty() {
                "<no stderr>"
            } else {
                &stderr
            }
        )));
    }
    log::info!(
        "merge_m3u8_segments: ffmpeg ok output={}",
        final_path.display()
    );
    Ok(())
}

/// Remove the temp directory and all its contents (segments + filelist.txt).
///
/// Best-effort: if removal fails (e.g. a file is still being held open by
/// another process) we log a warning and return Ok. The frontend will
/// surface the leftover directory to the user via the "temp dir retained"
/// UI affordance.
fn remove_temp_dir(temp_dir: &Path) {
    match std::fs::remove_dir_all(temp_dir) {
        Ok(()) => log::info!(
            "merge_m3u8_segments: removed temp_dir {}",
            temp_dir.display()
        ),
        Err(e) => log::warn!(
            "merge_m3u8_segments: failed to remove temp_dir {}: {e}",
            temp_dir.display()
        ),
    }
}

/// Frontend entry point. See module docs for the full flow.
#[tauri::command]
pub async fn merge_m3u8_segments(
    params: MergeM3u8SegmentsParams,
) -> Result<MergeM3u8SegmentsResult, AppError> {
    let temp_dir = PathBuf::from(&params.temp_dir);
    let final_path = PathBuf::from(&params.final_path);

    if params.ffmpeg_path.trim().is_empty() {
        return Err(AppError::Ffmpeg("ffmpeg_path is empty".into()));
    }
    if !Path::new(&params.ffmpeg_path).exists() {
        return Err(AppError::Ffmpeg(format!(
            "ffmpeg_path does not exist: {}",
            params.ffmpeg_path
        )));
    }
    if let Some(parent) = final_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(AppError::Io(format!(
                "final_path parent directory does not exist: {}",
                parent.display()
            )));
        }
    }

    let segments = collect_and_validate_segments(&temp_dir, &params.segment_files)?;
    let filelist = write_filelist(&temp_dir, &segments)?;

    // Run ffmpeg on a blocking thread so the Tauri runtime stays responsive.
    let ffmpeg_path = params.ffmpeg_path.clone();
    let final_for_ffmpeg = final_path.clone();
    let filelist_for_ffmpeg = filelist.clone();
    let join = tokio::task::spawn_blocking(move || {
        run_ffmpeg_concat(&ffmpeg_path, &filelist_for_ffmpeg, &final_for_ffmpeg)
    })
    .await
    .map_err(|e| AppError::Ffmpeg(format!("ffmpeg task panicked: {e}")))?;

    // On failure, leave temp_dir in place so the user can retry manually.
    if let Err(err) = join {
        log::warn!(
            "merge_m3u8_segments: merge failed; preserving temp_dir {} for manual recovery",
            temp_dir.display()
        );
        return Err(err);
    }

    // Cleanup is gated by the user preference; merge failures always
    // preserve temp_dir so the user can retry manually.
    if params.cleanup {
        remove_temp_dir(&temp_dir);
    }
    Ok(MergeM3u8SegmentsResult {
        final_path: crate::engine::path_to_safe_string(&final_path),
        segment_count: segments.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str, body: &[u8]) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, body).expect("write segment");
        p
    }

    #[test]
    fn collect_segments_sorts_alphabetically() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "seg-10.ts", b"x");
        touch(dir.path(), "seg-2.ts", b"x");
        touch(dir.path(), "seg-1.ts", b"x");
        let segs = collect_and_validate_segments(dir.path(), &[]).unwrap();
        let names: Vec<String> = segs
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        // The sort is lexicographic, not numeric — "seg-10" < "seg-2" in
        // ASCII because '1' (0x31) < '2' (0x32). That's fine: the frontend
        // is expected to use zero-padded names so the lex order matches the
        // logical order.
        assert_eq!(names, vec!["seg-1.ts", "seg-10.ts", "seg-2.ts"]);
    }

    #[test]
    fn collect_segments_uses_playlist_order_when_provided() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "seg-10.ts", b"x");
        touch(dir.path(), "seg-2.ts", b"y");
        touch(dir.path(), "seg-1.ts", b"z");
        let segs = collect_and_validate_segments(
            dir.path(),
            &["seg-2.ts".into(), "seg-10.ts".into(), "seg-1.ts".into()],
        )
        .unwrap();
        let names: Vec<String> = segs
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        // Playlist order is preserved exactly.
        assert_eq!(names, vec!["seg-2.ts", "seg-10.ts", "seg-1.ts"]);
    }

    #[test]
    fn collect_segments_skips_non_ts_files() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "ok.ts", b"x");
        touch(dir.path(), "garbage.txt", b"x");
        touch(dir.path(), "control.aria2", b"x");
        let segs = collect_and_validate_segments(dir.path(), &[]).unwrap();
        assert_eq!(segs.len(), 1);
        assert!(segs[0].ends_with("ok.ts"));
    }

    #[test]
    fn collect_segments_rejects_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let err = collect_and_validate_segments(dir.path(), &[]).unwrap_err();
        assert!(matches!(err, AppError::M3u8(_)));
    }

    #[test]
    fn collect_segments_rejects_missing_dir() {
        let err = collect_and_validate_segments(Path::new("/no/such/dir"), &[]).unwrap_err();
        assert!(matches!(err, AppError::M3u8(_)));
    }

    #[test]
    fn collect_segments_rejects_missing_file_in_playlist_order() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "ok.ts", b"x");
        let err = collect_and_validate_segments(dir.path(), &["ok.ts".into(), "missing.ts".into()])
            .unwrap_err();
        assert!(matches!(err, AppError::M3u8(_)));
    }

    #[test]
    fn filelist_format_matches_ffmpeg_concat_demuxer() {
        let dir = tempfile::tempdir().unwrap();
        let s1 = touch(dir.path(), "seg-0.ts", b"a");
        let s2 = touch(dir.path(), "seg-1.ts", b"b");
        let filelist = write_filelist(dir.path(), &[s1.clone(), s2.clone()]).unwrap();
        let content = std::fs::read_to_string(&filelist).unwrap();
        let s1_str = s1.to_string_lossy();
        let s2_str = s2.to_string_lossy();
        assert!(content.contains(&format!("file '{s1_str}'")));
        assert!(content.contains(&format!("file '{s2_str}'")));
        assert!(content.ends_with('\n'));
    }

    #[test]
    fn filelist_escapes_single_quote_in_path() {
        let dir = tempfile::tempdir().unwrap();
        // A filename containing a single quote is rare but ffmpeg requires
        // us to escape per the concat-demuxer spec: `'` → `'\''`.
        let weird = dir.path().join("weird'name.ts");
        std::fs::write(&weird, b"x").unwrap();
        let filelist = write_filelist(dir.path(), std::slice::from_ref(&weird)).unwrap();
        let content = std::fs::read_to_string(&filelist).unwrap();
        let escaped = weird.to_string_lossy().replace('\'', "'\\''");
        assert!(content.contains(&format!("file '{escaped}'")));
    }

    #[test]
    fn cleanup_defaults_to_true_when_absent() {
        // An old frontend (or a stale payload) that omits `cleanup` must
        // still behave as before — i.e. clean up the temp dir by default.
        let params: MergeM3u8SegmentsParams = serde_json::from_value(serde_json::json!({
            "tempDir": "C:/tmp/.motrix-m3u8-test",
            "finalPath": "C:/tmp/out.mp4",
            "ffmpegPath": "C:/ffmpeg/bin/ffmpeg.exe",
        }))
        .unwrap();
        assert!(params.cleanup);
    }

    #[test]
    fn cleanup_respects_explicit_false() {
        let params: MergeM3u8SegmentsParams = serde_json::from_value(serde_json::json!({
            "tempDir": "C:/tmp/.motrix-m3u8-test",
            "finalPath": "C:/tmp/out.mp4",
            "ffmpegPath": "C:/ffmpeg/bin/ffmpeg.exe",
            "cleanup": false,
        }))
        .unwrap();
        assert!(!params.cleanup);
    }
}
