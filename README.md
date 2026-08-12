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

## Install

```bash
opencode plug @openoffice/plugin
```

Or add to `opencode.json`:

```json
{
  "plugin": ["@openoffice/plugin"]
}
```

## Requirements

- **PDF extraction**: Built-in (pdfjs-dist)
- **Image OCR**: Built-in (tesseract.js)
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

**Format conversion**: Binary formats (PDF/DOCX/XLSX/PPTX/images) automatically converted to markdown for reading, and from markdown for writing. Text files handled directly.

**Version history**: Each `accept` records snapshot with timestamp. Use `history` to view, `revert` to restore.

## Supported formats

| Format | Read | Write | Backend |
|--------|------|-------|---------|
| Text (txt, md, etc.) | ✅ | ✅ | Native |
| PDF | ✅ | ❌ | pdfjs-dist |
| DOCX | ✅ | ✅ | pandoc |
| XLSX | ✅ | ✅ | pandoc |
| PPTX | ✅ | ✅ | pandoc |
| Images (PNG, JPG) | ✅ | ❌ | tesseract.js |

PDF and image extraction are read-only. Office formats support full read/write cycle.

## Data storage

Plugin data stored in `~/.local/share/opencode/plugins/openoffice/`:

- `drafts/` - Active draft files
- `locks/` - Session locks
- `history/` - Version snapshots

## Documentation

- [Design](docs/DESIGN.md) - Architecture and data schema
- [Context](docs/CONTEXT.md) - Domain glossary
- [Testing](docs/TESTING.md) - Local development guide
- [Workflows](docs/WORKFLOWS.md) - Common usage patterns
- [Full Flow](docs/FULL-FLOW.md) - End-to-end orchestration

## License

MIT
