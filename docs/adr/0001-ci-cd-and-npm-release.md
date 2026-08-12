# CI/CD: GitHub Actions, tag-driven npm releases

The plugin had no CI/CD. We added GitHub Actions (CI on PR/push to `main`, CD on `v*` tags) that publishes the package to the public npm registry with provenance. The `v*`-tag release flow mirrors the TaxEasy and Ecopick platforms; version, changelog-free manual tags keep this repo consistent with those projects.

**Considered options**: self-hosted runners (rejected — no Docker, SSH, or signing secrets exist here, and GitHub-hosted `ubuntu-latest` is free and sufficient), semantic-release (rejected — neither sibling project uses it; tag-driven flow is already established in the team), GitHub Packages registry (rejected — the whole point is `"plugin": ["@openoffice/plugin"]` resolving from npmjs).

**Consequences**: publishing requires an `NPM_TOKEN` secret with publish scope and trusted publishing enabled for `--provenance`; the first `v*` push claims the `@openoffice` npm scope.
