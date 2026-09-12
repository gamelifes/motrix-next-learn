//! One-time data migration from the previous app-data root.
//!
//! When the data root becomes "writable then follow the exe" (see lib.rs
//! Portable-mode detection), an existing install that has been storing
//! everything under %APPDATA%\com.motrix.next would otherwise start with
//! a fresh, empty target folder -- the upgrade would look like
//! "config wiped / history lost".
//!
//! Rules:
//! - Only known data files are copied, nothing else.
//! - Best-effort and non-fatal: a failure on one item never aborts the
//!   remaining items or blocks startup.
//! - The old data is NEVER deleted; it stays as a safety net.
//! - A completion marker is written so the migration runs at most once.

use std::fs;
use std::path::{Path, PathBuf};

use log::{info, warn};

/// Marker file indicating the one-time migration has completed.
pub const MIGRATION_MARKER: &str = ".portable-migrated";

/// Files copied from the old root (existing target files win).
const DATA_FILES: &[&str] = &[
    "config.json",
    "config.json5",
    "history.db",
    "history.db-wal",
    "history.db-shm",
    "download.session",
    "download.session.bak",
    "download.dht.dat",
];

/// Directories copied recursively from the old root.
const DATA_DIRS: &[&str] = &["logs"];

/// Perform the one-time migration. Safe to call repeatedly.
pub fn migrate_once(old_root: &Path, new_root: &Path) {
    if old_root == new_root || !old_root.exists() {
        return;
    }

    if new_root.join(MIGRATION_MARKER).exists() {
        return;
    }

    if let Err(e) = fs::create_dir_all(new_root) {
        warn!(
            "portable migration: cannot create target {}: {e}",
            new_root.display()
        );
        return;
    }

    for file in DATA_FILES {
        let src = old_root.join(file);
        let dst = new_root.join(file);
        if src.is_file() && !dst.exists() {
            match fs::copy(&src, &dst) {
                Ok(_) => info!("portable migration: copied {file}"),
                Err(e) => warn!("portable migration: copy '{file}' failed: {e}"),
            }
        }
    }

    for dir in DATA_DIRS {
        let src = old_root.join(dir);
        let dst = new_root.join(dir);
        if src.is_dir() && !dst.exists() {
            match copy_dir_all(&src, &dst) {
                Ok(_) => info!("portable migration: copied dir {dir}"),
                Err(e) => warn!("portable migration: copy dir '{dir}' failed: {e}"),
            }
        }
    }

    // Marker is best-effort. Even if it fails, already-copied files exist
    // in the target, so a retry cannot overwrite newer user data.
    let _ = fs::write(new_root.join(MIGRATION_MARKER), b"migrated\n");
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_all(&from, &to)?;
        } else if !to.exists() {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    fn unique_root(tag: &str) -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir()
            .join("motrix-portable-migration")
            .join(format!("{tag}-{}-{n}", std::process::id()))
    }

    fn write_file(root: &Path, name: &str, content: &str) {
        let path = root.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn make_old_root() -> (PathBuf, PathBuf) {
        let old = unique_root("old");
        let new = unique_root("new");
        write_file(&old, "config.json", r#"{"preferences":{}}"#);
        write_file(&old, "history.db", "sqlite-bytes");
        write_file(&old, "download.session", "aria2-session");
        write_file(&old.join("logs"), "app.log", "log-line");
        (old, new)
    }

    /// Remove a file, ignoring errors.
    fn try_remove(p: &Path) {
        let _ = fs::remove_file(p);
    }

    fn cleanup(roots: &[&Path]) {
        for r in roots {
            let _ = fs::remove_dir_all(r);
        }
    }

    #[test]
    fn migrates_known_files_once() {
        let (old, new) = make_old_root();
        migrate_once(&old, &new);

        assert!(new.join("config.json").exists());
        assert!(new.join("history.db").exists());
        assert!(new.join("download.session").exists());
        assert!(new.join("logs/app.log").exists());
        assert!(new.join(MIGRATION_MARKER).exists());

        // Old data is never deleted.
        assert!(old.join("config.json").exists());

        cleanup(&[&old, &new]);
    }

    #[test]
    fn marker_prevents_repeat() {
        let (old, new) = make_old_root();
        migrate_once(&old, &new);

        // Re-run after removing a target file: marker must suppress copy.
        fs::remove_file(new.join("config.json")).unwrap();
        migrate_once(&old, &new);
        assert!(
            !new.join("config.json").exists(),
            "no repeat copy after marker"
        );

        cleanup(&[&old, &new]);
    }

    #[test]
    fn never_overwrites_existing_target() {
        let (old, new) = make_old_root();
        write_file(&new, "config.json", r#"{"kept":"existing"}"#);
        migrate_once(&old, &new);

        let kept = fs::read_to_string(new.join("config.json")).unwrap();
        assert!(kept.contains("existing"), "existing target data wins");

        // Cleanup
        cleanup(&[&old, &new]);
    }

    #[test]
    fn missing_old_root_is_noop() {
        let old = unique_root("ghost");
        let new = unique_root("fresh");
        migrate_once(&old, &new);
        assert!(!new.join(MIGRATION_MARKER).exists());
        cleanup(&[&old, &new]);
    }
}
