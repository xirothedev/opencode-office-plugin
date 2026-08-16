# CI/CD: GitHub Actions, tag-driven npm releases

The plugin had no CI/CD. We added GitHub Actions (CI on PR/push to `main`, CD on `v*` tags) that publishes the package to the public npm registry with provenance. The `v*`-tag release flow mirrors the TaxEasy and Ecopick platforms; version, changelog-free manual tags keep this repo consistent with those projects.

**Considered options**: self-hosted runners (rejected — no Docker, SSH, or signing secrets exist here, and GitHub-hosted `ubuntu-latest` is free and sufficient), semantic-release (rejected — neither sibling project uses it; tag-driven flow is already established in the team), GitHub Packages registry (rejected — the whole point is `"plugin": ["@xirothedev/openoffice-plugin-opencode"]` resolving from npmjs).

**Consequences**: publishing uses npm **Trusted Publishing (OIDC)** — GitHub Actions authenticates via the workflow's `id-token: write` permission, so no long-lived `NPM_TOKEN` secret is stored in CI (a secret would be a credential-leak risk; OIDC is the npm-recommended path for CI). The `@xirothedev` scope must have trusted publishing enabled (OIDC provider `https://token.actions.githubusercontent.com`, repo `xirothedev/opencode-office-plugin`) before a tag push succeeds; until then, the first publish is done locally. The first `v*` push releases `v0.2.0`.
