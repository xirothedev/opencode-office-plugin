# OpenCode Office Plugin

Office document automation plugin for opencode. Transparent draft lifecycle, lock-based concurrency, version history.

## Rules

**Single write path**: Real file written only by Accept. All edits route through draft. `edit` tool override enforces this transparently.

**Lock = claim**: Not mutex. Per-file claim granting one session right to hold active draft. Stale >24h → override. Released on accept/undo/stale override.

**filePathHash = SHA256**: Deterministic key for drafts/locks/history. Cross-session discovery.

**Lazy acquire**: Lock acquired on first mutating command (edit/create). Explicit lock action not needed.

**String errors**: Errors returned as `error: <message>` strings in the tool output. The opencode plugin API does not support structured error codes.

## Language

**Draft**:
Working copy of file agent edits. Real file untouched until accept. Keyed by `filePathHash/sessionID.{ext}`. Stored as the agent's markdown content regardless of target format; binary formats (docx/xlsx/pptx/pdf) are produced at Accept by conversion. Can exist without real file (new documents born as drafts).
_Avoid_: copy, working file, temp file

**Lock**:
Per-file claim granting one session right to hold active draft. Keyed by `filePathHash`. Touched by every mutating command. Carries owner identity: sessionID and readable owner name, both recorded at acquire. Stale >24h (hardcoded) → override by another session. Released on accept/undo/stale override (or Force release). Session whose lock was overridden gets error on next mutating command.
_Avoid_: mutex, session lock

**Accept**:
Only operation writing to real file. Flushes draft, copies over real file, records accept-point in version history, releases draft and lock.
_Avoid_: save, commit, apply

**Undo**:
Discards current draft before accept. Real file never touched. Distinct from revert (acts on accepted file).
_Avoid_: discard, cancel

**Revert**:
Restores file to previously accepted state. Creates new draft from recorded snapshot, routes through normal accept flow. Real file untouched until accept.
_Avoid_: rollback, restore

**Accept-point**:
Recorded entry in file's version history: timestamp, snapshot, sessionID. Keyed by `filePathHash`. Any session can lookup or revert.
_Avoid_: version, checkpoint

**Batch**:
Performing an action on multiple files in one call. `create` and `accept` accept `filePaths` (JSON array of paths); `create` applies one `content` to every path. All-or-nothing: any failed entry aborts the whole call, no partial creates or accepts.
_Avoid_: bulk, loop

**Version history**:
File's ordered list of accept-points. Keyed by `filePathHash`. Any session can lookup without knowing which session last accepted. `officecli(action="history")` returns metadata list `[{timestamp, sessionID, acceptPointIndex}]`, not full snapshots.
_Avoid_: log, audit trail

**Preview**:
User-facing: before/after screenshot comparison shown after mutating edit. Before = untouched real file. After = draft's current state. Cumulative since last accept, not incremental per edit. Agent-facing: `officecli(action="preview")` renders the draft's current state to a standalone HTML view for visual review before accept. Agent-facing comparison is Diff.
_Avoid_: comparison, screenshot

**Snapshot**:
Recorded copy of file's state at accept-point. Source revert restores from. "Before" in previews.
_Avoid_: copy, backup, old version

**filePathHash**:
SHA256 of absolute file path. Deterministic key for drafts/locks/history. Enables cross-session discovery. One-way: the Registry maps hashes back to paths.
_Avoid_: file ID, path key

**Registry**:
Storage index `registry/{filePathHash}.json` mapping hash → absolute path. Written when a Draft is created, pruned when the draft is accepted or undone. Exists because hashes are one-way and locks can be released while a draft survives (Orphaned draft), so the path must outlive the lock. Powers the `list` action.
_Avoid_: path index, path map

**Orphaned draft**:
Draft whose session lost lock (stale override) or ended without accept/discard. Discoverable by file-keyed orphan scan. Resolvable only through accept-or-discard prompt. Never deleted silently.
_Avoid_: abandoned draft, lost edits

**officecli**:
Single tool with action enum. Actions: create, edit, read, accept, undo, revert, history, list, diff, generate, preview, validate, lock-status, force-release (plus comment, track-change, review, approve). `create` and `accept` take `filePaths` for Batch calls. `read` returns markdown (delegates to pdf-inspector/anydoc/oocr). `history` returns metadata list. `list` returns active drafts across files. `diff` returns the markdown Diff. `generate` produces drafts from a Template. Delegates to format-specific backends internally. Enforces draft lifecycle via edit tool override.
_Avoid_: office tool, document tool, doc tool

