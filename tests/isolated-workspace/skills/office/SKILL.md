---
name: office
description: MAIN method for Office and PDF — every read, create, edit, review, convert, version of .docx/.doc/.dotx/.xlsx/.xls/.xlsm/.pptx/.ppt/.pdf (and images) MUST go through officecli. Use whenever a task touches .docx/.doc/.xlsx/.xls/.pptx/.ppt/.pdf/image files or asks for document drafts, suggestions, track changes, history, batch generation, or format export. The native read/edit/write tools are blocked for these extensions.
---

# Office documents

> **MAIN for Office/PDF** — every **read** and **handle** (create/edit/accept/undo/history/revert/comment/track-change) of `.docx/.doc/.dotx/.dotm/.xlsx/.xls/.xlsm/.xlsb/.xltx/.pptx/.ppt/.potx/.pdf` (and images `.png/.jpg/.jpeg/.gif/.bmp/.tiff/.webp`) **MUST** go through `officecli`. The plugin's guard blocks the native `read`/`edit`/`write` tools for these extensions and errors with `use officecli tool for office/PDF files — office is the main method for read + handle`. Do not bypass.

The plugin overrides the builtin `edit` tool: every edit — text or binary — runs through a draft and needs `officecli accept` to reach the real file. Two edit surfaces:

- `officecli(action="edit", filePath, content)` — replaces the whole draft with your markdown (for office/PDF, this is the ONLY write surface)
- `edit` tool (`filePath`, `oldString`, `newString`) — patches the existing draft in place (text files only; blocked for office/PDF/images)

For office/PDF/images, `officecli` is the ONLY path: `read` returns markdown, `create`/`edit` consume markdown, both sides inside `officecli`. Never use `read`/`edit`/`write` on `*.docx,*.doc,*.dotx,*.xlsx,*.xls,*.xlsm,*.pptx,*.ppt,*.pdf,*.png,*.jpg,*.jpeg,*.gif` — guard fails them. For live Word content on the same machine use `officecli(action="read", live=true)` (prefers `Application.Word` document whose full name matches `filePath`, falls back to saved file; local-only).

## Draft lifecycle (every task)

Every write runs through a **draft**: nothing reaches the real file until `accept`. The lock is claimed lazily on the first mutating action and released on accept/undo.

1. `create filePath + content` for a new file, or `edit filePath + content` to open an existing file's draft
2. Re-`edit`, `comment`, `approve`, `metadata`, `watermark` freely while iterating — all mutate the same draft
3. `accept` flushes the draft to disk, records a version snapshot, releases the lock

Done means: every write path ended in `accept` or `undo`. A dropped draft leaves the file locked and the change invisible.

Universal actions (all via `officecli` — main for office/PDF):

- `read` — `officecli(action="read")` extract any office/PDF/image to markdown; inspect before editing anything you did not author this session (native `read` is blocked for `.docx/.doc/.xlsx/.xls/.pptx/.ppt/.pdf`)
- `diff` — unified markdown diff of draft vs real file; call before accept on edits to files you didn't create
- `preview` — renders the draft to an HTML file for human inspection
- `undo` — discard draft, real file unchanged
- `list` — active drafts across all files; run when resuming after an interruption
- Stale lock (`staleLockHours`, default 24h): `lock-status`, then `force-release` — the displaced session's next mutation fails with an error, expected

## Bundled format skills (anthropics/skills, source-available)

`skills/docx`, `skills/xlsx`, `skills/pptx`, `skills/pdf` are bundled verbatim from `anthropics/skills` (see `LICENSE.txt` in each). They hold the canonical gotchas and helper scripts per format. `skills/office` is the router + draft/history; delegate format-specific authoring to the bundled skill when fidelity matters. Quick markdown→officecli covers 80%; the bundled skill covers the 20% that silently corrupts.

| Need | Where |
|---|---|
| Simple headings + pipe tables (markdown enough) | `officecli create/edit` → v2 styled defaults (A4, D9E1F2, DXA) |
| Precise .docx: sections, images, TOC, page size, redlines, comments | `skills/docx` — `docx` npm + `scripts/merge_runs.py`/`comment.py`/`accept_changes.py`/`office/validate.py` + `soffice` |
| XLSX with formulas, styling, recalc | `skills/xlsx` — `openpyxl` + `scripts/recalc.py` (mandatory) + `pandas` for bulk |
| Styled .pptx / template fill | `skills/pptx` — `pptxgenjs` + `scripts/add_slide.py`/`thumbnail.py`/`clean.py` |
| PDF forms, table extraction, merge/split | `skills/pdf` — `forms.md`/`reference.md` + `pypdf`/`pdfplumber`/`reportlab` helpers |

Advanced edit on existing file: `officecli read` to inspect → `officecli edit` to open draft → run the format skill's script **against the draft file** (see `officecli list` / `.opencode/office/drafts/` in `src/core/draft/manager.ts:18`), iterate → `officecli accept`. Never touch the real file bypassing the lock. For quick markdown writes, `officecli edit` alone is enough.

## Task router

| Task type | Reference |
|---|---|
| New document, template batch generation, validation gates, format conversion | [authoring.md](references/authoring.md) + format skill (`docx`/`xlsx`/`pptx`/`pdf`) |
| Editing/reviewing existing documents, suggestions, track changes, version recovery | [reviewing.md](references/reviewing.md) + `docx:editing` / `pptx:editing` sections |
| Fillable PDF forms | [pdf/forms.md](../pdf/forms.md) + `scripts/check_fillable_fields.py` |
| XLSX recalc / financial model | [xlsx SKILL](../xlsx/SKILL.md) `recalc.py` section |
