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
  "plugins": ["@openoffice/plugin"]
}
```

**Globally** — `~/.config/opencode/opencode.json` (or the equivalent global config location):

```json
{
  "plugins": ["@openoffice/plugin"]
}
```

To pin a version and pass options:

```json
{
  "plugins": [
    {
      "package": "@openoffice/plugin@0.2.0",
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

**Version matching**: this release pins `@opencode-ai/plugin@0.0.0-next-17444` (exact). The V2 plugin API is beta — the plugin loads only in opencode 2 builds that ship a compatible plugin package. Match your opencode 2 release to the pin, or upgrade the plugin when you upgrade opencode.

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
| Plugin not loading | Confirm the config file is `opencode.json` (project or global), the field is `plugins` (V2, not V1's `plugin`), and the package name is spelled `@openoffice/plugin`. Check the server log for load errors. |
| `officecli` not available in chat | Restart opencode 2 after changing config. Check startup logs for load errors. |
| Plugin loads but tools are invisible to the model | Tools are registered with `codemode: false` for direct provider exposure — verify you are not on a version where the plugin package mismatch prevents registration. |
| pandoc errors on DOCX/XLSX/PPTX | Install pandoc, verify with `pandoc --version`. |
| Permission errors | The plugin needs write access to its data dir `~/.local/share/opencode/plugins/openoffice/` (or your configured `dataDir`). |

## For maintainers: creating a release

Releases are tag-driven. CI publishes to npm when a `v*` tag is pushed:

```bash
bun run build
bun run test
git tag v0.2.0
git push origin v0.2.0
```

- The npm version is taken from the tag (`v0.2.0` → `0.2.0`); do not bump `package.json` by hand.
- Publishing uses **Trusted Publishing (OIDC)** — no npm token secret in CI. The `@openoffice` scope must have trusted publishing enabled in the npm web UI (Settings → Trusted Publishing): OIDC provider `https://token.actions.githubusercontent.com`, allowed repo `xirothedev/opencode-office-plugin`. CI authenticates via the workflow's `id-token: write` permission and signs with `--provenance`.
- Until the scope has trusted publishing configured, a publish fails with `E403`/`EOTP`; run `npm publish --provenance --access public` locally once (with `--otp=<code>` if 2FA-protected) to claim the scope, then enable trusted publishing.
