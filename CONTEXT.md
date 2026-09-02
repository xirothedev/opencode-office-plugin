# OpenOffice Plugin — Office Document Automation

Isolated document lifecycle for DOCX/XLSX/PPTX/PDF inside opencode. Drafts are edited offline, versioned, then accepted.

## Language

### Runtime & Isolation

**Host Runtime**:
The developer's global opencode install at `~/.config/opencode/opencode.json` with all personal plugins and MCPs.
_Avoid_: Global install, main opencode

**Isolated Runtime**:
A clean opencode install under `tests/isolated-workspace/` with its own `opencode.json` that loads only this plugin and no global inheritance.
_Avoid_: Clean env, test opencode, local opencode

**Baseline Plugins**:
The exact plugin list the Isolated Runtime loads. Strict baseline is only `@xirothedev/openoffice-plugin-opencode`.
_Avoid_: Allowed plugins, pollution set

**Capture**:
JSON traces of each `officecli` invoke (input, output, duration, error) written to `tests/isolated-workspace/.capture/` during a run. For Skill Learning, also written to `.opencode/office/.capture/` on real office runs, same shape.
_Avoid_: Logs, traces, dumps

**Report**:
A single `report.md` summarizing pass/fail per Tracer Bullet flow, linked to its Capture files.
_Avoid_: Summary, test report, output

**Tracer Bullet**:
The minimal end-to-end flow `create → edit → read → history → revert` executed on each supported format (docx, xlsx, pptx, pdf) to prove the lifecycle works.
_Avoid_: Smoke test, e2e, happy path

**In-place Fix**:
A bug found in the Isolated Runtime is fixed in the main repo (`src/`), rebuilt, and re-verified by re-running the same Isolated Runtime.
_Avoid_: Patch, hotfix, direct fix

### Document Domain

**Draft**:
An editable copy of a document held under `.opencode/office/drafts/` with an exclusive lock.
_Avoid_: Working copy, edit buffer

**Comment intake**:
The single core module (`core/comments`) that routes comment operations to the DOCX/XLSX/PPTX adapters, sanitizing at the seam. The only comment surface the plugin layer may import.
_Avoid_: comment helper, comment utils

**Sidecar**:
A `.json` file next to a document storing non-content mutations (comments, track-changes state) that cannot be stored in the draft itself.
_Avoid_: Meta file, companion file

**Registry**:
The index mapping content hashes to document paths for draft lookup.
_Avoid_: Index, manifest

**Snapshot**:
An immutable version of a document stored on each `accept`, used by `history` and `revert`.
_Avoid_: Version, backup

**Accept**:
The operation that promotes a Draft to a Snapshot and overwrites the source file.
_Avoid_: Save, commit, apply

**Scanned PDF**:
A PDF where one or more pages are image-only and contain no extractable text, requiring OCR to produce Markdown.
_Avoid_: Scanned document, image PDF

**needsOcr**:
The `ConvertErrorCode` thrown by anydoc when a PDF contains Scanned PDF pages. Carries `pages` (1-indexed) and `pageCount`.
_Avoid_: OCR needed, scan error

**Hosted OCR**:
The `ocr: 'hosted'` path where anydoc sends the whole document to Firecrawl Parse (`/v2/parse`) for OCR. Networked, keyless or via `FIRECRAWL_API_KEY` / `FIRECRAWL_API_URL`; timeout 300s. Distinct from local extraction.
_Avoid_: OCR, cloud OCR, parse

**OCR**:
The generic concept of extracting text from images. Use **Hosted OCR** for the networked anydoc path.
_Avoid_: Text recognition

**Format**:
Everything in a document except text content — theme, styles.xml, direct formatting (w:rPr/w:pPr/a:rPr), numbering, header/footer, table grid, slide master, merged cells. Preserved by clone.
_Avoid_: Style, styling

**Reference**:
A real Office file that already carries the full Format, used to clone the ZIP verbatim and then substitute text. Distinct from a markdown example.
_Avoid_: Example, sample

**Template**:
A Reference that already contains `{{placeholder}}` tokens (e.g. `{{ten_goi_thau}}`) inside its OOXML text nodes. Clone + substitute replaces tokens while keeping all runs.
_Avoid_: Example file, mẫu

**L3 Fidelity**:
Byte-identical OOXML except text nodes — unzip two files, every XML identical except `w:t`/`a:t`/`v`/`t` values. The target for Procurement Dossier and any task that needs 100% format.
_Avoid_: Pixel perfect, exact copy

### Task & Skill Creation

**Enduser**:
The developer who installs `@xirothedev/openoffice-plugin-opencode` and creates Task Skills for repetitive work.
_Avoid_: User, client, clerk

**Task Skill**:
An opencode skill under `skills/` that automates one daily task. Owns its own `SKILL.md` and disclosed references.
_Avoid_: Workflow, plugin, script

**Skill Creator Workflow**:
The two-phase procedure `grill → write` that builds a new Task Skill from a daily task.
_Avoid_: Generator, scaffolder

**Dossier Index**:
The `LIST DANH MỤC` document that indexes a procurement dossier. The canonical 22-row table covering proposal through contract and acceptance.
_Avoid_: Checklist, manifest

**Procurement Dossier**:
The set of 22 documents for one HBV/HCV procurement, ordered by the Dossier Index. Each STT maps to one or more files in the dossier folder.
_Avoid_: Hồ sơ, package

**Verify Loop**:
The manual poll `set/add → query → validate → view` repeated to work around an `officecli` bug. Distinct from `Validate` (the typed gate). Eliminated by In-place Fix.
_Avoid_: Validation loop, check loop

**Skill Learning**:
The `Capture → proposal → accept` loop where `skills/office` proposes a `Learned Record` after a `verify-l3 PASS` + `Accept`, and the Enduser accepts it. Follows `Single write path`, not runtime self-mutation.
_Avoid_: Self improve, auto-learn

**Learned Record**:
A typed JSON entry in `.opencode/office/learned/learned.json` (per-project) plus generated `learned.md` view, capturing a verified Template structure, `Format` requirement, or `Verify Loop` workaround that passed `verify-l3`. Replayed next session to avoid the loop.
_Avoid_: Learned lesson, memo

