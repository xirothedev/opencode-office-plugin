# Installing the Plugin in opencode

This plugin targets the **opencode 2 (V2) plugin API** (`Plugin.define`, `plugins` config field, `opencode2` CLI). It does **not** load in opencode V1.

## Prerequisites

- opencode 2 installed and working (`opencode2`)
- [pandoc](https://pandoc.org/installing.html) for DOCX/XLSX/PPTX **writing** (PDF and image reading is built in)

```bash
# macOS
brew install pandoc

# Debian/Ubuntu
sudo apt-get install pandoc
```

## Option 1: Install the published package (recommended)

Add the package to the `plugins` array in opencode 2 configuration:

**Per project** — `opencode.json` in the project root:

```json
{
  "plugins": ["@xirothedev/openoffice-plugin-opencode"]
}
```

**Globally** — `~/.config/opencode/opencode.json` (or the equivalent global config location):

```json
{
  "plugins": ["@xirothedev/openoffice-plugin-opencode"]
}
```

To pin a version and pass options:

```json
{
  "plugins": [
    {
      "package": "@xirothedev/openoffice-plugin-opencode@0.2.1",
      "options": {
        "pdfEngine": "typst",
        "staleLockHours": 48,
        "dataDir": "/shared/office-plugin-data"
      }
    }
  ]
}
```

opencode installs the package and its dependencies on startup. Then start opencode 2 and try:

> Create a Word document at /tmp/test.docx with a table

The agent should call `officecli(action="create", ...)`.

**Version matching**: this release pins `@opencode/plugin@2.0.10` + `@opencode/schema@2.0.10` (exact). The plugin loads in opencode 2 GA builds that ship a compatible plugin package. Match your opencode 2 release to the pin, or upgrade the plugin when you upgrade opencode.

## Option 2: Local development install

Use the published-package flow above when you consume the plugin. When you develop on the plugin itself, see [docs/TESTING.md](TESTING.md) for the full local setup (build, link, configure, verify).

## Verifying the plugin loaded

- List active plugin IDs through the V2 API:

```bash
opencode2 api get /api/plugin
```

`openoffice` should be in the returned list.

- Ask for any document operation (create / read / comment / track change). The agent must call the `officecli` tool; the `edit` override must deny binary files with "use officecli for binary files".
- If the tool is missing, check the opencode server log (`~/.local/share/opencode/log/opencode.log`) for plugin load errors.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Plugin not loading | Confirm the config file is `opencode.json` (project or global), the field is `plugins` (V2, not V1's `plugin`), and the package name is spelled `@xirothedev/openoffice-plugin-opencode`. Check the server log for load errors. |
| `officecli` not available in chat | Restart opencode 2 after changing config. Check startup logs for load errors. |
| Plugin loads but tools are invisible to the model | Tools are registered with `codemode: false` for direct provider exposure — verify you are not on a version where the plugin package mismatch prevents registration. |
| pandoc errors on DOCX/XLSX/PPTX | Install pandoc, verify with `pandoc --version`. |
| Permission errors | The plugin needs write access to its data dir `~/.local/share/opencode/plugins/openoffice/` (or your configured `dataDir`). |

## For maintainers: creating a release

Releases are automated with [Changesets](https://github.com/changesets/changesets) and the `Release` workflow (`.github/workflows/cd.yml`):

```bash
# 1. Describe each user-facing change (once per change, at PR time or before the release)
bunx changeset

# 2. Push to main — the workflow opens or updates the "Version Packages" PR
#    (version bump + CHANGELOG.md). Merge that PR to release.
```

- Merging the Version Packages PR publishes to npm and creates the `v<version>` tag plus the GitHub Release (notes taken from the matching `CHANGELOG.md` section by `scripts/release-notes.ts`).
- The bump type comes from the changesets (minor for features, patch for fixes); do not edit `package.json` or `CHANGELOG.md` by hand.
- Publishing uses **Trusted Publishing (OIDC)** — no npm token secret in CI. CI authenticates via the workflow's `id-token: write` permission and signs with `--provenance`.
- The workflow requires the repository setting **Allow GitHub Actions to create and approve pull requests** (Settings → Actions → General → Workflow permissions).

### (Re)setting up npm Trusted Publishing

npm pins a trusted publisher to an exact **workflow filename** (case-sensitive). If a publish fails with `E404: Not Found - PUT https://registry.npmjs.org/...`, the configured workflow and the one that ran no longer match.

Check and update it with npm 11.19+:

```bash
npm login --auth-type=web     # browser + 2FA
npm whoami                    # must be the package owner
npm trust list @xirothedev/openoffice-plugin-opencode
```

The entry must read: repository `xirothedev/opencode-office-plugin`, file `cd.yml`, permissions `publish`. To replace it:

```bash
npm trust revoke @xirothedev/openoffice-plugin-opencode --id=<trust-id>
npm trust github @xirothedev/openoffice-plugin-opencode \
  --file cd.yml \
  --repo xirothedev/opencode-office-plugin \
  --allow-publish -y
```

Or configure it in the npm web UI — package → **Settings → Trusted Publishing** → Add trusted publisher → GitHub Actions:

| Field | Value |
| --- | --- |
| Organization or user | `xirothedev` |
| Repository | `opencode-office-plugin` |
| Workflow filename | `cd.yml` — must match exactly; rename the workflow only after updating this |
| Environment | leave empty |
| Allowed actions | npm publish |

Notes:

- A brand-new scoped package cannot use OIDC for its first publish (npm answers 404 until the package exists with a trusted publisher configured). Publish once locally with `npm login` + `npm publish --access public` (`--otp=<code>` if 2FA-protected), then add the trusted publisher.
- Verify the configuration without cutting a release: `gh workflow run cd.yml`. It publishes only when `package.json` holds a version that is not on npm yet.
- Trusted publishing only works from GitHub-hosted runners, and the workflow must keep `id-token: write`.
- The registry read (`npm view`) can lag right after a publish (packument CDN). The release workflow handles this by trusting the Changesets `published` output first and retrying the registry check.
