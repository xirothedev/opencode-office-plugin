#!/usr/bin/env bun
// Mock trigger of skills/ho-so-thau branch A — full generation with mock fields.
// Input: van-nien fixture (old dossier = Reference). Output: fixtures/output/hbv-hcv-2027-mock/
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { Schema, Effect } from "effect"
import { cpSync, mkdirSync, rmSync, existsSync } from "fs"
import { join, dirname, basename } from "path"
import { execSync } from "child_process"

const ROOT = "/Users/xirothedev/workspace/opencode-office-plugin"
const INPUT = join(ROOT, "tests/isolated-workspace/fixtures/virus-hepatitis-bc-van-nien")
const LIST_SRC = join(ROOT, "tests/isolated-workspace/docs/dossier-van-nien-LIST-DANH-MUC.docx")
const OUT = join(ROOT, "tests/isolated-workspace/fixtures/output/hbv-hcv-2027-mock")
const SCRATCH = "/tmp/hst-mock-scratch"
const PROFILE = "/tmp/hst-mock-soffice-profile"

configureOptions({ dataDir: join(ROOT, "tests/isolated-workspace/.data"), pdfEngine: "weasyprint" })
const ctx = { agent: "mock-dossier", sessionID: "mock", messageID: "m1", id: "c1", progress: () => Effect.void }
async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, ctx))
  return String(res.output)
}

// MOCK FIELDS (old van-nien value -> new mock value)
const STATIC_MAP = {
  "VẠN NIÊN": "MÔ PHỎNG MOCK",
  "Vạn Niên": "Mô Phỏng Mock",
  "IB2600078268": "IB2700000101",
  "65/QĐ-BV": "101/QĐ-BV",
  "802/QĐ-BV": "202/QĐ-BV",
  "841/QĐ-BV": "303/QĐ-BV",
  "878/QĐ-BV": "404/QĐ-BV",
  "933/QĐ-BV": "505/QĐ-BV",
  "1703/HĐKTVN-BVĐKPT": "1503/HĐKTVN-BVĐKPT",
  "1703": "1503",
  "18.3 TTr-TCG": "16.3 TTr-TCG",
  "06.4/TTr-TCG": "11.4/TTr-TCG",
  "viêm gan B, C": "viêm gan B, C (MOCK)",
  "viem gan B, C": "viem gan B, C (MOCK)",
}

// skill step 2: extract — dynamic dates found in the file itself (2026 -> 2027, same day/month)
function scanDates(text) {
  const map = {}
  for (const m of text.matchAll(/(\d{1,2})\/(\d{1,2})\/2026/g)) map[`${m[1]}/${m[2]}/2026`] = `${m[1]}/${m[2]}/2027`
  for (const m of text.matchAll(/(\d{1,2})\.(\d{1,2})\.2026/g)) map[`${m[1]}.${m[2]}.2026`] = `${m[1]}.${m[2]}.2027`
  if (text.includes("năm 2026")) map["năm 2026"] = "năm 2027"
  return map
}

// skill step 4: L3 path — clone -> substitute -> accept -> verify-l3; cp fallback when nothing matches
async function l3File(src, dst, label) {
  const md = await call({ action: "read", filePath: src })
  const fileMap = { ...STATIC_MAP, ...scanDates(md) }
  const present = Object.keys(fileMap).filter((k) => md.includes(k))
  const row = { label, dst: dst.replace(OUT + "/", ""), keys: present.length }
  if (present.length === 0) {
    cpSync(src, dst)
    row.status = "cp (no mock key present)"
    return row
  }
  try {
    await call({ action: "clone", filePath: src, targetPath: dst })
    const sub = await call({ action: "substitute", filePath: dst, data: JSON.stringify(fileMap) })
    row.n = (sub.match(/Substituted (\d+)/) || [])[1] ?? "0"
    await call({ action: "accept", filePath: dst })
    const v = await call({ action: "verify-l3", filePath: dst, referencePath: src })
    row.status = v.startsWith("L3 PASS") ? `L3 PASS (${row.n} subs)` : "L3 FAIL: " + v.slice(0, 100)
  } catch (e) {
    try { await call({ action: "undo", filePath: dst }) } catch {}
    if (existsSync(dst)) rmSync(dst)
    cpSync(src, dst)
    row.status = "cp fallback: " + String(e.message || e).slice(0, 90)
  }
  return row
}

