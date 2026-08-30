# STT → file mapping (Dossier Index, 22 rows + extras)

Input naming varies (fixture-style slugs `1-e-xuat.doc` or numbered `1. Đề xuất.doc`). Match by leading number + type + topic, not exact filename.

Type: `RAW` = per-tender output (platform PDFs, scans, images, archives, .xls) — `cp`. `DOCX` = L3 clone+substitute. `DOC-LEGACY` = OLE .doc, soffice→docx then L3 path.

## 0. Root

| STT | Nội dung | Input (fixture example) | Output path | Type | Fields |
|---|---|---|---|---|---|
| STT 0a | Bàn giao kế toán | `1-ho-so-thau/0-ban-giao-ke-toan*.docx` | `1. Hồ sơ thầu/0. Bàn giao kế toán.docx` | DOCX | F1 |
| STT 0b | Biểu kê tài liệu gói CGTTRG | `1-ho-so-thau/0-bieu-ke-tai-lieu*.docx` | `1. Hồ sơ thầu/0. Biểu kê tài liệu.docx` | DOCX | F1 |
| STT 0c | LIST DANH MỤC (Dossier Index, 22 rows) | input root, or user-supplied path | `0. LIST DANH MỤC.docx` | DOCX | all |
| STT 0d | Đề nghị TT (mới) | `e-nghi-tt-moi.doc` | `1. Hồ sơ thầu/Đề nghị TT (mới).docx` | DOC-LEGACY | F1, dates |
| STT 0e | Bảng giá HBV/HCV | `hbv-hcv-*.xls` | `HBV HCV - <nha-thau>.xls` | RAW | — |
| STT 0f | List yêu cầu (GỐC) | `list-ho-so-yeu-cau-goc.xlsx` | `List ho so yeu cau (GÓC).xlsx` | RAW | — |

## 1. Hồ sơ thầu

