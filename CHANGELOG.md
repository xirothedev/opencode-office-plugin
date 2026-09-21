# Changelog

All notable changes to this project are documented in this file. New releases follow [Semantic Versioning](https://semver.org/); entries are generated from [Changesets](https://github.com/changesets/changesets).

## 1.0.0

### Major Changes

- 582e555: Migrate to GA opencode plugin registry pins (`@opencode/plugin@2.0.10`, `@opencode/schema@2.0.10`, `effect@4.0.0-rc.112`), delete the `file:./vendor` checkout, and import `Plugin.define` from `@opencode/plugin/effect`. Breaking for hosts on the beta plugin line — upgrade the host together with the plugin (ADR-0016).

## 0.3.0

### Minor Changes

- 6980f7a: Full comment lifecycle for DOCX/XLSX/PPTX: `edit-comment`, `delete-comment`, `resolve-comment`, and `deny-comment` join `comment`/`list-comments`/`approve`, and `approve` now refuses suggestions that were denied.
- 6980f7a: Cross-platform installers: `install.sh` (macOS/Linux/WSL/Git Bash) and `install.ps1` (Windows) set up the plugin and skills idempotently, preserving jsonc configs and `$schema`.
- 6980f7a: Hosted OCR for scanned PDFs: `read` accepts `ocr: true | "hosted" | "reject"` and routes image-only pages through anydoc, with a clear `needsOcr` error otherwise (ADR-0011).
- 6980f7a: Format-preserving generation: `clone`, `substitute`, and `verify-l3` keep OOXML byte-identical except text nodes (L3 Fidelity) — built for procurement templates and any task that needs 100% format retention (ADR-0012).
- 6980f7a: **Breaking:** `officecli` is now the single path for office/PDF files — the builtin `read`, `edit`, and `write` tools are blocked for these extensions, and a tool-definition hint routes the agent to `officecli`.
- 6980f7a: Plugin API: `officecli` invokes are registered through `ctx.invoke`, and `office.preview` returns a structured result instead of a plain string.
- 6980f7a: Every `officecli` invoke now writes a local JSON Capture (input, output, duration, error) to the plugin data dir — captures never leave the machine, no telemetry (ADR-0014).
- 6980f7a: Skill Learning: a passing `verify-l3` plus `accept` proposes a Learned Record for the next session; ships the `skill-creator`, `grill-me`, and `writing-for-agents` skills (ADR-0013).
- 6980f7a: Suggest-first editing: on documents not created in the current session, content changes default to suggestion comments instead of direct edits; the agent asks before editing directly.

### Patch Changes

- 6980f7a: Fixed: `accept` no longer drifts on its existence check, `substitute` preserves trailing newlines, and PPTX suggestion approval targets the text box by snippet.
- 6980f7a: Fixed: the plugin now registers tools through `ctx.tool` on current opencode2 hosts and defers heavy backends to first call, so it loads on hosts whose plugin harness dropped `invoke` from `ctx`.
- 6980f7a: Fixed: sanitization and comment persistence — PK markers, inline markdown, and zipped drafts survive the draft cycle, and comment lifecycle operations apply on all three formats.

## 0.2.1

### Patch Changes

- Republish fix: CD now uses Node 24 for npm Trusted Publishing (OIDC). No functional changes.

## 0.2.0

### Minor Changes

- Initial public release: `officecli` draft lifecycle (`create`, `read`, `edit`, `accept`, `undo`, `history`, `revert`, `diff`), format conversion for text/PDF/DOCX/XLSX/PPTX/images, suggestion comments with `approve`, DOCX track changes, `generate` template batches, `export`/`preview`/`validate`/`metadata`/`watermark`/`annotate`, plugin options (`pdfEngine`, `staleLockHours`, `dataDir`), and the opencode 2 (V2) plugin API.
