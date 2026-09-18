# Changesets

This folder holds pending changelog entries. Add one for every user-facing change:

```bash
bunx changeset
```

Releases are automated: pushing to `main` with pending changesets opens a **Version Packages** PR (version bump + `CHANGELOG.md`); merging that PR publishes to npm and creates the `v<version>` tag and GitHub Release. See [docs/INSTALL.md](../docs/INSTALL.md) and [ADR 0015](../docs/adr/0015-changelog-with-changesets.md).
