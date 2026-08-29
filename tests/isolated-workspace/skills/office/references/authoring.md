# Authoring: new documents, generation, conversion

## Content dialect per format

All write content is markdown. What maps where:

| Format | Markdown mapping | Gotcha |
|---|---|---|
| DOCX | `#`/`##`/`###` → Heading1/2/3 styles; pipe tables → real bordered tables; paragraphs → body text | Tables get explicit borders and cell widths from the docx backend |
| XLSX | First `# heading` = sheet name (optional); the **first** pipe table becomes the cell grid — later tables are dropped | A table is required — prose-only content errors with "No markdown table found". Numbers in cells stay numeric. Multi-sheet workbooks need one file per sheet or post-editing in Excel |
| PPTX | Markdown through the pandoc/anydoc pipeline; heading structure drives slide layout | Formatting fidelity is approximate |
| PDF | Markdown rendered through pandoc + LaTeX engine | Requires a LaTeX engine installed (`xelatex` default). Override with the `pdfEngine` plugin option or `OFFICECLI_PDF_ENGINE` env (e.g. `typst`) |
| Images | Not writable as markdown — use `watermark` / `annotate` sidecar actions instead | |
| Text (.txt/.md/.csv) | Written verbatim | |

## New document flow

```
officecli(action="create", filePath="report.docx", content="# Title
## Section
Body paragraph with **bold**.

| Col A | Col B |
|---|---|
| 1   | 2   |")
officecli(action="accept", filePath="report.docx")
```

Batch: pass `filePaths` as a JSON array string (`'["a.docx","b.docx"]'`) to `create` or `accept` to run several files in one call.

## Validation gate

Check draft content against rules before accepting — catches bad output before it lands:

```
officecli(action="validate", filePath="report.docx", rules='[
  {"type": "required", "pattern": "Total"},
  {"type": "regex", "pattern": "\\d{4}-\\d{2}-\\d{2}"}
]')
```

Rules: JSON array of `{type: "regex"|"required", pattern}` — regex matches anywhere, required checks presence. Output lists pass/fail per rule. Fail → fix the draft with `edit`, re-validate, then accept. On a failed gate you can also `undo`.

## Template generation

A **template** is any readable file on disk containing `{{VAR}}` placeholders — no special format, create it like any text file. `generate` substitutes structured data and creates one draft per data entry through the normal lifecycle:

```
officecli(action="generate",
  templatePath="./templates/decision-template.md",
  filePaths='["./out/micro.docx","./out/radio.docx"]',
  dataArray='[{"DEPT":"Microbiology","NUMBER":1},{"DEPT":"Radiology","NUMBER":2}]')
# then accept each file (batch accept works)
```

- Single item: `data='{...}'`; many items: `dataArray`
- Missing key in data → error listing the missing keys, nothing silently empties
- Each generated file still needs its own `accept`

## Conversion / export

`export filePath + targetPath` converts between any supported formats (extension decides) and writes a **derived file**: new file at targetPath, source document untouched — no lock, no draft, no history entry. Export reads the draft if one is open, else the real file.

Fidelity ceiling: conversions go through the markdown pipeline — text, tables, headings survive; fine styling, layout, images may not. Present cross-format results (especially PDF↔DOCX) as best-effort extraction, not faithful copies.
