# OpenCode Office Plugin

Office document automation plugin for opencode. Transparent draft lifecycle, lock-based concurrency, version history.

## Rules

**Single write path**: Real file written only by Accept. All edits route through draft. `edit` tool override enforces this transparently.

**Lock = claim**: Not mutex. Per-file claim granting one session right to hold active draft. Stale >24h → override. Released on accept/undo/stale override.

**filePathHash = SHA256**: Deterministic key for drafts/locks/history. Cross-session discovery.

**Lazy acquire**: Lock acquired on first mutating command (edit/create). Explicit lock action not needed.

**Structured errors**: `ToolResult` with `{success, output, data}` or `{success: false, error, code}`. Codes: `LOCK_HELD_BY_OTHER`, `FILE_NOT_FOUND`, `INVALID_ACTION`.

## Language

**Draft**:
Working copy of file agent edits. Real file untouched until accept. Keyed by `filePathHash/sessionID.{ext}`. Binary files (docx/xlsx/pdf) stored as binary copy. Can exist without real file (new documents born as drafts).
_Avoid_: copy, working file, temp file

**Lock**:
Per-file claim granting one session right to hold active draft. Keyed by `filePathHash`. Touched by every mutating command. Stale >24h (hardcoded) → override by another session. Released on accept/undo/stale override. Session whose lock was overridden gets error on next mutating command.
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

**Version history**:
File's ordered list of accept-points. Keyed by `filePathHash`. Any session can lookup without knowing which session last accepted. `officecli(action="history")` returns metadata list `[{timestamp, sessionID, acceptPointIndex}]`, not full snapshots.
_Avoid_: log, audit trail

**Preview**:
Before/after screenshot comparison shown after mutating edit. Before = untouched real file. After = draft's current state. Cumulative since last accept, not incremental per edit.
_Avoid_: diff, comparison

**Snapshot**:
Recorded copy of file's state at accept-point. Source revert restores from. "Before" in previews.
_Avoid_: copy, backup, old version

**filePathHash**:
SHA256 of absolute file path. Deterministic key for drafts/locks/history. Enables cross-session discovery.
_Avoid_: file ID, path key

**Orphaned draft**:
Draft whose session lost lock (stale override) or ended without accept/discard. Discoverable by file-keyed orphan scan. Resolvable only through accept-or-discard prompt. Never deleted silently.
_Avoid_: abandoned draft, lost edits

**officecli**:
Single tool with action enum. Actions: create, edit, read, accept, undo, revert, history. `read` returns markdown (delegates to pdf-inspector/anydoc/oocr). `history` returns metadata list. Delegates to format-specific backends internally. Enforces draft lifecycle via edit tool override.
_Avoid_: office tool, document tool, doc tool

**Edit override**:
Plugin registers tool named `edit`, overrides opencode built-in. Checks lock, routes to draft transparently. Binary files (png/pdf/docx) → deny with error "use officecli for binary files". Agent thinks using `edit`, plugin enforces draft lifecycle.
_Avoid_: edit interceptor, edit wrapper

**Comment**:
Annotation on document range. Stored in `word/comments.xml` with author, text, timestamp. Linked to document via `commentRangeStart`/`commentRangeEnd` markers. User sees in Word/Excel/PowerPoint comment panel. Agent adds via `officecli(action="comment")`.
_Avoid_: annotation, note, remark

**Track change**:
Insertion or deletion with author attribution. Stored inline in `word/document.xml` as `<w:ins>`/`<w:del>` elements with author, timestamp, id. User accepts/rejects in Word's Review tab. Agent adds via `officecli(action="track-insert"|"track-delete")`.
_Avoid_: revision, redline, edit marker

**Review**:
Read pending comments and track changes from document. Returns summary of all annotations and modifications awaiting user decision. Agent calls `officecli(action="review")` to see what user needs to review.
_Avoid_: audit, check, inspection

**Lock status**:
State of file lock: `acquired` (agent editing), `in-review` (user reviewing in Office), `stale` (timeout exceeded). Prevents concurrent edits during review workflow. Set via `setLockStatus()`.
_Avoid_: lock state, lock mode
