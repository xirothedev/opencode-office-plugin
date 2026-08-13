# PDF write goes through pandoc with a xelatex engine, not a JS PDF library

PDF write (markdown → PDF at Accept) uses the pandoc backend already required for DOCX/XLSX/PPTX writes, invoked with `--pdf-engine=xelatex` (default; engine overridable via environment variable).

Rejected: `pdf-lib` (pure JS, but it authors PDFs from primitives — markdown → PDF would require a bespoke layout engine with poor page-break, table, and Unicode handling; `pdfjs-dist` is read-only by design). Pandoc adds zero new dependencies and produces real document typography; xelatex is chosen over the pandoc default pdflatex because output documents carry Vietnamese diacritics, which pdflatex renders poorly.

**Consequences**: a working LaTeX installation (xelatex) is a hard requirement for PDF write; README documents it. PDF joins the writable formats; image write remains unsupported.
