# @openoffice/plugin

Office document automation plugin for opencode. Manage documents with draft lifecycle, version history, and format conversion.

## Overview

```mermaid
graph LR
    A[User Prompt] --> B[Agent]
    B --> C[officecli tool]
    C --> D[Draft Lifecycle]
    D --> E[Format Conversion]
    E --> F[Real File]
    F --> G[Version History]
```

## Quick Start

1. **Install plugin** (see [Install](#install) below)

2. **Start opencode** in your project directory

3. **Try a document operation**:
   ```
   Create a Word document at /tmp/report.docx with a project summary table
   ```

4. **Agent calls officecli**:
   - `create` → draft born (real file not yet written)
   - `accept` → draft flushed to real file, version recorded
   - `read` → extract text from any format as markdown
   - `history` → see all versions
   - `revert` → restore old version

5. **Binary files** (DOCX/XLSX/PPTX/PDF/images) require `officecli`. Text files work with both `edit` and `officecli`.

## Real-World Example: Hospital Procurement

Vietnamese hospitals require 23 sequential procurement documents (purchase request → approval → technical specs → budget → contract → payment). This plugin automates the chain:

```
B1: Purchase request → B2: Approval decision → B3: Technical specs minutes
→ ... → B23: Payment settlement
```

**Template-based batch generation**:
```bash
# Create template with {{var}} placeholders
officecli(action="create", filePath="./templates/decision-template.md",
  content="# Decision {{NUMBER}}\n\nDepartment: {{DEPT}}\n\nAmount: {{AMOUNT}}")
officecli(action="accept", filePath="./templates/decision-template.md")

# Generate 50 decisions in one call
officecli(action="generate",
  templatePath="./templates/decision-template.md",
  filePaths=["./decisions/dept-001.docx", "./decisions/dept-002.docx", ...],
  dataArray=[{DEPT: "Microbiology", NUMBER: 1, AMOUNT: 10000}, ...])
```

See [WORKFLOWS.md](docs/WORKFLOWS.md) for full procurement workflow examples.

## Install

Add the package to the `plugins` array in opencode 2 configuration — `opencode.json` in your project, or the global config for all projects:

```json
{
  "plugins": ["@openoffice/plugin"]
}
```

opencode installs the package and its dependencies on startup. For version pinning, plugin options, local development install, verification, and troubleshooting, see [docs/INSTALL.md](docs/INSTALL.md).

> **Note**: This plugin targets the opencode 2 (V2) plugin API (`Plugin.define`, `plugins` config field, `opencode2` CLI). It does not load in opencode V1.

## Requirements

- **PDF extraction**: Built-in (pdfjs-dist + pdf-inspector)
- **Image OCR**: Built-in (anydoc)
- **Office formats (DOCX/XLSX/PPTX)**: Requires [pandoc](https://pandoc.org/installing.html)

```bash
# macOS
brew install pandoc

# Linux
sudo apt-get install pandoc
```

## Usage

Plugin provides `officecli` tool with these actions:

### Create draft

```
officecli(action="create", filePath="/path/to/doc.docx", content="# My Document\n\nContent here")
```

Creates new draft. Real file not written until `accept`.

### Read document

```
officecli(action="read", filePath="/path/to/doc.pdf")
```

Returns markdown. For binary formats (PDF/DOCX/images), extracts text automatically.

### Edit draft

```
officecli(action="edit", filePath="/path/to/doc.docx", content="# Updated content")
```

Updates draft. Requires active lock (created by `create` or auto-acquired).

### Accept changes

```
officecli(action="accept", filePath="/path/to/doc.docx")
```

Writes draft to real file, records accept-point in history, releases lock. For binary formats, converts markdown → original format.

### Undo changes

```
officecli(action="undo", filePath="/path/to/doc.docx")
```

Discards draft, releases lock. Real file unchanged.

### View history

```
officecli(action="history", filePath="/path/to/doc.docx")
```

Returns JSON array with timestamps and session IDs:

```json
[
  {"timestamp": 1234567890, "sessionID": "abc123"},
  {"timestamp": 1234567900, "sessionID": "abc123"}
]
```

### Revert to snapshot

```
officecli(action="revert", filePath="/path/to/doc.docx", timestamp=1234567890)
```

Creates draft from historical snapshot. Must `accept` to write.

## How it works

**Draft lifecycle**: All edits happen in draft files. Real files only written on `accept`. This prevents accidental overwrites and enables undo.

**Lock system**: First mutating action (`create`/`edit`) acquires lock. Lock prevents concurrent edits from different sessions. Released on `accept` or `undo`.

**Format conversion**: Binary formats (PDF/DOCX/XLSX/PPTX/images) automatically converted to markdown for reading, and from markdown for writing (PDF via pandoc + xelatex). Text files handled directly.

**Version history**: Each `accept` records snapshot with timestamp. Use `history` to view, `revert` to restore.

## Supported formats

| Format | Read | Write | Backend |
|--------|------|-------|---------|
| Text (txt, md, etc.) | ✅ | ✅ | Native |
| PDF | ✅ | ✅ | pandoc + xelatex (read: pdfjs-dist + pdf-inspector) |
| DOCX | ✅ | ✅ | anydoc + docx library |
| XLSX | ✅ | ✅ | anydoc + exceljs |
| PPTX | ✅ | ✅ | anydoc + pandoc |
| Images (PNG, JPG) | ✅ | ✅ | anydoc + sharp |

All formats support full read/write cycle. PDF write requires a LaTeX engine (xelatex); override with the `pdfEngine` plugin option (e.g. `typst`) or the `OFFICECLI_PDF_ENGINE` environment variable.

**Export fidelity**: `export` converts between PDF/DOCX/XLSX/PPTX through the markdown pipeline, so layout, tables, and styling are approximate — text content is preserved, fine formatting is not. Layout-sensitive conversions (e.g. PDF → DOCX) are best-effort; use them for text extraction and lightweight editing, not for pixel-perfect round-trips.

## New Features

### V2 Plugin API

Plugin is built on the opencode 2 (V2) plugin API: `Plugin.define({ id: "openoffice", effect })` from `@opencode-ai/plugin/effect`. Tools (`officecli`, `edit`) are registered via `ctx.tool.transform` with `codemode: false` (direct provider exposure), and configured via `ctx.options` (`pdfEngine`, `staleLockHours`, `dataDir`). Real failures are thrown as typed `Tool.Error`; informational output stays a plain string. On shutdown, a scope finalizer logs orphaned drafts.

### Enhanced Formatting

DOCX writes now use `docx` library instead of pandoc for explicit table formatting (borders, cell widths, heading styles). Better round-trip fidelity for simple documents.

## Data storage

Plugin data stored in `~/.local/share/opencode/plugins/openoffice/` by default (override with the `dataDir` plugin option):

- `drafts/` - Active draft files
- `locks/` - Session locks
- `history/` - Version snapshots
- `registry/` - Registry of draft file paths keyed by hash (powers `list`)
- `sidecars/` - Non-content mutations (metadata, watermarks, annotations)

## Plugin options

Configure via the `plugins` entry's `options` object in opencode config:

```json
{
  "plugins": [
    {
      "package": "@openoffice/plugin",
      "options": {
        "pdfEngine": "typst",
        "staleLockHours": 48,
        "dataDir": "/shared/office-plugin-data"
      }
    }
  ]
}
```

- `pdfEngine` — pandoc PDF engine (default `xelatex`; env fallback `OFFICECLI_PDF_ENGINE`)
- `staleLockHours` — lock staleness threshold (default 24)
- `dataDir` — plugin data directory (default `~/.local/share/opencode/plugins/openoffice/`)

## Documentation

- [Install](docs/INSTALL.md) - Install the plugin in opencode (published + local dev)
- [Design](docs/DESIGN.md) - Architecture and data schema
- [Context](docs/CONTEXT.md) - Domain glossary
- [Testing](docs/TESTING.md) - Local development guide
- [Workflows](docs/WORKFLOWS.md) - Common usage patterns
- [Full Flow](docs/FULL-FLOW.md) - End-to-end orchestration
- [ADRs](docs/adr/) - Architecture decisions (CI/CD, V2 plugin API target)

## License

MIT