function toDocx(docPath) {
  const name = basename(docPath).replace(/\.[^.]+$/, ".docx")
  execSync(`soffice --headless -env:UserInstallation=file://${PROFILE} --convert-to docx --outdir "${SCRATCH}" "${docPath}"`, { stdio: "pipe" })
  return join(SCRATCH, name)
}

// RAW files: per-tender platform outputs / images / archives — cp (L3 by copy)
const RAW = [
  ["1-ho-so-thau/1-1-e-xuat.pdf", "1. Hồ sơ thầu/1.1 Đề xuất.pdf"],
  ["1-ho-so-thau/4-0-65-qd-kien-toan-to-chuyen-gia-dau-thau-mua-sam-vt-tieu-hao-hoa-chat-xn-2026.pdf", "1. Hồ sơ thầu/2. QĐ thành lập Tổ chuyên gia 101-QĐ-BV.pdf"],
  ["1-ho-so-thau/2-1-802-qd-phe-duyet-chu-truong-ms-hc-viem-gan-bc.pdf", "1. Hồ sơ thầu/3.1 QĐ chủ trương 202.pdf"],
  ["1-ho-so-thau/5-1-841-qd-phe-duyet-danh-muc-sl-chkt-hc-viem-gan-b-c-f.pdf", "1. Hồ sơ thầu/5.1 QĐ danh mục 303.pdf"],
  ["1-ho-so-thau/6.thamchieu/danh-sach-hang-hoa-ib2500261479.xlsx", "1. Hồ sơ thầu/6. Tham chiếu/DANH_SACH_HANG_HOA.xlsx"],
  ["1-ho-so-thau/6.thamchieu/ib2500261479-quyetdinhpheduyetkqlcnt-25-07-2025.pdf", "1. Hồ sơ thầu/6. Tham chiếu/IB2500261479 QĐ.pdf"],
  ["1-ho-so-thau/8-1-878-qd-phe-duyet-nhiem-vu-va-du-toan-ms-hc-viem-gan-bc.pdf", "1. Hồ sơ thầu/8.1 QĐ nhiệm vụ 404.pdf"],
  ["1-ho-so-thau/9-1-to-trinh.pdf", "1. Hồ sơ thầu/9.1 Tờ trình.pdf"],
  ["1-ho-so-thau/10-1-933-qd-phe-duyet-khlcnt-ms-hc-viem-gan-b-c.pdf", "1. Hồ sơ thầu/10.1 QĐ KHLCNT 505.pdf"],
  ["1-ho-so-thau/12.tbmt/e-tbmt-goi-hc-b-c-dang-tai.pdf", "1. Hồ sơ thầu/12.TBMT/E TBMT đăng tải.pdf"],
  ["1-ho-so-thau/12.tbmt/e-tbmt-goi-hc-b-c-xem-truoc-2.pdf", "1. Hồ sơ thầu/12.TBMT/E TBMT xem trước.pdf"],
  ["1-ho-so-thau/12.tbmt/mau-so-02a-pham-vi-cung-cap-hang-hoa-goi-hc-virus-viem-gan-bc.xlsx", "1. Hồ sơ thầu/12.TBMT/Mẫu số 02A.xlsx"],
  ["1-ho-so-thau/13.ketquachaogiagoihcviemganbc/ket-qua-chao-gia-truc-tuyen.pdf", "1. Hồ sơ thầu/13. Kết quả chào giá/Kết quả chào giá.pdf"],
  ["1-ho-so-thau/13.ketquachaogiagoihcviemganbc/nha-thau-chao-gia-truc-tuyen.pdf", "1. Hồ sơ thầu/13. Kết quả chào giá/Nhà thầu chào giá.pdf"],
  ["1-ho-so-thau/13.ketquachaogiagoihcviemganbc/temp-import-ds-hh-goi-hc-viem-gan-b-c.xlsx", "1. Hồ sơ thầu/13. Kết quả chào giá/Temp_import DS HH.xlsx"],
  ["1-ho-so-thau/13.ketquachaogiagoihcviemganbc/xem-ket-qua-lua-chon-nha-thau.pdf", "1. Hồ sơ thầu/13. Kết quả chào giá/Xem KQ lựa chọn.pdf"],
  ["1-ho-so-thau/13.ketquachaogiagoihcviemganbc/xem-ket-qua-lua-chon-nha-thau-xem-truoc.pdf", "1. Hồ sơ thầu/13. Kết quả chào giá/Xem KQ lựa chọn (xem trước).pdf"],
  ["1-ho-so-thau/13.ketquachaogiagoihcviemganbc/nha-thau-chao-gia-truc-tuyen.zip", "1. Hồ sơ thầu/13. Kết quả chào giá/Nhà thầu chào giá.zip"],
  ["1-ho-so-thau/14-chap-thuan.jpg", "1. Hồ sơ thầu/14. Chấp thuận.jpg"],
  ["1-ho-so-thau/15-1-to-trinh.pdf", "1. Hồ sơ thầu/15.1 Tờ trình.pdf"],
  ["1-ho-so-thau/16-ib2600078268-quyetdinhpheduyetkqlcnt-12-03-2026.pdf", "1. Hồ sơ thầu/16.1 IB2700000101 QĐ.pdf"],
  ["1-ho-so-thau/ban-ang-tai-htm-tqg.png", "1. Hồ sơ thầu/17. Bản đăng tải HTMĐTQG.png"],
  ["1-ho-so-thau/17-blthh-van-nien-17-3.pdf", "1. Hồ sơ thầu/18.1 BLTHHĐ Mô Phỏng Mock.pdf"],
  ["hbv-hcv-elitech.xls", "HBV HCV - Elitech.xls"],
  ["list-ho-so-yeu-cau-goc.xlsx", "List ho so yeu cau (GỐC).xlsx"],
]

// DOCX templates: direct L3 path
const DOCX = [
  ["1-ho-so-thau/0-ban-giao-ke-toan-docx.docx", "1. Hồ sơ thầu/0. Bàn giao kế toán.docx", "STT0a"],
  ["1-ho-so-thau/0-bieu-ke-tai-lieu-goi-cgttrg-1.docx", "1. Hồ sơ thầu/0. Biểu kê tài liệu.docx", "STT0b"],
  ["1-ho-so-thau/3-bb-hop-h-kh-thong-nhat-sl-tckt-ms-hc-viem-gan-b-c.docx", "1. Hồ sơ thầu/4. BB họp HĐKH.docx", "STT4"],
  ["1-ho-so-thau/7-bb-hop-to-chuyen-gia-thong-nhat-du-toan-ke-hoach-lcnt-ms-hc-viem-gan-b-c.docx", "1. Hồ sơ thầu/7. BB họp tổ chuyên gia.docx", "STT7"],
  ["1-ho-so-thau/8-qd-phe-duyet-nhiem-vu-va-du-toan-ms-hc-viem-gan-b-c.docx", "1. Hồ sơ thầu/8. QĐ phê duyệt nhiệm vụ và dự toán.docx", "STT8"],
  ["1-ho-so-thau/9-tt-phe-duyet-khlcnt-ms-hc-viem-gan-b-c.docx", "1. Hồ sơ thầu/9. TTr KHLCNT.docx", "STT9"],
  ["1-ho-so-thau/12.tbmt/bia-hsmcg-truc-tuyet-rut-gon.docx", "1. Hồ sơ thầu/12.TBMT/Bìa HSMCG.docx", "STT12"],
  ["1-ho-so-thau/18-van-nien-1703h-ktvn-bv-kpt.docx", "1. Hồ sơ thầu/18. Mô Phỏng Mock 1503HĐKTVN-BVĐKPT.docx", "STT18"],
  ["2-nghiem-thu-thanh-ly/thanh-ly-hop-ong-1703-ky-ngay-17-03-2026.docx", "2. Nghiệm thu, thanh lý/21. Thanh lý hợp đồng 1503.docx", "STT21"],
]

