<!--
Before submitting, read docs/CONTRIBUTING.md — especially the Pull Request section.

Keep this template complete. PRs with deleted sections, vague answers, or unchecked required items may be closed without review.

PR title MUST follow Conventional Commits format.

  Good titles:
    fix(macos): resolve tray icon blurriness on Retina displays
    feat: add per-task speed limit control
    docs: update i18n translation guide
    refactor: extract tracker sync into composable

  Bad titles:
    fix bugs
    update code
    fix #123
    WIP
-->

## Description

<!-- What does this change do and why? Link related issues: Fixes #123 -->

## Type of change

<!-- Check the one that applies. -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (**must** be discussed and approved in an issue first)
- [ ] Refactor (no functional change)
- [ ] Documentation / i18n
- [ ] CI / build configuration

## How has this been tested?

<!-- Check every command that passed. Leave unchecked only if it failed or does not apply, and explain why below. -->

- [ ] `pnpm format:check`
- [ ] `npx vue-tsc --noEmit`
- [ ] `pnpm test`
- [ ] `cd src-tauri && cargo fmt -- --check`
- [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [ ] `cd src-tauri && cargo check --all-targets`
- [ ] `cd src-tauri && cargo test --all-targets`

Unchecked checks:

<!-- Required for every unchecked item. Use "N/A: no frontend changes", "N/A: no Rust changes", or explain the failure. -->

## AI usage disclosure

<!-- Check the one that applies. Honest disclosure is expected — misleading answers will result in PR closure. -->

- [ ] No AI tools were used
- [ ] AI tools assisted with drafting, refactoring, or boilerplate (I reviewed and understand every line)
- [ ] Substantial portions were AI-generated (I reviewed, tested, and can explain every change)

AI model:

<!-- Required if AI was used. Use the exact model name, e.g. OpenAI GPT-5.5 or Claude Opus 4.8. Generic names like ChatGPT or Claude are not enough. -->

## Checklist

### Required — PR will not be reviewed without these

- [ ] I kept this PR template complete and did not delete required sections
- [ ] I understand incomplete PRs may be closed without review
- [ ] I have read [CONTRIBUTING.md](https://github.com/AnInsomniacy/motrix-next/blob/main/docs/CONTRIBUTING.md)
- [ ] PR changes **fewer than 300 lines** of code (excluding tests and generated files)
- [ ] PR touches **fewer than 10 files**
- [ ] PR addresses **one concern only** — no mixed features, config tweaks, or unrelated fixes
- [ ] Required GitHub Actions checks pass or are expected to pass with the same commands listed above
- [ ] Tests were added or updated for risky logic changes, or this PR explains why tests are not needed
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) format

### If applicable

- [ ] New feature was discussed and approved in an issue before implementation
- [ ] i18n keys updated in **all 27 locales** via batch Python script (see AGENTS.md §D)
- [ ] New config key follows the full checklist in AGENTS.md §C
- [ ] Rust changes compile with `cargo clippy` (zero warnings)

## Release notes

<!-- One-line description for end users, or "none" if not user-facing. -->

Notes:
