# OpenCode Office Plugin Design

Office document automation plugin for opencode. Transparent draft lifecycle, lock-based concurrency, version history.

## Plugin Scope

**Full plugin, no daemon**. Drop standalone daemon, wire protocol, binary release. Plugin = npm package `@openoffice/plugin`. Installed by adding it to the `plugins` array in opencode 2 config (see docs/INSTALL.md). Targets the opencode V2 plugin API (ADR-0010, supersedes ADR-0002): `Plugin.define({ id: "openoffice", effect })` from `@opencode-ai/plugin/effect`, pinned to `@opencode-ai/plugin@0.0.0-next-17444`.

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

Single tool with action enum. Agent picks action. Input is a tagged union on `action` (Effect `Schema.Union` of per-action structs) so each action declares its own required args and the host validates before execute; runtime checks remain as a backstop.

```typescript
// registration shape (V2, effect route)
{
  name: "officecli",
  input: Schema.Union([createArgs, acceptArgs, ...reviewArgs]), // discriminated by action
  output: Schema.String,
  options: { codemode: false }, // direct provider exposure (verified: default codemode:true hides plugin tools from direct calls)
  execute: (input, context) => Effect.tryPromise({ try: () => runAction(input, context), catch: toToolError }),
}
```

**Actions**: `create`, `edit`, `read`, `accept`, `undo`, `revert`, `history`, `list`, `diff`, `generate`, `preview`, `validate`, `lock-status`, `force-release`, `comment`, `approve`, `track-insert`, `track-delete`, `list-comments`, `review`, `export`, `metadata`, `watermark`, `annotate`.

- `create(filePath|filePaths, content)` → new draft born (no real file); batch creates one draft per path
- `edit(filePath, content)` → acquire lock if needed, update draft
- `read(filePath)` → return markdown (delegates to pdf-inspector/anydoc/oocr)
- `accept(filePath|filePaths, timestamp?)` → flush draft, write real file, record accept-point, release lock; batch all-or-nothing
- `undo(filePath)` → discard draft, release lock
- `revert(filePath, timestamp)` → create draft from snapshot, route through accept
- `history(filePath)` → return `[{timestamp, sessionID}]`
- `list(filePath?)` → return active drafts across files (with `lockStatus`, `orphaned`, `ageSeconds` per draft)
- `diff(filePath)` → return markdown text comparison between draft and real file
- `generate(templatePath, data|dataArray, filePath|filePaths)` → create drafts from template; batch mode validates all entries before creating any
- `preview(filePath)` → render draft markdown to HTML via pandoc, return output path
- `validate(filePath, rules)` → check draft content against `{type: "regex"|"required", pattern}` rules, return per-rule pass/fail report
- `lock-status(filePath)` → return lock details (sessionID, owner, status, stale, touchedAt)
- `force-release(filePath)` → take over a lock, only when it is stale
- `comment(filePath, commentId, author, commentText, ...)` → add comment to DOCX draft (range args), XLSX (`cellRef`), or PPTX (`slide`, optional `x`/`y`). Optional `suggestedText` turns it into a content-changing suggestion
- `approve(filePath, commentId)` → apply a suggestion to the draft content and remove the comment
- `track-insert` / `track-delete(filePath, commentId, author, content, paragraph, offset)` → DOCX-only track changes
- `list-comments(filePath)` → return comments from DOCX/XLSX/PPTX
- `review(filePath)` → summary of comments (all formats) and track changes (DOCX only)
- `export(filePath, targetPath)` → write a Derived file outside the write path
- `metadata(filePath, properties?)` → read merged metadata; write pending values to the draft Sidecar
- `watermark(filePath, text, position?, size?, opacity?)` → DOCX/PDF watermark config in the Sidecar
- `annotate(filePath, annotations)` → image note/highlight/stamp overlays in the Sidecar

**Typed errors**:
Real failures are thrown as `Tool.Error` (typed failure channel of the effect route, `{ message }`). Informational output (e.g. lock-status "no lock on X") stays a plain string in the result. No `error: <message>` prefixes inside success output. (CONTEXT.md "Typed errors" rule; replaces the V1 string-error convention.)

```typescript
fail("lock held by session abc")   // → Tool.Error thrown, agent sees a failed tool call
return `no lock on ${filePath}`    // → plain informational string
```

### edit (tool override)

Plugin registers a tool named `edit` via `tools.add`. Empirically verified at next-17444: a plugin tool whose name collides with a builtin **replaces** it in the catalog (the builtin direct `edit` is gone; calls route to the plugin tool). No `session.hook("context")` deletion needed — and adding one would delete our own tool.

```typescript
{
  name: "edit",
  input: Schema.Struct({ filePath: Schema.String, oldString: Schema.String, newString: Schema.String }),
  options: { codemode: false },
  execute: (input, context) => Effect.tryPromise({ try: () => runEdit(input, context), catch: toToolError }),
}
```

**Binary file handling**: edit override checks extension. If binary (png/pdf/docx/xlsx), throws "use officecli for binary files". Forces agent use officecli. Matches dogfooding rule.

