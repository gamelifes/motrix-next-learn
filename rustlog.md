Diff in /home/runner/work/motrix-next-learn/motrix-next-learn/src-tauri/src/commands/ffmpeg.rs:38:

&#x20;    // Run synchronously inside spawn\_blocking — ffmpeg -version completes

&#x20;    // in <100ms on every platform we ship.

&#x20;    let path\_clone = path.clone();

\-    let output = tokio::task::spawn\_blocking(move || Command::new(\&path\_clone).arg("-version").output())

\-        .await

\-        .map\_err(|e| AppError::Ffmpeg(format!("failed to spawn probe task: {e}")))?

\-        .map\_err(|e| AppError::Ffmpeg(format!("failed to execute {path}: {e}")))?;

\+    let output =

\+        tokio::task::spawn\_blocking(move || Command::new(\&path\_clone).arg("-version").output())

\+            .await

\+            .map\_err(|e| AppError::Ffmpeg(format!("failed to spawn probe task: {e}")))?

\+            .map\_err(|e| AppError::Ffmpeg(format!("failed to execute {path}: {e}")))?;

&#x20;

&#x20;    if !output.status.success() {

&#x20;        let stderr = String::from\_utf8\_lossy(\&output.stderr).trim().to\_string();

Diff in /home/runner/work/motrix-next-learn/motrix-next-learn/src-tauri/src/commands/ffmpeg.rs:48:

&#x20;        return Err(AppError::Ffmpeg(format!(

&#x20;            "ffmpeg -version exited with status {}: {}",

&#x20;            output.status,

\-            if stderr.is\_empty() { "<no stderr>" } else { \&stderr }

\+            if stderr.is\_empty() {

\+                "<no stderr>"

\+            } else {

\+                \&stderr

\+            }

&#x20;        )));

&#x20;    }

&#x20;

Diff in /home/runner/work/motrix-next-learn/motrix-next-learn/src-tauri/src/commands/ffmpeg.rs:99:

&#x20;        let dir = tempfile::tempdir().expect("tempdir");

&#x20;        let fake = dir.path().join("fake-ffmpeg.sh");

&#x20;        let mut f = std::fs::File::create(\&fake).expect("create fake ffmpeg");

\-        writeln!(f, "#!/bin/sh\\necho 'ffmpeg version 6.1.1 Copyright (c) 2000-2024'").unwrap();

\+        writeln!(

\+            f,

\+            "#!/bin/sh\\necho 'ffmpeg version 6.1.1 Copyright (c) 2000-2024'"

\+        )

\+        .unwrap();

&#x20;        drop(f);

\-        std::fs::set\_permissions(\&fake, std::os::unix::fs::PermissionsExt::from\_mode(0o755)).unwrap();

\+        std::fs::set\_permissions(\&fake, std::os::unix::fs::PermissionsExt::from\_mode(0o755))

\+            .unwrap();

&#x20;

&#x20;        let result = tokio::runtime::Runtime::new()

&#x20;            .unwrap()

Diff in /home/runner/work/motrix-next-learn/motrix-next-learn/src-tauri/src/commands/ffmpeg.rs:118:

&#x20;        let mut f = std::fs::File::create(\&fake).expect("create");

&#x20;        writeln!(f, "#!/bin/sh\\necho 'totally unrelated tool 1.0'").unwrap();

&#x20;        drop(f);

\-        std::fs::set\_permissions(\&fake, std::os::unix::fs::PermissionsExt::from\_mode(0o755)).unwrap();

\+        std::fs::set\_permissions(\&fake, std::os::unix::fs::PermissionsExt::from\_mode(0o755))

\+            .unwrap();

&#x20;

&#x20;        let result = tokio::runtime::Runtime::new()

&#x20;            .unwrap()

Diff in /home/runner/work/motrix-next-learn/motrix-next-learn/src-tauri/src/commands/m3u8.rs:52:

&#x20;

&#x20;/// Validates preconditions without launching ffmpeg. Split out so unit

&#x20;/// tests can exercise the parser/validator without spawning processes.

\-fn collect\_and\_validate\_segments(

\-    temp\_dir: \&Path,

\-) -> Result<Vec<PathBuf>, AppError> {

+fn collect\_and\_validate\_segments(temp\_dir: \&Path) -> Result<Vec<PathBuf>, AppError> {

&#x20;    if !temp\_dir.is\_dir() {

&#x20;        return Err(AppError::M3u8(format!(

&#x20;            "temp\_dir is not a directory: {}",

Diff in /home/runner/work/motrix-next-learn/motrix-next-learn/src-tauri/src/commands/m3u8.rs:122:

&#x20;    let output = Command::new(ffmpeg\_path)

&#x20;        .args(\[

&#x20;            "-y", // overwrite output without prompting

\-            "-f",

\-            "concat",

\-            "-safe",

\-            "0",

\-            "-i",

\+            "-f", "concat", "-safe", "0", "-i",

&#x20;        ])

&#x20;        .arg(filelist)

&#x20;        .args(\["-c", "copy"]) // remux only, no re-encode

Diff in /home/runner/work/motrix-next-learn/motrix-next-learn/src-tauri/src/commands/m3u8.rs:139:

&#x20;        let code = output.status.code().unwrap\_or(-1);

&#x20;        return Err(AppError::Ffmpeg(format!(

&#x20;            "ffmpeg exited with code {code}: {}",

\-            if stderr.is\_empty() { "<no stderr>" } else { \&stderr }

\+            if stderr.is\_empty() {

\+                "<no stderr>"

\+            } else {

\+                \&stderr

\+            }

&#x20;        )));

&#x20;    }

&#x20;    log::info!(

Diff in /home/runner/work/motrix-next-learn/motrix-next-learn/src-tauri/src/commands/m3u8.rs:157:

&#x20;/// UI affordance.

&#x20;fn remove\_temp\_dir(temp\_dir: \&Path) {

&#x20;    match std::fs::remove\_dir\_all(temp\_dir) {

\-        Ok(()) => log::info!("merge\_m3u8\_segments: removed temp\_dir {}", temp\_dir.display()),

\+        Ok(()) => log::info!(

\+            "merge\_m3u8\_segments: removed temp\_dir {}",

\+            temp\_dir.display()

\+        ),

&#x20;        Err(e) => log::warn!(

&#x20;            "merge\_m3u8\_segments: failed to remove temp\_dir {}: {e}",

&#x20;            temp\_dir.display()

Diff in /home/runner/work/motrix-next-learn/motrix-next-learn/src-tauri/src/services/monitor.rs:1092:

&#x20;

&#x20;        let events = notifier.scan(\&\[seg]);

&#x20;

\-        assert!(events.is\_empty(), "file path marker must suppress the segment");

\+        assert!(

\+            events.is\_empty(),

\+            "file path marker must suppress the segment"

\+        );

&#x20;    }

&#x20;

&#x20;    #\[test]

Error: Process completed with exit code 1.

