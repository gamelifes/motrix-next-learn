#!/usr/bin/env python3
"""Batch-insert the 6 m3u8 notification keys into all 27 locale task.js files."""
import os
import re

LOCALES_DIR = "src/shared/locales"

# Matching the existing m3u8/ffmpeg keys in this repo, values use the en-US
# text as the fallback across all locales (the previous batch did the same).
NEW_KEYS = [
    ("m3u8-merge-complete-title", "M3U8 Merge Complete"),
    ("m3u8-merge-complete-message", "{taskName} merged and saved to {path}"),
    ("m3u8-failed-title", "M3U8 Download Failed"),
    ("m3u8-failed-message", "{taskName} failed: {reason}"),
    ("m3u8-retry-message", "{count} segment(s) failed - retrying in 3 seconds"),
    ("m3u8-merge-failed", "FFmpeg merge failed"),
]

ANCHOR = "'m3u8-status-partial'"


def insert_keys(content: str) -> str:
    lines = content.split("\n")
    anchor_index = None
    for i, line in enumerate(lines):
        if f"{ANCHOR}:" in line:
            anchor_index = i
            break
    if anchor_index is None:
        return None

    indent = re.match(r"^\s*", lines[anchor_index]).group(0)
    block = []
    for key, value in NEW_KEYS:
        block.append(f"{indent}{key!r}: {value!r},")
    lines[anchor_index + 1 : anchor_index + 1] = block
    return "\n".join(lines)


total = 0
missing = []
for locale_dir in sorted(os.listdir(LOCALES_DIR)):
    filepath = os.path.join(LOCALES_DIR, locale_dir, "task.js")
    if not os.path.isfile(filepath):
        missing.append(filepath)
        continue
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    updated = insert_keys(content)
    if updated is None:
        missing.append(filepath)
        continue
    if updated == content:
        missing.append(filepath + " (unchanged)")
        continue
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(updated)
    total += 1
    print(f"updated: {locale_dir}")

print(f"\nupdated {total} locale file(s)")
if missing:
    print("SKIPPED (missing anchor):")
    for path in missing:
        print(f"  {path}")