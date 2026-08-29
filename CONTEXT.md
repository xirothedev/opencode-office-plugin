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
JSON traces of each `officecli` invoke (input, output, duration, error) written to `tests/isolated-workspace/.capture/` during a run.
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

