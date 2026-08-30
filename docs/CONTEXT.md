# OpenCode Office Plugin

Office document automation plugin for opencode. Transparent draft lifecycle, lock-based concurrency, version history.

## Rules

**Single write path**: Real file written only by Accept. All edits route through draft. `edit` tool override enforces this transparently.

**Lock = claim**: Not mutex. Per-file claim granting one session right to hold active draft. Stale beyond the configured threshold (default 24h) → override. Released on accept/undo/stale override.

**filePathHash = SHA256**: Deterministic key for drafts/locks/history. Cross-session discovery.

**Lazy acquire**: Lock acquired on first mutating command (edit/create). Explicit lock action not needed.

**Typed errors**: Real failures are thrown as the tool's typed error (message only) — the agent sees a failed tool call. Informational output (e.g. lock-status "no lock on X") stays a plain string in the result. No `error: <message>` prefixes inside success output. (Replaces the V1-era "string errors" rule — the V2 plugin API has a typed failure channel.)

## Language

**Draft**:
Working copy of file agent edits. Real file untouched until accept. Keyed by `filePathHash/sessionID.{ext}`. Stored as the agent's markdown content regardless of target format; binary formats (docx/xlsx/pptx/pdf) are produced at Accept by conversion. Can exist without real file (new documents born as drafts).
_Avoid_: copy, working file, temp file

**Lock**:
Per-file claim granting one session right to hold active draft. Keyed by `filePathHash`. Touched by every mutating command. Carries owner identity: sessionID and readable owner name, both recorded at acquire. Stale beyond the configured threshold (default 24h) → override by another session. Released on accept/undo/stale override (or Force release). Session whose lock was overridden gets error on next mutating command.
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
Single tool with action enum. Actions: create, edit, read, accept, undo, revert, history, list, diff, generate, preview, validate, lock-status, force-release, export, metadata, annotate, watermark, comment, edit-comment, delete-comment, resolve-comment, deny-comment, track-insert, track-delete, list-comments, review, approve. `create` and `accept` take `filePaths` for Batch calls. `read` returns markdown (delegates to pdf-inspector/anydoc/oocr). `history` returns metadata list. `list` returns active drafts across files. `diff` returns the markdown Diff. `generate` produces drafts from a Template. Registered via `ctx.tool.transform` with `codemode: false` (direct provider exposure); input is a tagged union on `action` so each action declares its required args. Delegates to format-specific backends internally. Enforces draft lifecycle via edit tool override.
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
Plugin registers tool named `edit` via `ctx.tool.transform`; a plugin tool whose name collides with a builtin replaces it in the catalog (verified at next-17444 — no session-hook deletion needed). Checks lock, routes to draft transparently. Binary files (png/pdf/docx) → error "use officecli for binary files". Agent thinks using `edit`, plugin enforces draft lifecycle.
_Avoid_: edit interceptor, edit wrapper

**Guard**:
`tool.execute.before` hook that fails a generic `edit`/`write` on a binary path with typed error `use officecli tool for binary files`, forcing the agent through the `officecli` draft lifecycle. Keyed by `BINARY_EXTENSIONS` (`docx,xlsx,pptx,pdf,png,jpg,jpeg,gif`). No silent rewrite. Dormant until host ships `ctx.tool` domain — `src/plugin/index.ts:12` feature-checks `if ("tool" in ctx)` so the guard compiles on older hosts and activates on upgrade.
_Avoid_: auto trigger, interceptor, watcher

**Live document**:
Content of a document as held in the running Word application (`Application.Word.ActiveDocument` on Windows COM, `active document` via AppleScript on macOS). Distinct from **Draft** (plugin markdown copy) and from **Real file** (saved file on disk). `officecli(action="read", live=true)` prefers Live document when Word is running on the same machine as opencode, else falls back to Real file. Local-only — remote opencode cannot reach the user's Word without a bridge, which is not built until needed.
_Avoid_: active window, unsaved buffer

**Invoke**:
Host-facing named entry point registered via `ctx.invoke.register(name, handler)` on the v2 plugin API; the opencode host (not the agent) calls it with a params object through the server API. This plugin maps `office.preview`, `office.edit.save`, `office.accept`, and `office.comment.{create,edit,delete,resolve,deny,approve}` onto the matching officecli actions, running as the session that holds the file lock (override with a `sessionID` param).
_Avoid_: endpoint, api, webhook

**Force release**:
Releasing a file lock held by another session, via `officecli(action="force-release", filePath)`. Allowed only when the lock is stale (timeout exceeded); a fresh foreign lock cannot be force-released. The displaced session's draft becomes an Orphaned draft; that session gets an error on its next mutating command.
_Avoid_: steal lock, take over, kick

**Derived file**:
File produced by Export. New file at an explicit target path, converted from a document to another format. The document's real file, lock, draft, and version history are untouched. Written outside the single write path by design.
_Avoid_: exported copy, output file