**Template**:
Ordinary markdown (or other readable) file containing `{{var}}` placeholders, used as input to `generate`. Not a plugin-managed library — a Template is any file on disk the agent points at.
_Avoid_: template library, form

**Generate**:
`officecli(action="generate", templatePath, data|dataArray, filePath|filePaths)`. Loads a Template, substitutes `{{var}}` placeholders from structured data, and creates one Draft per data entry through the normal draft lifecycle. Missing key in data → error listing the missing keys; nothing silently empties.
_Avoid_: render, instantiate, fill

**Diff**:
Markdown text comparison between Draft and real file, produced by `officecli(action="diff", filePath)`. Base = real file's current state, extracted to markdown for binary formats. Output = unified text. Called before Accept to review changes. Agent-facing; user-facing equivalent is Preview.
_Avoid_: comparison, changes report

**Edit override**:
Plugin registers tool named `edit`, overrides opencode built-in. Checks lock, routes to draft transparently. Binary files (png/pdf/docx) → deny with error "use officecli for binary files". Agent thinks using `edit`, plugin enforces draft lifecycle.
_Avoid_: edit interceptor, edit wrapper

**Force release**:
Releasing a file lock held by another session, via `officecli(action="force-release", filePath)`. Allowed only when the lock is stale (timeout exceeded); a fresh foreign lock cannot be force-released. The displaced session's draft becomes an Orphaned draft; that session gets an error on its next mutating command.
_Avoid_: steal lock, take over, kick

**Comment**:
Annotation on a document range, cell, or slide. DOCX stored in `word/comments.xml` with author, text, timestamp, linked to document via `commentRangeStart`/`commentRangeEnd` markers. XLSX stored in `xl/comments1.xml` with VML note boxes anchored to a cell. PPTX stored in `ppt/comments/comment1.xml` anchored to a slide, authors in `ppt/commentAuthors.xml`. User sees in Word/Excel/PowerPoint comment panel. Agent adds via `officecli(action="comment")`.
_Avoid_: annotation, note, remark

**Suggestion**:
Comment that carries a proposed content change, added with `suggestedText`. Stored in the comment text with a marker prefix (`Suggested text: ...` for DOCX/PPTX, `Suggested value: ...` for XLSX) so it survives Office round-trips. Applied to the file content by `officecli(action="approve")` — DOCX replaces the anchored paragraph text, XLSX writes the cell value, PPTX replaces the first text box. The comment is removed once applied.
_Avoid_: suggested change, review note

**Approve**:
Applying a Suggestion to the draft content via `officecli(action="approve", commentId)`. Mutating action (requires lock + draft). Comment id comes from `list-comments`/`review` output. After approve the agent continues the normal accept flow to write the real file.
_Avoid_: accept, apply

**Track change**:
Insertion or deletion with author attribution. Stored inline in `word/document.xml` as `<w:ins>`/`<w:del>` elements with author, timestamp, id. DOCX only — the OOXML spec defines no track changes format for XLSX/PPTX (Excel's legacy Track Changes was removed, PowerPoint never had it). User accepts/rejects in Word's Review tab. Agent adds via `officecli(action="track-insert"|"track-delete")`; for XLSX/PPTX the action returns an error and `comment` is the review path.
_Avoid_: revision, redline, edit marker

**Review**:
Read pending comments and track changes from document. Returns summary of all annotations and modifications awaiting user decision. Agent calls `officecli(action="review")` to see what user needs to review.
_Avoid_: audit, check, inspection

**Validate**:
`officecli(action="validate", filePath, rules)` checks the draft's markdown content against rules before accept. A rule is `{type: "regex", pattern}` (pattern must match) or `{type: "required", pattern}` (marker must be present). Returns a per-rule pass/fail report; does not block accept on its own — the agent decides what the report means.
_Avoid_: gate, lint, compliance check

**Lock status**:
State of file lock: `acquired` (agent editing), `in-review` (user reviewing in Office), `stale` (timeout exceeded). Prevents concurrent edits during review workflow. Queried via `officecli(action="lock-status", filePath)`; `list` shows it per draft.
_Avoid_: lock state, lock mode

**Release**:
Version of the plugin published to the npm registry. Identified by a `v<semver>` git tag on the repository. Installing users reference a Release by name (`@openoffice/plugin@0.1.0`).
_Avoid_: version, build

**Publish**:
Making a new Release available on the npm registry. Performed by CI when a release tag is pushed; never done by hand from a workstation.
_Avoid_: deploy, ship
