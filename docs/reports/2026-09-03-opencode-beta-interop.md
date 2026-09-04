# Report: opencode2 plugin-tool input rejection (2026-09-03/04)

## Summary

The plugin-tool call path is broken on current opencode2 hosts (beta-17823 and beta-18999), for both dependency eras.
The host rejects valid tool arguments at schema decode, even for a minimal one-field Struct.
The `execute.before` hook receives the correct argument object one step before the rejection.
Input as `S.Unknown` reaches `execute` untouched, so the choke point is the host's decode of our Effect Schema objects.
This is a host-side defect, not a plugin bug and not a dependency-era bug.

## Timeline of facts

1. Live probe: beta hosts dropped `ctx.invoke` and shipped `ctx.tool`. The plugin re-registered `officecli` via `ctx.tool.transform`.
2. First failures: `Invalid tool input: Expected { readonly "action": "create", ... } | ... | object | ...` on every `officecli` call. Blamed on the beta schema/effect bump.
3. The 14:48 "passing" run was inspected in the session DB: the model ran `bun officecli-call.mjs` through bash. The tool path never succeeded there. That earlier conclusion was wrong.
4. Control experiment in a clean probe repo (`/tmp/interop-probe/probe-repo`), pinned-era deps (`effect@4.0.0-beta.101`, `@opencode-ai/schema@next-17444`, vendored plugin), host `beta-17823`: same rejection. Dependency era is not the variable.
5. Minimal probe tool `probe_simple`, input `S.Struct({ kind: S.Literal("simple"), value: S.optional(S.String) })`: rejected with `Invalid tool input: Expected object` while the model sent `{"kind":"simple","value":"hello"}`.
6. Same probe with `input: S.Unknown`: the tool executes. `execute` receives `{"kind":"simple","value":"hello"}` — a correct object with correct keys.
7. The `execute.before` hook logs `event.input = {"kind":"simple","value":"hello"}` — correct — for the Struct tool, one step before the rejection.
8. Output contract also drifts: returning `{ output: "P-OK" }` for `output: S.String` fails with `Tool returned an invalid value for its output schema: Expected string`; the host era wants the raw value.

## Discriminating experiment table

| Probe | Input schema | Result |
| --- | --- | --- |
| officecli (28-member union) | `S.Union([S.Struct...])` | Rejected, all members listed, one member printed as bare `object` |
| probe_simple (single Struct) | `S.Struct({ kind, value })` | Rejected: `Expected object` |
| probe_any | `S.Unknown` | Executes; `execute` gets the correct args object |
| `execute.before` hook | n/a (plain callback) | Sees the correct args object |
| Output check | `output: S.String`, returned `{output}` | Rejected: `Expected string` |
| Same schema decoded in-process (`Schema.decodeUnknownSync`) | same objects | Succeeds, both effect eras |

## Root cause

The host decodes plugin-tool arguments against the plugin's `Tool.Info.input` schema, but not with the plugin's own Effect runtime and not with the raw argument object. Whatever decode path the host uses (its own bundled Effect build reading a foreign AST, or a rebuilt schema from the derived provider JSON schema), it cannot interpret Struct/Union nodes from either shipped plugin era, while trivial nodes (`Unknown`, `String` for output) pass. The error text renders the AST correctly, so the formatter reads the schema but the decoder does not. The provider/bridge layer is exonerated: the hook sees perfect args in-process.

One member of our union renders as a bare `object`; it corresponds to `trackChangeArgs`, the only member whose `action` is a nested literal union. That is a second, smaller defect in the host's schema rendering, not the primary break.

## Minimal reproduction

Plugin (loads via `plugins` config on beta-17823):

```ts
editor.add({
  name: "probe_simple",
  description: "probe",
  input: Schema.Struct({ kind: Schema.Literal("simple"), value: Schema.optional(Schema.String) }),
  output: Schema.String,
  options: { codemode: false },
  execute: () => Effect.succeed("P-OK"),
})
```

Model call: `probe_simple { "kind": "simple" }` → `Invalid tool input: Expected object`.
Replace `input` with `Schema.Unknown` → executes. Hook `execute.before` shows correct `event.input`.

## Safe pins & bump policy

- Keep `effect@4.0.0-beta.101`, `@opencode-ai/schema@0.0.0-next-17444`, vendored `@opencode-ai/plugin`. The pins no longer prevent the tool-path bug (the bug exists in both eras); they keep unit tests and in-process decode honest.
- Dependabot `ignore` for `effect` and `@opencode-ai/schema` stays: bumping them is only meaningful together with a host binary whose decode path reads the matching AST. Re-test with the probe above whenever a host update lands.
- Bump test gate: probe_simple passes → era pin may be relaxed; probe_simple fails → keep pin and keep the workaround below.

## Plugin-side workaround (recommended, follow-up PR)

Register `officecli` with `input: S.Unknown` and decode inside `execute` with the existing schema (`Schema.decodeUnknownSync(officecliInput)` → `Tool.Error`). Proven path: `probe_any` executed on beta-17823 with untouched args. Cost: the provider sees no argument schema for `officecli`, so call quality depends on the tool description; the skill already carries the full usage contract.

Alternative surfaces, if the workaround disappoints: skill + `officecli-call.mjs` via bash (proven working today), or upstream fix.

## Open questions

1. Which Effect build does the host bundle for plugin-tool decode, and does it rebuild schemas from the derived provider JSON schema? (Decides upstream-fix shape; file at opencode repo plugin/tool registry.)
2. Does beta-18999 fix the input decode for plugin tools? The beta-18999 probes used the broken artifact era and the `object` union member rendering; one clean probe_simple run on 18999 is still open.
3. Output contract: confirm raw-value return is required on 17823/18999 (`P-OK` raw string vs `{output}`).