## Data Schema

```
{dataDir}/   # default ~/.local/share/opencode/plugins/openoffice/, overridable via dataDir option
  drafts/
    {filePathHash}.{sessionID}.{ext}  # markdown draft (binary drafts stored as markdown, converted at Accept)
  locks/
    {filePathHash}.json  # {sessionID, owner, touchedAt, status}
  history/
    {filePathHash}.json  # [{timestamp, snapshot, sessionID}]
  registry/
    {filePathHash}.json  # hash → absolute path (powers list, survives orphaned drafts)
  sidecars/
    {filePathHash}.{sessionID}.json  # metadata/watermark/annotations pending mutations
```

**filePathHash**: SHA256 of absolute file path. Deterministic. Cross-session discovery.

**Lazy acquire**: Lock acquired on first mutating command (edit/create). No explicit lock action.

**Lock stale**: Configured via `staleLockHours` option, default 24h. If session dies, lock stale after threshold → another session can override.

**Orphaned draft**: Draft whose session lost lock or ended without accept. Discoverable by file-keyed scan. Resolvable only through accept-or-discard prompt. Never deleted silently.

**Plugin options** (via `ctx.options`): `pdfEngine` (pandoc engine, env fallback `OFFICECLI_PDF_ENGINE`), `staleLockHours`, `dataDir`.

## Architecture

```
./
  package.json          # @openoffice/plugin, depends on @opencode-ai/plugin@0.0.0-next-17444 + effect@4.0.0-beta.101
  src/
    core/               # pure logic, no opencode deps
      draft/
        manager.ts      # create, accept, undo, history, revert, list, draft paths
        lock.ts         # acquire, release, stale check, override
        sidecar.ts      # pending metadata/watermark/annotations beside drafts
        diff.ts         # unified text diff
      format/
        detect.ts       # extension → Format
        read.ts         # real file → markdown (delegates to backends)
        export.ts       # derived-file conversion (outside write path)
        metadata.ts     # DOCX/XLSX/PPTX/PDF core+custom properties
        watermark.ts    # PDF (pdf-lib) + DOCX (header injection)
        annotate.ts     # image overlays (sharp + SVG)
        render.ts       # pandoc markdown → HTML (preview)
        backends/       # office (anydoc read, pandoc write), docx, pdf, xlsx, image
        ooxml/          # parts, comments, trackchanges, xlsxcomments, pptxcomments
      template/
        substitute.ts   # {{var}} substitution
      storage/
        paths.ts        # dataDir subdirectories
        registry.ts     # hash → path index
      options.ts        # plugin options (pdfEngine, staleLockHours, dataDir)
    plugin/             # opencode V2 adapter (effect route)
      index.ts          # Plugin.define({ id: "openoffice", effect }) — registers tools, scope finalizer logs orphaned drafts
      tools/
        officecli.ts    # V2 tool: discriminated-union schema, boundary-wrapped handlers
        edit.ts         # edit override
  test/
    core/               # unit tests (lock, manager, paths, registry, substitute, ooxml)
    plugin/tools/       # 23 tool test files using the shared harness (runTool, hermetic dataDir)
  test/plugin/tools/harness.ts   # shared harness: schema decode + Effect.runPromise, hermetic temp dataDir
  README.md
```

**Separation**: `src/core/` = pure logic (testable without mocks), `src/plugin/` = opencode adapter (thin wrapper). Core reusable if needed later. The tool boundary is the only Effect-aware layer: `runAction` handlers are async/await, wrapped once in `Effect.tryPromise`.

## Testing Strategy

**Plugin tests via shared harness** (`test/plugin/tools/harness.ts`). No opencode spawn needed. `runTool` decodes args through the tool's input schema (as the host would), runs the Effect, and unwraps `{output}`; failures assert as thrown `Tool.Error`. `setupHermeticDirs()` points the dataDir at a fresh temp dir per run, so tests never touch the real `~/.local/share/...` and can run in parallel.

**Core tests**: unit tests on lock, manager, paths, registry, substitute, OOXML parts.

**Fast, deterministic**. No integration tests with full opencode (slow, flaky).

## README Content

Install + usage + config. Agent-facing, not API-facing. See README.md — `plugins` array (V2), plugin options (`pdfEngine`, `staleLockHours`, `dataDir`), officecli actions, edit override for text files.

## Domain Model

See CONTEXT.md for canonical terms: Draft, Lock, Accept, Undo, Revert, Accept-point, Version history, filePathHash, Orphaned draft, officecli, Edit override.

**Key rules**:
- Single write path: real file written only by Accept
- Lock = claim (not mutex)
- Lazy acquire on first mutating command
- Typed errors: real failures throw `Tool.Error`; informational output stays plain strings
- Drafts stored as markdown regardless of target format; binary formats produced at Accept
- Stale threshold configurable via `staleLockHours` (default 24h)
- history returns metadata list, not full snapshots
- read returns markdown
- edit override denies binary files
- Tools registered with `codemode: false` (direct provider exposure)
