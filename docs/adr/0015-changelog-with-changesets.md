# Changelog and auto-release via Changesets Version PRs

ADR 0001 chose "changelog-free manual tags" while releases were a solo, rare event. By the release after v0.2.1, 70 commits had accumulated with no user-facing record, and npm and GitHub showed nothing between versions. This ADR replaces the manual ritual with [Changesets](https://github.com/changesets/changesets): authors write a changeset file per user-facing change, and `changesets/action` on push to `main` opens a **Version Packages PR** (version bump + `CHANGELOG.md`). Merging that PR publishes to npm via Trusted Publishing (OIDC) with provenance, then a finalize step creates the `v<version>` tag and the GitHub Release from the matching changelog section.

## Considered options

- Keep the manual tag-driven ritual (rejected: nothing forces the ritual — it already failed once, and the changelog rots)
- git-cliff (rejected: entries derive from commit subjects — dev-facing text like "drain remaining action logic into core modules" — and it adds a Rust toolchain to a Bun/TS repo)
- release-please (rejected: bot PRs plus its own versioning model on a repo that already uses Changesets; ADR 0001 rejected semantic-release for the same family of reasons)
- changesets/action default tags `<package>@<version>` with action-created releases (rejected: single-package repo — tags would not match the existing `v0.2.0`/`v0.2.1` convention)
- `NPM_TOKEN` automation token like the sibling `discord.ts` project (rejected: unnecessary here — the package already exists on npm and OIDC trusted publishing already published `0.2.1`, so no long-lived token is stored)
- custom Bun/TS release script (rejected: re-implements changeset consumption and PR automation)

## Consequences

- `release.yml` runs on every push to `main` (and on manual dispatch): with pending changesets it opens/updates the Version Packages PR, otherwise it is a no-op.
- The finalize step is idempotent and version-based: it acts only when the current version is on npm, then creates the tag and release if missing, or updates the release notes if it already exists.
- Version Packages PRs are opened with `GITHUB_TOKEN`, so CI does not run on them (GitHub suppresses token-triggered workflow runs); CI still runs on the merge push to `main`. The repository setting "Allow GitHub Actions to create and approve pull requests" is required.
- `package.json` is bumped by `changeset version` inside the Version PR, not by hand. The old tag-triggered `cd.yml` is deleted — one release path.
- `CHANGELOG.md` is committed but not shipped in the npm tarball (`files: ["dist"]`) — npm renders only the README.
- No codemod is needed: the changelog is additive, and breaking changes are called out as `**Breaking:**` entries (the first is the builtin-tool blocking in the unreleased 0.3.0 changesets).
