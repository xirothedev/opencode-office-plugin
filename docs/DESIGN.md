# OpenCode Office Plugin Design

Office document automation plugin for opencode. Transparent draft lifecycle, lock-based concurrency, version history.

## Plugin Scope

**Full plugin, no daemon**. Drop standalone daemon, wire protocol, binary release. Plugin = npm package `@openoffice/plugin`. Installed by adding it to the `"plugin"` array in opencode config (see docs/INSTALL.md). Targets the opencode V1 plugin API (ADR-0002).

**Standalone**. This folder = plugin root. No monorepo, no symlinks to old openoffice project. Greenfield.

**What dies** (from ADR 0033):
- `packages/server` daemon
- `packages/protocol` wire contract
- CLI binary surface (`serve`, `update`, `share`)
- Vendored opencode binary, self-update machinery

**What survives** (from ADR 0034):
- Office domain: draft lifecycle, locks, version history
- officecli tool logic, format detection
- Skills (as README config snippets, not plugin-contributed)

## Tool Surface

### officecli (single tool)

Single tool with action enum. Agent picks action.

```typescript
tool({
  description: "Office document automation",
  args: {
    action: tool.schema.enum(["create", "edit", "read", "accept", "undo", "revert", "history", "comment", "track-insert", "track-delete", "list-comments", "review"]),
    filePath: tool.schema.string().optional(),
    content: tool.schema.string().optional(),
    timestamp: tool.schema.number().optional(), // for revert
  },
  async execute(args, context) {
    // route to action handler
  }
})
```

**Actions**:
- `create(filePath, content)` → new draft born (no real file)
- `edit(filePath, content)` → acquire lock if needed, update draft
- `read(filePath)` → return markdown (delegates to pdf-inspector/anydoc/oocr)
- `accept()` → flush draft, write real file, record accept-point, release lock
- `undo()` → discard draft, release lock
- `revert(filePath, timestamp)` → create draft from snapshot, route through accept
- `history(filePath)` → return `[{timestamp, sessionID, acceptPointIndex}]`
- `comment(filePath, commentId, author, commentText, rangeStartParagraph, rangeStartOffset, rangeEndParagraph, rangeEndOffset)` → add comment to DOCX draft; for XLSX pass `cellRef` instead, for PPTX pass `slide` (optional `x`/`y` in EMU). Optional `suggestedText` turns it into a content-changing suggestion (marker stored in the comment text)
- `approve(filePath, commentId)` → apply a suggestion to the draft content (DOCX: paragraph text, XLSX: cell value, PPTX: first text box) and remove the comment. Errors: comment not found / has no suggestion
- `track-insert(filePath, commentId, author, content, paragraph, offset)` → add insertion track change to DOCX draft (DOCX only)
- `track-delete(filePath, commentId, author, content, paragraph, offset)` → add deletion track change to DOCX draft (DOCX only)
- `list-comments(filePath)` → return comments from DOCX/XLSX/PPTX (with `suggestedText` when present)
- `review(filePath)` → return summary of comments (all formats) and track changes (DOCX only)

**Structured errors**:
opencode's `ToolResult` type = `string | {output: string}`. Errors returned as `{output: "error: message"}`. Agent parses error string. No structured error codes (opencode plugin API doesn't support them).

```typescript
{output: "error: lock held by session abc"}
{output: "error: file not found"}
{output: "error: invalid action"}
```

### edit (tool override)

Plugin registers tool named `edit`, overrides opencode built-in. Transparent interception.

```typescript
tool({
  description: "Edit file", // same as built-in
  args: { /* same as built-in */ },
  async execute(args, context) {
    // 1. Check file extension
    if (isBinary(args.filePath)) {
      return {success: false, error: "use officecli for binary files", code: "BINARY_FILE"}
    }
    // 2. Check lock
    const lock = getLock(filePathHash(args.filePath))
    if (lock && lock.sessionID !== context.sessionID) {
      return {success: false, error: `Lock held by session ${lock.sessionID}`, code: "LOCK_HELD_BY_OTHER"}
    }
    // 3. Acquire lock if needed
    if (!lock) acquireLock(filePathHash(args.filePath), context.sessionID)
    // 4. Copy real file to draft if first edit
    if (!draftExists(filePathHash(args.filePath), context.sessionID)) {
      copyToDraft(args.filePath, context.sessionID)
    }
    // 5. Apply edit to draft
    applyEditToDraft(filePathHash(args.filePath), context.sessionID, args)
    return {success: true, output: "Edit applied to draft"}
  }
})
```

**Binary file handling**: edit override checks extension. If binary (png/pdf/docx/xlsx), denies with error "use officecli for binary files". Forces agent use officecli. Matches dogfooding rule.

## Data Schema

```
~/.local/share/opencode/plugins/openoffice/
  drafts/
    {filePathHash}/
      {sessionID}.{ext}  # binary copy for binary files, text for text files
  locks/
    {filePathHash}.json  # {sessionID, touchedAt, status}
  history/
    {filePathHash}.json  # [{timestamp, snapshot, sessionID}]
```

**filePathHash**: SHA256 of absolute file path. Deterministic. Cross-session discovery.

**Lazy acquire**: Lock acquired on first mutating command (edit/create). No explicit lock action.

**Lock stale**: Hardcoded 24h. No config. If session dies, lock stale after 24h → another session can override.

**Orphaned draft**: Draft whose session lost lock or ended without accept. Discoverable by file-keyed scan. Resolvable only through accept-or-discard prompt. Never deleted silently.

## Architecture

```
./
  package.json          # @openoffice/plugin, depends on @opencode-ai/plugin
  src/
    core/               # pure logic, no opencode deps
      draft/
        manager.ts      # DraftManager: create, read, write, accept, undo
        lock.ts         # Lock: acquire, release, stale check, override, setLockStatus
        history.ts      # VersionHistory: record, list, revert
      office/
        officecli.ts    # action routing, format detection
        formats/
          pdf.ts        # pdf-inspector delegate
          office.ts     # anydoc delegate
          ocr.ts        # oocr delegate
      format/
        ooxml/
          parts.ts          # shared OOXML helpers (rels, content types, XML escaping)
          comments.ts       # OOXML comment writer/reader (word/comments.xml)
          trackchanges.ts   # OOXML track changes writer/reader (w:ins/w:del)
          xlsxcomments.ts   # XLSX comment writer/reader (xl/comments1.xml + VML)
          pptxcomments.ts   # PPTX comment writer/reader (ppt/comments + commentAuthors)
      storage/
        paths.ts        # ~/.local/share/opencode/plugins/openoffice/...
    plugin/             # opencode adapter
      index.ts          # export default Plugin = async (ctx) => hooks
      tools/
        officecli.ts    # tool() wrapper around core/officecli
        edit.ts         # edit override
  test/
    core/
      draft.test.ts     # unit tests on pure logic
      lock.test.ts
      history.test.ts
    plugin/
      officecli.test.ts # integration tests with mocks
      edit.test.ts
  README.md
```

**Separation**: `src/core/` = pure logic (testable without mocks), `src/plugin/` = opencode adapter (thin wrapper). Core reusable if needed later.

## Testing Strategy

**Plugin tests with mocks**. No opencode spawn needed.

**Core tests**: unit tests on DraftManager, Lock, VersionHistory. Mock file system (memfs). Assert draft lifecycle: create → edit → accept writes file.

**Plugin tests**: mock opencode context `{directory, worktree, sessionID}`. Assert tool hook works, edit override intercepts, structured errors returned.

**Fast, deterministic**. No integration tests with full opencode (slow, flaky).

## README Content

Install + usage + config. Agent-facing, not API-facing.

```markdown
# @openoffice/plugin

Office document automation for opencode.

## Install

```json
{
  "plugin": ["@openoffice/plugin"]
}
```

## Usage

Agent uses officecli tool:

- officecli(action="create", filePath="report.docx", content="...")
- officecli(action="read", filePath="report.docx") → markdown
- officecli(action="edit", filePath="report.docx", content="...")
- officecli(action="accept") → write real file
- officecli(action="undo") → discard draft
- officecli(action="history", filePath="report.docx") → list of accept-points
- officecli(action="revert", filePath="report.docx", timestamp=...)

edit tool works transparently for text files. Binary files (docx/pdf/xlsx) require officecli.

## Config

No config needed. Plugin intercepts edit tool, enforces draft lifecycle.

## Skills (optional)

Copy skills/*.md to .opencode/skills/ for agent guidance.
```

## First Ticket

**Tracer bullet**: `officecli(action="create")` + `officecli(action="accept")`.

Proves:
- tool hook works
- draft dir creation
- lock acquire/release
- edit override intercepts
- accept writes real file

One E2E test: create draft → accept → assert real file exists.

Iterate from there: add edit, read, undo, revert, history.

## Domain Model

See CONTEXT.md for canonical terms: Draft, Lock, Accept, Undo, Revert, Accept-point, Version history, filePathHash, Orphaned draft, officecli, Edit override.

**Key rules**:
- Single write path: real file written only by Accept
- Lock = claim (not mutex)
- Lazy acquire on first mutating command
- Structured errors with codes
- Binary drafts for binary files
- Hardcoded 24h stale threshold
- history returns metadata list, not full snapshots
- read returns markdown
- edit override denies binary files
