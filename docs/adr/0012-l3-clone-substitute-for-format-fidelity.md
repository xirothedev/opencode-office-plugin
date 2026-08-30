# L3 Clone + Substitute for Format Fidelity

Problem: models and coding agents create new files from an existing example via `officecli read → markdown → create`. The markdown round-trip discards Format (theme, styles.xml, direct formatting w:rPr/w:pPr/a:rPr, numbering, header/footer, table grid, slide master, merged cells) because `pandoc` rebuilds OOXML from scratch. Multiple Format layers stack, so the new file looks 80-90% similar but never byte-identical.

Decision: keep Format by cloning the binary. Add two officecli actions:

- `clone(source, target)` — `copyFileSync` the ZIP verbatim (docx/xlsx/pptx). No conversion, no markdown.
- `substitute(filePath, data)` — open the Draft ZIP (jszip, already a dep), replace `{{key}}` tokens and/or text anchors inside `w:t`/`a:t`/`v`/`t` only, preserving every `w:rPr`/`w:pPr`/`styles.xml`/`theme`. Falls back to text-anchor replace when no placeholder exists.

Both run on the Draft (ZIP with PK header). `acceptDraft` already copies ZIP drafts verbatim (`src/core/draft/manager.ts:58`), so no new accept path is needed. XLSX/PPTX reuse the same ZIP path; PDF stays L1 (render via pandoc, or DOCX L3 → export to PDF for visual fidelity).

Skill Creator is extended to read a Reference file during grill, detect placeholder candidates, and emit a Template (`{{key}}` inside OOXML) as part of the Task Skill's references. The `grill → write` workflow gains a template-read/create step so the Enduser's daily task ships with a real Reference, not just a markdown example.

Considered options: rebuild via `docx`/`exceljs`/`pptxgenjs` from extracted styles (rejected — rebuild always generates a different styles.xml/theme, cannot reach L3); keep markdown as intermediate (rejected — lossy by design); add a new binary format library (rejected — jszip already present, one-line clone is the lazy path).

Consequences: `CONTEXT.md` gains Format, Reference, Template, L3 Fidelity. New actions are two functions + two tool branches (~80 lines, no new deps). A `verify_l3` helper unzips both files and asserts every XML is identical except text nodes, used in `test/core/format/l3.test.ts`. Agent workflow for new documents becomes `clone → substitute → accept` instead of `read → generate markdown → create`. Existing markdown flow remains for ad-hoc edits where L1 suffices.
