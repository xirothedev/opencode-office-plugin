# Contributing

Thanks for contributing to `@xirothedev/openoffice-plugin-opencode`.

## Workflow

1. Fork and create a branch from `main`.
2. Install and verify:
   ```bash
   bun install
   bun run check      # turbo: lint + typecheck + test + build
   ```
3. Keep changes focused. User-facing changes need a changeset:
   ```bash
   bun run changeset
   ```
4. Open a pull request to `main`. Keep `bun run check` green.

## What to run

| Command | Purpose |
|---|---|
| `bun install` | Install dependencies |
| `bun run check` | `turbo run lint typecheck test build` |
| `bun run lint` | `oxlint` |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | `vitest run` |
| `bun run build` | `tsc` + `tsc-alias` to `dist/` |

Background: architecture in `docs/DESIGN.md`, domain language in
`CONTEXT.md` and `docs/CONTEXT.md`, test setup in `docs/TESTING.md`.

## Releases

Releases are cut from `vX.Y.Z` git tags via CI (npm publish with
provenance). Do not publish by hand. Versioning uses changesets
(see `docs/adr/0015-changelog-with-changesets.md` and `ADR-0001`).

## Language

English preferred for issues and PRs; Vietnamese accepted.
`README.md` (English) and `README.vi.md` (Vietnamese) are kept in sync
for user-facing changes.

## No CLA/DCO

No Contributor License Agreement or Developer Certificate of Origin.
By opening a PR you agree your contribution is MIT-licensed under `../LICENSE`,
except for third-party skill materials carved out there.
