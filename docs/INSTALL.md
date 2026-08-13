# Installing the Plugin in opencode

This plugin targets the **opencode V1 plugin API**. See [opencode V2](#opencode-v2) below before installing on opencode 2.

## Prerequisites

- opencode V1 installed and working (`opencode`)
- [pandoc](https://pandoc.org/installing.html) for DOCX/XLSX/PPTX **writing** (PDF and image reading is built in)

```bash
# macOS
brew install pandoc

# Debian/Ubuntu
sudo apt-get install pandoc
```

## Option 1: Install the published package (recommended)

Add the package to the `plugin` array in opencode configuration:

**Per project** — `opencode.json` in the project root:

```json
{
  "plugin": ["@openoffice/plugin"]
}
```

**Globally** — `~/.config/opencode/config.json`:

```json
{
  "plugin": ["@openoffice/plugin"]
}
```

To pin a version:

```json
{
  "plugin": ["@openoffice/plugin@0.1.0"]
}
```

opencode installs the package and its dependencies on startup. Then start opencode and try:

> Create a Word document at /tmp/test.docx with a table

The agent should call `officecli(action="create", ...)`.

## Option 2: Local development install

Use the published-package flow above when you consume the plugin. When you develop on the plugin itself, use `bun link` — see [docs/TESTING.md](TESTING.md) for the full local setup (build, link, configure, verify).

## Verifying the plugin loaded

- Start opencode in a directory that has the plugin in its config.
- Ask for any document operation (create / read / comment / track change). The agent must call the `officecli` tool; an `edit` override must deny binary files with "use officecli for binary files".
- If the tool is missing, check the opencode startup output for plugin errors.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Plugin not loading | Confirm the config file is `opencode.json` (project) or `~/.config/opencode/config.json` (global), field is `plugin` (V1), and the package name is spelled `@openoffice/plugin`. |
| `officecli` not available in chat | Restart opencode after changing config. Check startup logs for load errors. |
| pandoc errors on DOCX/XLSX/PPTX | Install pandoc, verify with `pandoc --version`. |
| Permission errors | The plugin needs write access to its data dir `~/.local/share/opencode/plugins/openoffice/`. |

## opencode V2

opencode 2 introduced a new plugin API (`plugins` field, `Plugin.define`) — **V1 plugins do not load in V2**. This plugin is written against the V1 API (`plugin` field, function-style export), so:

- Do not add `@openoffice/plugin` to the `plugins` field of an opencode 2 config; it will not load.
- V2 migration of this plugin is tracked as a separate task.

## For maintainers: creating a release

Releases are tag-driven. CI publishes to npm when a `v*` tag is pushed:

```bash
bun run build
bun run test
git tag v0.1.0
git push origin v0.1.0
```

- The npm version is taken from the tag (`v0.1.0` → `0.1.0`); do not bump `package.json` by hand.
- Required GitHub secret: `NPM_TOKEN` (npm granular access token, publish-only, no OTP).
- The npm account must enable trusted publishing (OIDC) on the `@openoffice` scope for `--provenance` to work.