// DOC-LEGACY: soffice -> docx, then L3 path (reference = converted file)
const DOCLEGACY = [
  ["1-ho-so-thau/1-e-xuat.doc", "1. Hồ sơ thầu/1. Đề xuất.docx", "STT1"],
  ["1-ho-so-thau/2-qd-phe-duyet-chu-truong-ms-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/3. QĐ phê duyệt chủ trương.docx", "STT3"],
  ["1-ho-so-thau/5-qd-phe-duyet-danh-muc-sl-chkt-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/5. QĐ phê duyệt danh mục.docx", "STT5"],
  ["1-ho-so-thau/10-q-phe-duyet-khlcnt-ms-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/10. QĐ phê duyệt KHLCNT.docx", "STT10"],
  ["1-ho-so-thau/11-bb-hop-tcg-thong-nhat-xay-dung-hscg-ms-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/11. BB họp TCG.docx", "STT11"],
  ["1-ho-so-thau/15-tt-e-nghi-phe-duyet-ket-qua-ms-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/15. TTr phê duyệt KQ.docx", "STT15"],
  ["1-ho-so-thau/16-qd-phe-duyet-kqlcnt-ms-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/16. QĐ phê duyệt KQLCNT.docx", "STT16"],
  ["2-nghiem-thu-thanh-ly/mau-bb-nghiem-thu-h-so-1703-ky-ngay-17-03-2026.doc", "2. Nghiệm thu, thanh lý/20. BB nghiệm thu 1503.docx", "STT20"],
  ["e-nghi-tt-moi.doc", "1. Hồ sơ thầu/Đề nghị TT (mới).docx", "STT0d"],
]

rmSync(SCRATCH, { recursive: true, force: true })
mkdirSync(SCRATCH, { recursive: true })
mkdirSync(OUT, { recursive: true })

const report = []

console.log("== RAW (cp) ==")
for (const [srcRel, dstRel] of RAW) {
  mkdirSync(dirname(join(OUT, dstRel)), { recursive: true })
  cpSync(join(INPUT, srcRel), join(OUT, dstRel))
  report.push({ label: basename(srcRel), dst: dstRel, status: "cp" })
}

console.log("== DOCX (L3) ==")
for (const [srcRel, dstRel, label] of DOCX) {
  mkdirSync(dirname(join(OUT, dstRel)), { recursive: true })
  report.push(await l3File(join(INPUT, srcRel), join(OUT, dstRel), label))
}

console.log("== DOC-LEGACY (soffice -> L3) ==")
for (const [srcRel, dstRel, label] of DOCLEGACY) {
  mkdirSync(dirname(join(OUT, dstRel)), { recursive: true })
  const conv = toDocx(join(INPUT, srcRel))
  report.push(await l3File(conv, join(OUT, dstRel), label))
}

console.log("== LIST DANH MỤC ==")
report.push(await l3File(LIST_SRC, join(OUT, "0. LIST DANH MỤC.docx"), "STT0c LIST"))

console.log("\n== REPORT ==")
for (const r of report) console.log(`${r.label.padEnd(14)} ${r.status.padEnd(24)} ${r.dst}`)
const ok = report.filter((r) => r.status === "cp" || r.status.startsWith("L3 PASS")).length
console.log(`\nTotal ${report.length} | ok ${ok} | issues ${report.length - ok}`)
if (report.length - ok > 0) process.exitCode = 1
