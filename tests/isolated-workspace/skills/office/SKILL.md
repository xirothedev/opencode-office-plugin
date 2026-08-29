---
name: office
description: Office and binary documents (DOCX, XLSX, PPTX, PDF, images) — create, read, edit, review, convert, version. Use whenever a task touches .docx/.xlsx/.pptx/.pdf/image files or asks for document drafts, suggestions, track changes, history, batch generation, or format export.
---

# Office documents

The plugin overrides the builtin `edit` tool: every edit — text or binary — runs through a draft and needs `officecli accept` to reach the real file. Two edit surfaces:

- `officecli(action="edit", filePath, content)` — replaces the whole draft with your markdown
- `edit` tool (`filePath`, `oldString`, `newString`) — patches the existing draft in place

Steer binary formats exclusively to `officecli` actions; for text files pick freely — patch-tool for surgical fixes, officecli edit for rewrites.

Binary formats (.docx/.xlsx/.pptx/.pdf/images) are markdown on both sides inside officecli: read returns markdown, write consumes markdown. Never use `edit`/`write` on `*.docx,*.xlsx,*.pptx,*.pdf,*.png,*.jpg,*.jpeg,*.gif` — Guard (`BINARY_EXTENSIONS`) fails them with `use officecli tool for binary files`; use `officecli(action="create"|"edit")` instead. For live Word content on the same machine use `officecli(action="read", live=true)` (prefers `Application.Word` document whose full name matches `filePath`, falls back to saved file; local-only).

## Draft lifecycle (every task)

Every write runs through a **draft**: nothing reaches the real file until `accept`. The lock is claimed lazily on the first mutating action and released on accept/undo.

1. `create filePath + content` for a new file, or `edit filePath + content` to open an existing file's draft
2. Re-`edit`, `comment`, `approve`, `metadata`, `watermark` freely while iterating — all mutate the same draft
3. `accept` flushes the draft to disk, records a version snapshot, releases the lock

Done means: every write path ended in `accept` or `undo`. A dropped draft leaves the file locked and the change invisible.

Universal actions:

- `read` — extract any supported file to markdown; inspect before editing anything you did not author this session
- `diff` — unified markdown diff of draft vs real file; call before accept on edits to files you didn't create
- `preview` — renders the draft to an HTML file for human inspection
- `undo` — discard draft, real file unchanged
- `list` — active drafts across all files; run when resuming after an interruption
- Stale lock (`staleLockHours`, default 24h): `lock-status`, then `force-release` — the displaced session's next mutation fails with an error, expected

## Task router

| Task type | Reference |
|---|---|
| New document, template batch generation, validation gates, format conversion | [authoring.md](references/authoring.md) |
| Editing/reviewing existing documents, suggestions, track changes, version recovery | [reviewing.md](references/reviewing.md) |