**Render**:
Creating an image from markdown: lines rendered as monospace text on a blank white canvas (sharp/SVG). Produces a brand-new image; never modifies an existing image's pixels. Pixel editing of existing images is unsupported — overlays are the mutation path for existing images.
_Avoid_: image write, image edit

**Image annotation**:
Pixel-space overlay on an image: text notes, rectangular highlights, and text stamps. Distinct from Comment, which is anchored to a document range, cell, or slide. A mutation — routes through the draft lifecycle.
_Avoid_: markup, image comment

**Annotate**:
`officecli(action="annotate", filePath, annotations)`. Adds Image annotations to an image draft: text notes, rectangular highlights, and Stamps. Overlay operations live in the draft Sidecar; rendered into the image at Accept.
_Avoid_: mark up, draw on

**Stamp**:
Text stamp from a fixed palette (DRAFT, APPROVED, CONFIDENTIAL), rendered onto an image as an Image annotation. No custom stamp images in v1.
_Avoid_: rubber stamp, seal

**Sidecar**:
JSON file stored beside a Draft, holding non-content mutations: Metadata values, Watermark configuration, Image annotation overlays. Merged or rendered into the real file at Accept. Exists because the Draft is markdown and cannot carry binary-format properties.
_Avoid_: meta file, companion file

**Metadata**:
Document properties: title, author, subject, keywords, custom fields (Office formats); info dict (PDF). Read via `officecli(action="metadata", filePath)`; write via the same action with `properties`. A metadata write is a mutation — pending values live in the draft Sidecar, merged at Accept.
_Avoid_: properties, document info

**Watermark**:
Text overlay marking a document, e.g. "DRAFT" or "FINAL". Configurable text, position (diagonal-center, top-center, bottom-center), optional size and opacity. Set via `officecli(action="watermark")`. A mutation — configuration lives in the draft Sidecar, rendered into the binary at Accept.
_Avoid_: draft mark, label

**Export**:
`officecli(action="export", filePath, targetPath)`. Converts the document to another format and writes a Derived file at targetPath. Reads the Draft's current state if a draft exists, else the real file. No lock, no draft, no history entry — the document is untouched.
_Avoid_: convert, save as

**Comment**:
Annotation on a document range, cell, or slide. DOCX stored in `word/comments.xml` with author, text, timestamp, linked to document via `commentRangeStart`/`commentRangeEnd` markers. XLSX stored in `xl/comments1.xml` with VML note boxes anchored to a cell. PPTX stored in `ppt/comments/comment1.xml` anchored to a slide, authors in `ppt/commentAuthors.xml`. User sees in Word/Excel/PowerPoint comment panel. Agent adds via `officecli(action="comment")`.
_Avoid_: annotation, note, remark

**Suggestion**:
Comment that carries a proposed content change, added with `suggestedText`. Scope: files that already have content — the point is letting the user review changes to their own content in Office. On a new file (created this session) the agent authors content directly and skips comments entirely; the tool permits suggestions on fresh drafts but the workflow forbids them. Stored in the comment text with a marker prefix (`Suggested text: ...` for DOCX/PPTX, `Suggested value: ...` for XLSX) so it survives Office round-trips. Applied to the file content by `officecli(action="approve")` — DOCX replaces the anchored paragraph text, XLSX writes the cell value, PPTX replaces the targeted text box (see Target text). The comment is removed once applied.
_Avoid_: suggested change, review note

**Target text**:
Snippet of a PPTX shape's current text, carried inside a PPTX Suggestion (second line of the comment text, `Target text: ...`) so Approve can pick which text box to edit on a slide with several. Matching is normalized (case-insensitive, whitespace-collapsed) substring against each top-level shape's text; first match wins; no match fails approve with the candidate box texts listed. Absent → first text box. Top-level shapes only — text inside grouped shapes is not addressable.
_Avoid_: shape index, anchor

**Approve**:
Applying a Suggestion to the draft content via `officecli(action="approve", commentId)`. Mutating action (requires lock + draft). Comment id comes from `list-comments`/`review` output. After approve the agent continues the normal accept flow to write the real file. A declined suggestion is marked via `officecli(action="deny-comment")` (status denied, content untouched) or removed entirely with `officecli(action="delete-comment")`.
_Avoid_: accept, apply

**Comment status**:
Lifecycle state of a Comment: `open` (default when created), `resolved` (reviewed and handled, no content change), `denied` (suggestion explicitly rejected, content left untouched). Persisted in the comment part: DOCX uses the standard `w:done="1"` attribute on `<w:comment>` for resolved and a plugin-namespaced `oo:status="denied"` attribute (namespace `http://opencode.ai/openoffice-plugin`, declared locally on the element) for denied; XLSX and PPTX use the same plugin attribute for any non-open status. Word preserves unknown attributes on recognized elements across save round-trips, so the marker survives; it is ignored by Office UI. Shown in `list-comments` and `review` output.
_Avoid_: state, flag, resolved-boolean

