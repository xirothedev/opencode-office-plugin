# Authoring: new documents, generation, conversion

> Bundled: `skills/docx`, `skills/xlsx`, `skills/pptx`, `skills/pdf` (anthropics/skills, source-available). For simple markdown tables/headings `officecli` v2 styled backends are enough; for precise layout, read the format skill's gotchas section — it prevents silent corruption.

## Content dialect per format

All write content is markdown. What maps where:

| Format | Markdown mapping | Gotcha + where to read more |
|---|---|---|
| DOCX | `#`/`##`/`###` → Heading1/2/3; pipe tables → real bordered tables with DXA dual widths, `CLEAR` shading, bold D9E1F2 header | See `skills/docx/SKILL.md:15` — A4 vs Letter `12240×15840`, `columnWidths` + cell `width` sum, `ShadingType.CLEAR`, `numbering` not `•`, `ImageRun type`, `PageBreak` inside `Paragraph` |
| XLSX | First `# heading` = sheet name; **first** pipe table = cell grid — later tables dropped | `skills/xlsx/SKILL.md:12` — `openpyxl` + `scripts/recalc.py` mandatory, formulas not literals, two `load_workbook` passes, `_xlfn.` prefix, no `XLOOKUP`/`FILTER` |
| PPTX | Markdown via pandoc/anydoc; heading → slide layout | `skills/pptx/SKILL.md:15` — `pptxgenjs` (`pres.layout` 10"×5.625", `color:"FF0000"` no `#`, fresh option objects, `showTitle`/`chartColors`, `validate.py`) |
| PDF | Markdown → pandoc + engine (default `weasyprint`, fallback `xelatex`) | `skills/pdf/SKILL.md` + `reference.md` — `pypdf`/`pdfplumber`/`reportlab`; fillable forms → `forms.md` |
| Images | Not writable as markdown — use `watermark` / `annotate` sidecar actions instead | — |
| Text (.txt/.md/.csv) | Written verbatim | — |

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
