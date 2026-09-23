# AGENTS.md

Guidance for coding agents working in this repository.

## What This Is

A platform repo that ships one publishable opencode plugin (`@xirothedev/openoffice-plugin-opencode`). The repo holds Task Skills (`skills/`), host invokes (`src/plugin/host.ts`), the isolated test workspace (`tests/isolated-workspace/`), and the plugin itself (`src/plugin/`, pure domain in `src/core/`). The npm tarball is only `dist/` + READMEs with entry `dist/index.js`.

Targets the opencode V2 plugin API: `Plugin.define({ id: "openoffice", effect })` from `@opencode/plugin/effect`, tools registered via `ctx.tool.transform(t => t.add(...))` with `options: { codemode: false }` (ADR-0016; registry pins `@opencode/plugin@2.0.10` + `@opencode/schema@2.0.10`, `effect` on the plugin-declared `4.0.0-rc.112`).

## Commands

```bash
bun install          # Install dependencies
bun run build        # Compile TypeScript (tsc + tsc-alias) to dist/
bun run typecheck    # tsc --noEmit
bun run lint         # oxlint
bun run test         # bun test
```

## Architecture

- **`index.ts`** (root) — Local-path shim, re-exports `src/index.ts` so `"package": "/abs/path/to/repo"` loads with no build. Excluded from `dist` and npm.
- **`src/index.ts`** — Publishable entry, re-exports the plugin default. Builds to `dist/index.js` (`main`, `exports "."`).
- **`src/plugin/index.ts`** — Plugin entry point. `Plugin.define({ id: "openoffice", effect })` from `@opencode/plugin/effect` (`define` is namespaced, not top-level); reads `ctx.options` via `configureOptions`; registers `officecli` + `edit` tools; `tool.execute.before` hook blocks native read/edit/write on office/binary paths. `LiveCtx` feature-detects `ctx.invoke` (host UI) vs `ctx.tool` (stock V2) — GA `Context` has no `invoke` domain, so the invoke branch only activates on the custom host.
- **`src/plugin/host.ts`** — Host invoke surface (`office.preview`, action invokes), separate from the agent-facing `officecli` tool.
- **`src/plugin/tools/officecli.ts`** — Agent-facing tool: `Schema.Union` of per-action structs discriminated on `action`; output is a plain string; real failures throw `Tool.Error` via `tryExecute`.
- **`src/core/`** — Pure domain: `draft/`, `format/`, `comments/` (single intake via `core/comments`), `storage/`, `template/`.
- **`src/core/options.ts`** — Plugin options + data dir (default `~/.local/share/opencode/plugins/openoffice/`). Drafts, locks, history, sidecars, and Captures live outside the project — never inside the project or any `.opencode/` directory.
- **`src/plugin/capture.ts`** — One JSON Capture per invoke (input, output, duration, error), fire-and-forget.

## OpenCode V2 semantics this code depends on

- A configured local plugin directory resolves its `index.ts`/`index.js` (no-build shim) or the `package.json` `main` entry (built `dist/index.js`).
- Tool registration replaces same-named builtins in the catalog (registering `edit` routes calls to the plugin tool).
- Plugin options (`pdfEngine`, `staleLockHours`, `dataDir`, `firecrawlApiKey`, `firecrawlApiUrl`) arrive via `ctx.options`.

## Git

Use plain Conventional Commits. Commit only when asked.
