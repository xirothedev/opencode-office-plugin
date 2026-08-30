---
name: ho-so-thau
description: "Hồ sơ thầu" (procurement dossier) — build or update the 22-document tender dossier (0. LIST DANH MỤC + 1. Hồ sơ thầu + 2. Nghiệm thu, thanh lý), L3-faithful to the old mẫu. Use when creating a new dossier from an input folder ("tạo mới bộ hồ sơ thầu"), updating dates in an existing dossier ("cập nhật ngày tháng"), changing supplier info ("đổi thông tin nhà thầu"), or adding missing table rows ("bảng thiếu hàng").
---

# Hồ sơ thầu (Procurement Dossier)

Generate or update the 22-document Procurement Dossier by cloning the old dossier (Reference) so Format survives (L3 Fidelity). Uses only `officecli` + `cp` + `soffice` — no scripts.

## Inputs (confirm all before any write)

- **Input folder** — old dossier (mẫu cũ) + raw files, e.g. a folder with `1-ho-so-thau/`, `2-nghiem-thu-thanh-ly/` (or the numbered `1. Hồ sơ thầu` layout).
- **Output dir** — default `<input-parent>/output/<ten-goi-thau>/`. Ask if user gave no name.
- **New fields** — per `references/fields.md`. Ask the user for missing values; never guess QĐ numbers, IB numbers, contract number, or dates.

Completion: all three confirmed; missing fields either answered by user or explicitly deferred.

## Branches

| Trigger | Branch |
|---|---|
| "tạo mới bộ hồ sơ thầu", "new dossier" | A — full generation |
| "cập nhật ngày tháng", "đổi ngày" | B — date update on existing output |
| "đổi thông tin nhà thầu", "change supplier" | C — supplier update on existing output |
| "bảng thiếu hàng", "bổ sung hàng", "missing row" | D — add missing table row |

## Branch A — full generation

1. **Inventory** — `ls -R <input>`; match every file to a row in `references/mapping.md`. Completion: every STT 1–22 + every extra row has a source file or is flagged `MISSING` (ask user: supply file or skip).
2. **Extract** — `officecli read` each DOCX source; for each DOC-LEGACY source run `soffice --headless --convert-to docx --outdir <scratch> <src>` first, then read the converted file. Record the actual old value of every field from `references/fields.md` that appears. Completion: old value confirmed from the file itself for every field that will be substituted — none assumed.
3. **Substitute map** — build per-file `{oldValue: newValue}` JSON subsets from the user's new fields + step 2. Use the longest exact string as key (e.g. `1703/HĐKTVN-BVĐKPT`, then bare `1703`). A file gets only keys actually present in it.
4. **Generate**, in STT order per `references/mapping.md`:
   - RAW (.pdf/.png/.jpg/.zip/.xls) — `cp src dst`. L3 by copy.
   - DOCX — `officecli clone src dst` → `officecli substitute dst data=<map>` → `officecli accept dst` → `officecli verify-l3 dst referencePath=src` (must PASS). verify-l3 reads the accepted file, so it runs after accept; on FAIL delete `dst` and redo the step from `src`.
   - DOC-LEGACY — `soffice --headless --convert-to docx --outdir <scratch> src` first, then run the DOCX path on the converted file (reference = converted file); output keeps `.docx` extension. ponytail: Word 2007+ output instead of OLE .doc; convert back with `soffice --convert-to doc` only if the user demands the old extension.
   - `0. LIST DANH MỤC.docx` (Dossier Index) — find it in the input folder, or ask the user for its path; clone → substitute all date/QĐ/IB/HĐ cells for the 22 rows → accept → verify-l3 vs source.
   - `substitute` throws if nothing matched — if a file expected substitutions reports 0, re-check the key spelling against step 2, do not accept blindly.
5. **Report** — table: STT → output file → status (`L3 PASS` / `cp` / `MISSING` / `manual`). Completion: every STT + extra row accounted for; every DOCX/DOC-LEGACY file that received substitutions has a recorded `verify-l3 PASS`.

## Branch B — update dates (existing output dossier)

1. Confirm output dir + old→new date pairs. Read `0. LIST DANH MỤC.docx` to see which old dates actually exist; never infer dates the user did not state.
2. For each file listed in `references/fields.md` §dates: `cp <out>/X <scratch>/X.pristine` → `officecli clone <scratch>/X.pristine <out>/X` → `officecli substitute <out>/X data={oldDate:newDate,...}` → `officecli accept <out>/X` → `officecli verify-l3 <out>/X referencePath=<scratch>/X.pristine` (PASS; runs after accept because verify-l3 reads the accepted file — on FAIL delete `<out>/X` and redo the step).
3. Repeat for `0. LIST DANH MỤC.docx` (every date cell, not just the changed ones' row).

Completion: verify-l3 PASS on every touched file; `officecli read` of the LIST shows the new dates.

## Branch C — change supplier (existing output dossier)

Same flow as B, with supplier name/address pairs (plus old supplier's name in file titles if present) applied to the files in `references/fields.md` §supplier. Completion: same gates as B.

## Branch D — missing table row

1. Identify file + table (user names the STT or path); confirm the missing row's full content with the user.
2. `officecli read X` → markdown; insert the row into the pipe table with every column filled.
3. `officecli create X content=<full markdown>` → `officecli accept X`.
   ponytail: markdown round-trip rebuilds this one file (L1, not L3) — row content is correct, fine styling may drift. Acceptable only for the single file being fixed; if the user needs the table to stay L3, stop and ask.
4. `officecli read X` — new row present.

Completion: new row visible in read-back; report names the rebuilt file and that it is L1.

Skipped: `scripts/` — officecli + cp + soffice cover every branch; add a script only if a branch needs a check none of these can express.