| STT | Nội dung | Input (fixture example) | Output path | Type | Fields |
|---|---|---|---|---|---|
| STT 1 | Đề xuất | `1-ho-so-thau/1-e-xuat.doc` | `1. Hồ sơ thầu/1. Đề xuất.docx` | DOC-LEGACY | F1, F2, dates |
| STT 1.1 | Đề xuất (PDF) | `1-ho-so-thau/1-1-e-xuat.pdf` | `1. Hồ sơ thầu/1.1 Đề xuất.pdf` | RAW | — |
| STT 2 | QĐ thành lập Tổ chuyên gia | `1-ho-so-thau/4-0-65-qd-kien-toan*.pdf` (may be .doc/.docx in other dossiers) | `1. Hồ sơ thầu/2. QĐ thành lập Tổ chuyên gia.pdf` | RAW | — |
| STT 3 | QĐ phê duyệt chủ trương | `1-ho-so-thau/2-qd-phe-duyet-chu-truong*.doc` | `1. Hồ sơ thầu/3. QĐ phê duyệt chủ trương.docx` | DOC-LEGACY | F1, F-QĐ2, dates |
| STT 3.1 | QĐ chủ trương (PDF) | `1-ho-so-thau/2-1-802-qd*.pdf` | `1. Hồ sơ thầu/3.1 QĐ chủ trương <số>.pdf` | RAW | — |
| STT 4 | BB họp HĐKH thống nhất SL, TCKT | `1-ho-so-thau/3-bb-hop-h-kh*.docx` | `1. Hồ sơ thầu/4. BB họp HĐKH.docx` | DOCX | F1, dates |
| STT 5 | QĐ phê duyệt danh mục, SL, CHKT | `1-ho-so-thau/5-qd-phe-duyet-danh-muc*.doc` | `1. Hồ sơ thầu/5. QĐ phê duyệt danh mục.docx` | DOC-LEGACY | F1, F-QĐ3, dates |
| STT 5.1 | QĐ danh mục (PDF) | `1-ho-so-thau/5-1-841-qd*.pdf` | `1. Hồ sơ thầu/5.1 QĐ danh mục <số>.pdf` | RAW | — |
| STT 6 | Tham chiếu giá (12 tháng) | `1-ho-so-thau/6.thamchieu/danh-sach-hang-hoa*.xlsx` + `*.pdf` | `1. Hồ sơ thầu/6. Tham chiếu/` | RAW | — |
| STT 7 | BB họp TCG: dự toán + KHLCNT | `1-ho-so-thau/7-bb-hop-to-chuyen-gia*.docx` | `1. Hồ sơ thầu/7. BB họp tổ chuyên gia.docx` | DOCX | F1, dates |
| STT 8 | QĐ nhiệm vụ + dự toán | `1-ho-so-thau/8-qd-phe-duyet-nhiem-vu*.docx` | `1. Hồ sơ thầu/8. QĐ phê duyệt nhiệm vụ và dự toán.docx` | DOCX | F1, F2, F-QĐ4, dates |
| STT 8.1 | QĐ nhiệm vụ (PDF) | `1-ho-so-thau/8-1-878-qd*.pdf` | `1. Hồ sơ thầu/8.1 QĐ nhiệm vụ <số>.pdf` | RAW | — |
| STT 9 | Tờ trình KHLCNT | `1-ho-so-thau/9-tt-phe-duyet-khlcnt*.docx` | `1. Hồ sơ thầu/9. TTr KHLCNT.docx` | DOCX | F1, F-TTR1, F-QĐ5, dates |
| STT 9.1 | Tờ trình (PDF) | `1-ho-so-thau/9-1-to-trinh.pdf` | `1. Hồ sơ thầu/9.1 Tờ trình.pdf` | RAW | — |
| STT 10 | QĐ phê duyệt KHLCNT | `1-ho-so-thau/10-q-phe-duyet-khlcnt*.doc` | `1. Hồ sơ thầu/10. QĐ phê duyệt KHLCNT.docx` | DOC-LEGACY | F1, F-QĐ5, dates |
| STT 10.1 | QĐ KHLCNT (PDF) | `1-ho-so-thau/10-1-933-qd*.pdf` | `1. Hồ sơ thầu/10.1 QĐ KHLCNT <số>.pdf` | RAW | — |
| STT 11 | BB họp TCG xây dựng HSCG | `1-ho-so-thau/11-bb-hop-tcg*.doc` | `1. Hồ sơ thầu/11. BB họp TCG.docx` | DOC-LEGACY | F1, dates |
| STT 12 | Bìa HSMCG + TBMT + Mẫu 02A | `1-ho-so-thau/12.tbmt/*.docx/.pdf/.xlsx` | `1. Hồ sơ thầu/12.TBMT/` | DOCX + RAW | F1, F-IB2 |
| STT 13 | Kết quả chào giá trực tuyến | `1-ho-so-thau/13.*/pdf/xlsx/zip` | `1. Hồ sơ thầu/13. Kết quả chào giá/` | RAW | — |
| STT 14 | Xác nhận chấp thuận (scan) | `1-ho-so-thau/14-chap-thuan.jpg` | `1. Hồ sơ thầu/14. Chấp thuận.jpg` | RAW | — |
| STT 15 | Tờ trình phê duyệt KQ | `1-ho-so-thau/15-tt-e-nghi*.doc` | `1. Hồ sơ thầu/15. TTr phê duyệt KQ.docx` | DOC-LEGACY | F1, F2, F-TTR2, dates |
| STT 15.1 | Tờ trình (PDF) | `1-ho-so-thau/15-1-to-trinh.pdf` | `1. Hồ sơ thầu/15.1 Tờ trình.pdf` | RAW | — |
| STT 16 | QĐ phê duyệt KQLCNT | `1-ho-so-thau/16-qd-phe-duyet-kqlcnt*.doc` | `1. Hồ sơ thầu/16. QĐ phê duyệt KQLCNT.docx` | DOC-LEGACY | F1, F2, F-QĐ6, dates |
| STT 16.1 | QĐ KQLCNT (PDF) | `1-ho-so-thau/16-ib*-quyetdinh*.pdf` | `1. Hồ sơ thầu/16.1 <IB> QĐ.pdf` | RAW | — |
| STT 17 | TB trúng thầu / đăng tải HTMĐT | `1-ho-so-thau/ban-ang-tai-htm-tqg.png` (or .pdf) | `1. Hồ sơ thầu/17. Bản đăng tải HTMĐTQG.png` | RAW | — |
| STT 18 | BLTH hợp đồng (Bản thuyết minh) | `1-ho-so-thau/18-*.docx` + `17-blthh*.pdf` | `1. Hồ sơ thầu/18. <NhaThau> <HD>.docx` + `18.1 BLTHHĐ <NhaThau>.pdf` | DOCX + RAW | F2, F-HD, dates |
| STT 19 | Hoá đơn | — (arrives after delivery) | `1. Hồ sơ thầu/19. Hoá đơn.pdf` | MISSING default | — |

## 2. Nghiệm thu, thanh lý

| STT | Nội dung | Input (fixture example) | Output path | Type | Fields |
|---|---|---|---|---|---|
| STT 20 | BB nghiệm thu | `2-nghiem-thu-thanh-ly/mau-bb-nghiem-thu*.doc` | `2. Nghiệm thu, thanh lý/20. BB nghiệm thu <HD>.docx` | DOC-LEGACY | F1, F2, F-HD, dates |
| STT 21 | Thanh lý hợp đồng | `2-nghiem-thu-thanh-ly/thanh-ly-hop-ong*.docx` | `2. Nghiệm thu, thanh lý/21. Thanh lý hợp đồng <HD>.docx` | DOCX | F1, F2, F-HD, dates |
| STT 22 | 08A | — (system form, usually blank in dossier) | — | MISSING default | — |

`<số>` / `<HD>` / `<NhaThau>` / `<IB>` in output names come from the new field values, not the old file name.
