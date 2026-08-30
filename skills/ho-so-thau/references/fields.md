# Field map — "new info" per tender

Old values below are the Van Nien fixture (HBV/HCV 17/03/2026). At runtime, step 2 (Extract) confirms each old value from the actual input files; these examples are only for orientation and for matching which text to substitute.

## Fields the user provides

| Field | Meaning | Old example (Van Nien) | Appears in (STT) |
|---|---|---|---|
| F1 | Gói thầu / hạng mục name | "mua sắm (bộ) xét nghiệm định lượng virus viêm gan B, C" + variants | 0b, 0d, 1, 3, 4, 5, 7, 8, 9, 10, 11, 12, 15, 16, 18, 20, 21, LIST rows 1–11 |
| F2 | Nhà thầu (supplier name, address, country) | "ELITechGroup S.p.A.", "Italia/Italy" | 8, 15, 16, 18, 20, 21 |
| F-QĐ1 | QĐ thành lập TCG | 65/QĐ-BV | 3 (citation), 7, 8, 9, LIST row 2 |
| F-QĐ2 | QĐ phê duyệt chủ trương | 802/QĐ-BV | 3, 8, 9, LIST row 3 |
| F-QĐ3 | QĐ danh mục, SL, CHKT | 841/QĐ-BV | 5, 8, 9, LIST row 5 |
| F-QĐ4 | QĐ nhiệm vụ + dự toán | 878/QĐ-BV | 8, 9, LIST row 8 |
| F-QĐ5 | QĐ phê duyệt KHLCNT | 933/QĐ-BV | 9, 10, LIST row 10 |
| F-QĐ6 | QĐ phê duyệt KQLCNT | 1831/QĐ-BV (fixture) | 15, 16, LIST row 16 |
| F-TTR1 | Số tờ trình KHLCNT | 18.3 TTr-TCG | 9, LIST row 9 |
| F-TTR2 | Số tờ trình KQ | 06.4/TTr-TCG | 15, LIST row 15 |
| F-IB1 | E-TBMT tham chiếu | IB2500261479 (+ QĐ 4744/QĐ-BVE) | LIST row 6, 6.x files (names) |
| F-IB2 | E-TBMT gói mới | IB2600078268 | 12, 16.1 file names, LIST row 12 |
| F-HD | Hợp đồng số | 1703/HĐKTVN-BVĐKPT | 18, 20, 21, LIST row 18 |
| F-D1…F-D17 | Dates (dd/MM/yyyy), one per LIST row that has a date | 05/01/2026, 06/02/2026, 11/02/2026, 12/02/2026, 24/02/2026, 02/03/2026, 06/03/2026, 18/03/2026, 20/03/2026, 23/03/2026, 27/03/2026, 30/03/2026, 06/04/2026, 09/04/2026, 14/04/2026, 17/03/2026 (HĐ), nghiệm thu/thanh lý dates | docs named in the row + LIST |

Constants — do NOT substitute: hospital name "Bệnh viện đa khoa tỉnh Phú Thọ" (and "Đa khoa tỉnh Phú Thọ" variants), signatory names (Bùi Khánh Chân, Nguyễn Tuấn Anh, N.T. Hằng, Lê Anh Tuấn, Đào Anh Tuấn), legal citations (Luật/Nghị định/Thông tư). Exception: if a legal-citation year is stale for the new tender, flag it in the report — do not silently edit.

## Substitution mechanics (officecli `substitute`, anchor mode)

- `data` = `{oldText: newText}`; all occurrences of `oldText` in the file are replaced, run-preserving.
- Pass only keys present in that file (from Extract). An absent key is harmless, but zero total matches makes `substitute` fail with "no placeholders replaced" — then the file needs no edit, skip it.
- Prefer the longest exact string: substitute `878/QĐ-BV` before bare `878`; substitute `17/03/2026` (slash form) AND `ngày 17 tháng 03 năm 2026` (long form) if both occur — check both spellings in Extract.
- After `substitute`, the tool prints `Substituted N placeholders` — record N per file for the report.

## §dates — files touched by Branch B

STT 1, 3, 4, 5, 7, 8, 9, 10, 11, 12 (cover), 15, 16, 18, 20, 21 + `0. LIST DANH MỤC.docx` (all date cells). Read the LIST first to enumerate the old date strings actually present; that is the substitution scope.

## §supplier — files touched by Branch C

STT 8, 15, 16, 18 (+ 18.1 file name if the old supplier name is in the filename), 20, 21. Replace old supplier name (and address/country line if present) with the new one. Also rename the two 18.* files to carry the new supplier/contract name — move the `cp`d RAW 18.1 and note the rename in the report.
