# Export writes a Derived file outside the single write path

Issue #6 (nice-to-have features) asks for an export action converting drafts between formats (docx → pdf, pdf → docx). Format conversion already exists at Accept, but only back to the original format. We add `officecli(action="export", filePath, targetPath)`, which converts the document's current state (draft if one exists, else the real file) and writes a new file at an explicit `targetPath`.

This write happens outside the "real file written only by Accept" rule — by design. The Derived file is a new artifact; the document's own real file, lock, draft, and version history are untouched. Export requires no lock and records no history entry.

Rejected: making export a format-changing Accept (the real file becomes the new format) — it would destroy the original, force lock/draft semantics onto a read-only operation, and pollute version history with conversion artifacts. Also rejected: returning converted content to the agent instead of writing a file — the agent would have no reliable way to persist large binary output.

**Consequences**: the single write path rule now applies to the document's canonical file only; CONTEXT.md gains the "Derived file" term. Export reuses the existing markdown conversion pipeline (any pair among PDF/DOCX/XLSX/PPTX), so fidelity limits of the markdown round-trip apply and are documented. Derived files are snapshots — not linked to later accepts.
