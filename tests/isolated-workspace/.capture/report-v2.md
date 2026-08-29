# Report v2 — Styled defaults + Anthropics skills + Create-from-scratch (no template)

Generated: 2026-08-29 22:40 (Isolated Runtime, HOME=.home, opencode2 v0.0.0-beta-17823, dataDir=.data, pdfEngine=weasyprint)

## 1. Friendly copy of real forms
- Source: `/Users/xirothedev/Downloads/11. MS BỘ XÉT NGHIỆM VIRUS VIÊM GAN B C - Vạn  Niên` (43 files)
- Dest: `tests/isolated-workspace/fixtures/virus-hepatitis-bc-van-nien/` with manifest `manifest.json:1`
- Sanitized: NFD strip, `[^a-z0-9]+→-` lower, keep ext. E.g. `Đề nghị TT (mới).doc` → `e-nghi-tt-moi.doc`
- Verified via `scripts/test-real-forms.mjs` (8 sampled reads PASS, 500ms avg for docx/xlsx, 112ms pdf)

## 2. Spam baseline BEFORE styled defaults
- Script: `scripts/spam-baseline.mjs:1` — 10 creates (5 docx, 3 xlsx, 2 pdf) via `officecli create+accept` with minimal styling (heading H1/2/3, simple table PERCENTAGE, no shading)
- Result: **10/10 PASS** in 1.6s (docx 26ms avg, xlsx 10ms, pdf 750ms via weasyprint)
- Captures: `.capture/spam-baseline-report.json:1` + `.capture/*.json`
- Docs: `docs/spam-baseline/*.docx|xlsx|pdf`

## 3. Added Anthropics skills to plugin
- Cloned `https://github.com/anthropics/skills` @ main (144k stars) to `/tmp/anthropic-skills`
- Copied into plugin `skills/`:
  - `skills/docx/` (SKILL.md + scripts/office + schemas) — docx-js gotchas: A4, DXA dual widths, ShadingType.CLEAR, bullet numbering
  - `skills/xlsx/` — openpyxl, formulas via `=SUM`, recalc.py
  - `skills/pdf/` — forms, extract, fill
  - `skills/pptx/` — pptxgenjs
- Existing `skills/office/` (unified) kept; new `skills/docx|pdf|pptx|xlsx` are granular triggers for opencode `skills` discovery. No global pollution — Isolated Runtime loads only via `tests/isolated-workspace/opencode.json` `plugins: ["/Users/xirothedev/workspace/opencode-office-plugin"]`, not via `~/.config/opencode/skills`.

## 4. Version 2 — Styled defaults (more style default)
- `src/core/format/backends/docx.ts:1` **v2**: A4 11906×16838, 1" margins, `Calibri 11pt`, line 276, headings `Heading1/2/3` with bold+color `#1F4E79/#2E75B6` + spacing, tables: `WidthType.DXA` 9000 total, `columnWidths` equal, header `ShadingType.CLEAR fill D9E1F2` bold centered, borders `SINGLE B4C6E7`, bullet `numbering reference bullet`.
- `src/core/format/backends/xlsx.ts:1` **v2**: header bold `#1F4E79`, fill `FFD9E1F2`, thin borders `FFB4C6E7`, centered, frozen header, autoFilter, auto-width +4, wrapText.
- `src/core/format/backends/pdf.ts:1` **v2** + `pdf-style.css:1`: embedded CSS `@page A4 2cm`, `h1 20pt #1F4E79 border`, `th #D9E1F2`, `td border 0.5pt #B4C6E7`, `tr:nth-child(even) #F2F6FD`. `pandoc --pdf-engine=weasyprint --css=tmp.css`.
- Build: `bun run build` → `tsc && tsc-alias` OK, dist updated.

## 5. Version 2 — Create from scratch WITHOUT example/template
- Script: `scripts/test-v2-create.mjs:1` — pure `officecli(action="create", filePath, content="# ...")` + `accept`, no `templatePath`, no `dataArray`
- Cases (5):
  - `v2-styled.docx` 9350 bytes — heading H1/H2/H3, bullet `-`, table 3×6 with header shading true
  - `v2-styled.xlsx` 6912 bytes — sheet `Du toan` with header fill, formulas `=SUM`, frozen
  - `v2-styled.pdf` 11254 bytes — styled via CSS
  - `v2-styled.pptx` 28512 bytes — pandoc slides
  - `v2-minimal.docx` 8694 bytes — prose only, no table
- Result: **5/5 PASS** (docx 25ms, xlsx 14ms, pdf 887ms) — verified `unzip -p word/document.xml | grep D9E1F2` → `shading=true`
- Docs: `docs/v2/*.docx|xlsx|pdf|pptx`
- Via Orca: `orca terminal create --worktree active --title "v2-styled-create" --command 'bash -c "cd .../tests/isolated-workspace && bun run ./scripts/test-v2-create.mjs"'` → handle `term_cd2ac132-fd08-4b53-bcb9-0f0cc078583a` tail `EXIT:0`
- Conclusion: **No external office/pdf skill needed** for `create-from-scratch`. `generate` is only for batch `template + dataArray`. Simple create is:
  ```js
  officecli(action="create", filePath, content="# Title\n\n- bullet\n\n| A | B |\n| 1 | 2 |")
  officecli(action="accept", filePath)
  ```

## 6. Full regression
- `scripts/tracer.mjs` (Tracer Bullet `create→edit→read→accept→create→accept→history→revert→accept→read` per docx|xlsx|pptx|pdf) still **4/4 PASS** after v2.
- `scripts/test-real-forms.mjs` — `new-without-template.docx/pdf` (same create-from-scratch path) **PASS**, history 2 accept-points.
- Isolated TUI: `scripts/run-isolated.sh` → `HOME=.home` + `opencode2` (no global plugins) — `opencode2 --version` + `cat opencode.json` verified.

## 7. Answer: Do we need anthropics office/pdf skill for create without template?
**No.** The plugin's `officecli create` is the style-default path. Anthropics `docx/xlsx/pdf/pptx` skills are now bundled in `skills/` for advanced raw XML work (comments, tracked changes, soffice validate, recalc.py) but not required for simple `create`. Keep Isolated Runtime strict (only this plugin) — adding them as skills does not auto-install Python deps; use them only when you need `unzip→edit word/document.xml→zip`.

---
Files: `tests/isolated-workspace/fixtures/virus-hepatitis-bc-van-nien/manifest.json` map, `src/core/format/backends/docx.ts|xlsx.ts|pdf.ts|pdf-style.css` v2, `skills/docx|xlsx|pdf|pptx` anthropics copy, `docs/v2/*` outputs, `.capture/report.md` (tracer) + `spam-baseline-report.json` + `v2-*.json`.
