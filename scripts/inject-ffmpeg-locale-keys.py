#!/usr/bin/env python3
"""Batch-inject the ffmpeg i18n keys into all 27 locales.

Anchor strategy: insert immediately AFTER the `allow-remote-access` line.
The line exists in every locale with locale-specific translation, with
either single- or double-quoted values (ca/fr use double quotes because
their translations contain an apostrophe).

English values are used as a fallback. Translators can replace per-locale
later without touching the schema.

Idempotent: skips locales that already contain `ffmpeg-path`.
"""

from __future__ import annotations
import sys
from pathlib import Path

LOCALES_DIR = Path("/mnt/d/motrix-next/src/shared/locales")

FFMPEG_BLOCK = """  'ffmpeg-path': 'FFmpeg Path',
  'ffmpeg-path-placeholder': 'Path to ffmpeg executable (required for HLS / .m3u8 merging)',
  'ffmpeg-path-hint':
    'Motrix Next does not bundle ffmpeg. Install it separately and provide the absolute path here to enable .m3u8 downloads.',
  'ffmpeg-browse': 'Browse',
  'ffmpeg-test': 'Test',
  'ffmpeg-test-success': 'Detected ffmpeg {version}',
  'ffmpeg-test-failed': 'Could not execute ffmpeg: {message}',
  'ffmpeg-required': 'FFmpeg path is required',
"""


def find_anchor_line_end(lines: list[str]) -> int | None:
    """Return index AFTER the `allow-remote-access` line, or None if not found.

    Tolerates single OR double quoted values, with or without trailing comma
    (some files in the repo omit the comma on the last entry).
    """
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith("'allow-remote-access':") or stripped.startswith('"allow-remote-access":'):
            return i + 1
    return None


def inject(path: Path) -> str:
    content = path.read_text(encoding="utf-8")
    if "'ffmpeg-path':" in content:
        return f"SKIP (already injected): {path}"
    lines = content.splitlines(keepends=True)
    insert_at = find_anchor_line_end(lines)
    if insert_at is None:
        return f"SKIP (anchor missing): {path}"
    new_lines = lines[:insert_at] + [FFMPEG_BLOCK] + lines[insert_at:]
    path.write_text("".join(new_lines), encoding="utf-8")
    return f"OK: {path}"


def main() -> int:
    if not LOCALES_DIR.is_dir():
        print(f"locales dir not found: {LOCALES_DIR}", file=sys.stderr)
        return 1
    results: list[str] = []
    for locale_dir in sorted(p for p in LOCALES_DIR.iterdir() if p.is_dir()):
        prefs_file = locale_dir / "preferences.js"
        if not prefs_file.exists():
            results.append(f"MISSING: {prefs_file}")
            continue
        results.append(inject(prefs_file))
    print("\n".join(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