**Resolve**:
Marking a Comment as handled without changing document content: `officecli(action="resolve-comment", filePath, commentId)` sets status to resolved. Mutating (requires lock + draft). Distinct from Approve, which applies a Suggestion and removes the comment.
_Avoid_: approve, close, complete

**Deny**:
Marking a Comment (usually a Suggestion) as explicitly rejected: `officecli(action="deny-comment", filePath, commentId)` sets status to denied. Content untouched, comment retained for the record. Distinct from Approve (apply + remove) and from Delete comment (remove entirely).
_Avoid_: reject, decline, dismiss

**Edit comment**:
Rewriting an existing comment's text and/or suggested text in place: `officecli(action="edit-comment", filePath, commentId, text?, suggestedText?)`. Keeps author, anchor, and status. Mutating (requires lock + draft).
_Avoid_: modify comment, update annotation

**Delete comment**:
Removing a Comment and its markers from the draft: `officecli(action="delete-comment", filePath, commentId)`. DOCX removes the comment plus its `commentRangeStart`/`commentRangeEnd`/`commentReference` markers; XLSX also removes the VML note shape; PPTX removes the `p:cm` entry. Mutating (requires lock + draft). Distinct from Undo, which discards the whole draft.
_Avoid_: remove comment, discard comment

**Track change**:
Insertion or deletion with author attribution. Stored inline in `word/document.xml` as `<w:ins>`/`<w:del>` elements with author, timestamp, id. DOCX only — the OOXML spec defines no track changes format for XLSX/PPTX (Excel's legacy Track Changes was removed, PowerPoint never had it). User accepts/rejects in Word's Review tab. Agent adds via `officecli(action="track-insert"|"track-delete")`; for XLSX/PPTX the action returns an error and `comment` is the review path.
_Avoid_: revision, redline, edit marker

**Review**:
Read pending comments and track changes from document. Returns summary of all annotations and modifications awaiting user decision. Agent calls `officecli(action="review")` to see what user needs to review. Reserved word: checking a draft against the real file before accept is not a review — that flow is the Pre-accept check, done with Diff.
_Avoid_: audit, inspection, pre-accept check

**Pre-accept check**:
Inspecting the draft against the real file via `officecli(action="diff")` (and optionally `preview` for humans) before running accept. Not a Review — Review reads pending comments; this compares content.
_Avoid_: draft review, change report

**Validate**:
`officecli(action="validate", filePath, rules)` checks the draft's markdown content against rules before accept. A rule is `{type: "regex", pattern}` (pattern must match) or `{type: "required", pattern}` (marker must be present). Returns a per-rule pass/fail report; does not block accept on its own — the agent decides what the report means.
_Avoid_: gate, lint, compliance check

**Lock status**:
State of file lock: `acquired` (agent editing), `in-review` (user reviewing in Office), `stale` (timeout exceeded). Prevents concurrent edits during review workflow. Queried via `officecli(action="lock-status", filePath)`; `list` shows it per draft.
_Avoid_: lock state, lock mode

**Release**:
Version of the plugin published to the npm registry. Identified by a `v<semver>` git tag on the repository. Installing users reference a Release by name (`@xirothedev/openoffice-plugin-opencode@0.2.1`).
_Avoid_: version, build

**Publish**:
Making a new Release available on the npm registry. Performed by CI when a release tag is pushed; never done by hand from a workstation.
_Avoid_: deploy, ship

**Verify Loop**:
The manual poll `set/add → query → validate → view` repeated to work around an `officecli` bug. Distinct from `Validate` (the typed gate). Eliminated by In-place Fix.
_Avoid_: validation loop, check loop

**Skill Learning**:
The `Capture → proposal → accept` loop where `skills/office` proposes a `Learned Record` after a `verify-l3 PASS` + `Accept`, and the Enduser accepts it. Follows `Single write path`, not runtime self-mutation.
_Avoid_: self improve, auto-learn

**Learned Record**:
A typed JSON entry in `.opencode/office/learned/learned.json` (per-project) plus generated `learned.md` view, capturing a verified Template structure, `Format` requirement, or `Verify Loop` workaround that passed `verify-l3`. Replayed next session to avoid the loop.
_Avoid_: learned lesson, memo

**Capture** (extended):
JSON traces of each `officecli` invoke (input, output, duration, error) written to `tests/isolated-workspace/.capture/` during a run. For Skill Learning, also written to `.opencode/office/.capture/` on real office runs, same shape.
_Avoid_: logs, traces, dumps

**Report**:
A single `report.md` summarizing pass/fail per Tracer Bullet flow, linked to its Capture files.
_Avoid_: summary, test report, output

**Tracer Bullet**:
The minimal end-to-end flow `create → edit → read → history → revert` executed on each supported format (docx, xlsx, pptx, pdf) to prove the lifecycle works.
_Avoid_: smoke test, e2e, happy path

**In-place Fix**:
A bug found in the Isolated Runtime is fixed in the main repo (`src/`), rebuilt, and re-verified by re-running the same Isolated Runtime.
_Avoid_: patch, hotfix, direct fix
