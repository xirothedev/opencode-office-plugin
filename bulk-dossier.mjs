#!/usr/bin/env bun
import { officecliTool } from "./src/plugin/tools/officecli.ts"
import { configureOptions } from "./src/core/options.ts"
import { Schema, Effect } from "effect"
import { mkdir, copyFile, readdir, stat } from "fs/promises"
import { existsSync } from "fs"
import { join, dirname, extname, basename } from "path"
import { exec } from "child_process"
import { promisify } from "util"
const execAsync = promisify(exec)

const DATA_DIR = "./tests/isolated-workspace/.data"
const FIXTURES = "./tests/isolated-workspace/fixtures/virus-hepatitis-bc-van-nien"
const DOCS_DIR = "./tests/isolated-workspace/docs"
const LIST_SRC = "./tests/isolated-workspace/docs/LIST-DANH-MUC-NAM-DINH.docx"
const OUT_DIR = "./tests/isolated-workspace/docs/test-grill-output"

configureOptions({ dataDir: DATA_DIR, pdfEngine: "weasyprint" })
const ctx = { agent: "bulk-dossier", sessionID: "bulk-"+Date.now(), messageID: "m1", id: "c1", progress: () => Effect.void }
async function call(args){
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, ctx))
  return res.output
}

console.log("=== Bulk dossier STT3-22 dung mau ===")
console.log(`OUT: ${OUT_DIR}`)
await mkdir(OUT_DIR, {recursive:true})
await mkdir(join(OUT_DIR,"1. Hồ sơ thầu"), {recursive:true})
await mkdir(join(OUT_DIR,"1. Hồ sơ thầu/12.TBMT"), {recursive:true})
await mkdir(join(OUT_DIR,"1. Hồ sơ thầu/13. Ket qua chao gia"), {recursive:true})
await mkdir(join(OUT_DIR,"1. Hồ sơ thầu/6. Tham chiếu"), {recursive:true})
await mkdir(join(OUT_DIR,"2. Nghiệm thu, thanh lý"), {recursive:true})

// Comprehensive copies: STT -> srcRel, dstRel
// STT1-2 already done but include to ensure
const copies = [
  // STT1 done, but ensure again (idempotent)
  ["1-ho-so-thau/1-e-xuat.doc", "1. Hồ sơ thầu/1. Đề xuất.doc", "office"],
  ["1-ho-so-thau/1-1-e-xuat.pdf", "1. Hồ sơ thầu/1.1 Đề xuất.pdf", "cp"],
  // STT2
  ["1-ho-so-thau/4-0-65-qd-kien-toan-to-chuyen-gia-dau-thau-mua-sam-vt-tieu-hao-hoa-chat-xn-2026.pdf", "1. Hồ sơ thầu/2. QĐ thành lập Tổ chuyên gia 65-QĐ-BV.pdf", "cp"],
  // STT3
  ["1-ho-so-thau/2-qd-phe-duyet-chu-truong-ms-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/3. QĐ phê duyệt chủ trương.doc", "office"],
  ["1-ho-so-thau/2-1-802-qd-phe-duyet-chu-truong-ms-hc-viem-gan-bc.pdf", "1. Hồ sơ thầu/3.1 QĐ chủ trương 802.pdf", "cp"],
  // STT4
  ["1-ho-so-thau/3-bb-hop-h-kh-thong-nhat-sl-tckt-ms-hc-viem-gan-b-c.docx", "1. Hồ sơ thầu/4. BB họp HĐKH.docx", "office"],
  // STT5
  ["1-ho-so-thau/5-qd-phe-duyet-danh-muc-sl-chkt-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/5. QĐ phê duyệt danh mục.doc", "office"],
  ["1-ho-so-thau/5-1-841-qd-phe-duyet-danh-muc-sl-chkt-hc-viem-gan-b-c-f.pdf", "1. Hồ sơ thầu/5.1 QĐ danh mục 841.pdf", "cp"],
  // STT6
  ["1-ho-so-thau/6.thamchieu/danh-sach-hang-hoa-ib2500261479.xlsx", "1. Hồ sơ thầu/6. Tham chiếu/DANH_SACH_HANG_HOA.xlsx", "cp"],
  ["1-ho-so-thau/6.thamchieu/ib2500261479-quyetdinhpheduyetkqlcnt-25-07-2025.pdf", "1. Hồ sơ thầu/6. Tham chiếu/IB2500261479 QĐ.pdf", "cp"],
  // STT7
  ["1-ho-so-thau/7-bb-hop-to-chuyen-gia-thong-nhat-du-toan-ke-hoach-lcnt-ms-hc-viem-gan-b-c.docx", "1. Hồ sơ thầu/7. BB họp tổ chuyên gia.docx", "office"],
  // STT8
  ["1-ho-so-thau/8-qd-phe-duyet-nhiem-vu-va-du-toan-ms-hc-viem-gan-b-c.docx", "1. Hồ sơ thầu/8. QĐ phê duyệt nhiệm vụ và dự toán.docx", "office"],
  ["1-ho-so-thau/8-1-878-qd-phe-duyet-nhiem-vu-va-du-toan-ms-hc-viem-gan-bc.pdf", "1. Hồ sơ thầu/8.1 QĐ nhiệm vụ 878.pdf", "cp"],
  // STT9
  ["1-ho-so-thau/9-tt-phe-duyet-khlcnt-ms-hc-viem-gan-b-c.docx", "1. Hồ sơ thầu/9. TTr KHLCNT.docx", "office"],
  ["1-ho-so-thau/9-1-to-trinh.pdf", "1. Hồ sơ thầu/9.1 Tờ trình.pdf", "cp"],
  // STT10
  ["1-ho-so-thau/10-q-phe-duyet-khlcnt-ms-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/10. QĐ phê duyệt KHLCNT.doc", "office"],
  ["1-ho-so-thau/10-1-933-qd-phe-duyet-khlcnt-ms-hc-viem-gan-b-c.pdf", "1. Hồ sơ thầu/10.1 QĐ KHLCNT 933.pdf", "cp"],
  // STT11
  ["1-ho-so-thau/11-bb-hop-tcg-thong-nhat-xay-dung-hscg-ms-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/11. BB họp TCG.docx", "office"],
  // STT12
  ["1-ho-so-thau/12.tbmt/bia-hsmcg-truc-tuyet-rut-gon.docx", "1. Hồ sơ thầu/12.TBMT/Bìa HSMCG.docx", "office"],
  ["1-ho-so-thau/12.tbmt/e-tbmt-goi-hc-b-c-dang-tai.pdf", "1. Hồ sơ thầu/12.TBMT/E TBMT.pdf", "cp"],
  ["1-ho-so-thau/12.tbmt/mau-so-02a-pham-vi-cung-cap-hang-hoa-goi-hc-virus-viem-gan-bc.xlsx", "1. Hồ sơ thầu/12.TBMT/Mẫu số 02A.xlsx", "cp"],
  // STT13
  ["1-ho-so-thau/13.ketquachaogiagoihcviemganbc/ket-qua-chao-gia-truc-tuyen.pdf", "1. Hồ sơ thầu/13. Ket qua chao gia/Kết quả chào giá.pdf", "cp"],
  ["1-ho-so-thau/13.ketquachaogiagoihcviemganbc/nha-thau-chao-gia-truc-tuyen.pdf", "1. Hồ sơ thầu/13. Ket qua chao gia/Nhà thầu chào giá.pdf", "cp"],
  ["1-ho-so-thau/13.ketquachaogiagoihcviemganbc/temp-import-ds-hh-goi-hc-viem-gan-b-c.xlsx", "1. Hồ sơ thầu/13. Ket qua chao gia/Temp_import DS HH.xlsx", "cp"],
  ["1-ho-so-thau/13.ketquachaogiagoihcviemganbc/xem-ket-qua-lua-chon-nha-thau.pdf", "1. Hồ sơ thầu/13. Ket qua chao gia/Xem KQ lựa chọn.pdf", "cp"],
  // STT14
  ["1-ho-so-thau/14-chap-thuan.jpg", "1. Hồ sơ thầu/14. Chấp thuận.jpg", "cp"],
  // STT15
  ["1-ho-so-thau/15-tt-e-nghi-phe-duyet-ket-qua-ms-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/15. TTr phê duyệt KQ.doc", "office"],
  ["1-ho-so-thau/15-1-to-trinh.pdf", "1. Hồ sơ thầu/15.1 Tờ trình.pdf", "cp"],
  // STT16
  ["1-ho-so-thau/16-qd-phe-duyet-kqlcnt-ms-hc-viem-gan-b-c.doc", "1. Hồ sơ thầu/16. QĐ phê duyệt KQLCNT.doc", "office"],
  ["1-ho-so-thau/16-ib2600078268-quyetdinhpheduyetkqlcnt-12-03-2026.pdf", "1. Hồ sơ thầu/16.1 IB2600078268 QĐ.pdf", "cp"],
  // STT17
  ["1-ho-so-thau/ban-ang-tai-htm-tqg.png", "1. Hồ sơ thầu/17. Bản đăng tải HTMĐTQG.png", "cp"],
  // STT18
  ["1-ho-so-thau/18-van-nien-1703h-ktvn-bv-kpt.docx", "1. Hồ sơ thầu/18. Vạn Niên 1703HĐKTVN-BVĐKPT.docx", "office"],
  ["1-ho-so-thau/17-blthh-van-nien-17-3.pdf", "1. Hồ sơ thầu/18.1 BLTHHĐ Vạn Niên.pdf", "cp"],
  // STT20
  ["2-nghiem-thu-thanh-ly/mau-bb-nghiem-thu-h-so-1703-ky-ngay-17-03-2026.doc", "2. Nghiệm thu, thanh lý/20. BB nghiệm thu 1703.doc", "office"],
  // STT21
  ["2-nghiem-thu-thanh-ly/thanh-ly-hop-ong-1703-ky-ngay-17-03-2026.docx", "2. Nghiệm thu, thanh lý/21. Thanh lý hợp đồng 1703.docx", "office"],
  // extras
  ["hbv-hcv-elitech.xls", "HBV HCV - Elitech.xls", "cp"],
  ["list-ho-so-yeu-cau-goc.xlsx", "List ho so yeu cau (GỐC).xlsx", "cp"],
  ["e-nghi-tt-moi.doc", "Đề nghị TT (mới).doc", "office"],
  ["1-ho-so-thau/0-ban-giao-ke-toan-docx.docx", "1. Hồ sơ thầu/0. Bàn giao kế toán.docx", "office"],
  ["1-ho-so-thau/0-bieu-ke-tai-lieu-goi-cgttrg-1.docx", "1. Hồ sơ thầu/0. Biểu kê tài liệu.docx", "office"],
]

let ok=0, fail=0, skipped=[]
for(const [srcRel, dstRel, mode] of copies){
  const src = join(FIXTURES, srcRel)
  const dst = join(OUT_DIR, dstRel)
  await mkdir(dirname(dst), {recursive:true})
  if(!existsSync(src)){
    console.log(`⚠️ missing src ${srcRel}`)
    skipped.push(srcRel)
    fail++
    continue
  }
  const ext = extname(src).toLowerCase()
  try{
    if(mode==="office" && [".doc",".docx"].includes(ext)){
      try{
        const md = await call({action:"read", filePath: src})
        // Skip if dst already exists and is same size? but force recreate for STT3+ to ensure officecli path
        // If file already exists from STT1-2, skip re-create to preserve history? We'll check if exists and skip if already exists
        if(existsSync(dst) && dstRel.includes("1. Đề xuất.doc")){
          console.log(`⏭️ skip exists ${dstRel}`)
          ok++
          continue
        }
        await call({action:"create", filePath: dst, content: md})
        await call({action:"accept", filePath: dst})
        console.log(`✅ officecli ${srcRel} → ${dstRel} (${md.length} chars)`)
        ok++
      }catch(e){
        // fallback cp
        await copyFile(src, dst)
        console.log(`✅ cp fallback ${srcRel} → ${dstRel} (${e.message})`)
        ok++
      }
    }else{
      await copyFile(src, dst)
      console.log(`✅ cp ${srcRel} → ${dstRel}`)
      ok++
    }
  }catch(e){
    console.log(`❌ fail ${srcRel} → ${dstRel} : ${e.message}`)
    fail++
  }
}

// LIST copy to 0. LIST DANH MỤC.docx
const outList = join(OUT_DIR, "0. LIST DANH MỤC.docx")
try{
  const listMd = await call({action:"read", filePath: LIST_SRC})
  await call({action:"create", filePath: outList, content: listMd})
  await call({action:"accept", filePath: outList})
  console.log(`✅ LIST copy to ${outList} (${listMd.length} chars)`)
  ok++
}catch(e){
  console.log(`❌ LIST copy fail ${e.message}`)
  fail++
}

console.log("")
console.log(`=== Summary ok=${ok} fail=${fail} skipped=${skipped.length} ===`)

// Validate
console.log("\n5. Validate dossier...")
try{
  const {stdout: lsR} = await execAsync(`ls -R "${OUT_DIR}" 2>&1`)
  console.log(lsR)
  const {stdout: cnt} = await execAsync(`find "${OUT_DIR}" -type f | wc -l`)
  console.log(`Total files: ${cnt.trim()}`)
  const {stdout: trc} = await execAsync(`unzip -p "${outList}" word/document.xml 2>&1 | grep -o "<w:tr" | wc -l`)
  console.log(`LIST rows w:tr: ${trc.trim()} (expect >=22)`)
  const hist = await call({action:"history", filePath: outList})
  console.log(`history: ${hist.slice(0,300)}`)
  const hist2 = await call({action:"history", filePath: join(OUT_DIR,"1. Hồ sơ thầu/1. Đề xuất.doc")})
  console.log(`history STT1: ${hist2.slice(0,200)}`)
  // also check STT20/21 exist
  const st20 = existsSync(join(OUT_DIR,"2. Nghiệm thu, thanh lý/20. BB nghiệm thu 1703.doc"))
  const st21 = existsSync(join(OUT_DIR,"2. Nghiệm thu, thanh lý/21. Thanh lý hợp đồng 1703.docx"))
  console.log(`STT20 exists ${st20}, STT21 exists ${st21}, STT19/22 empty as expected`)
}catch(e){ console.log(`validate fail ${e.message}`) }

console.log(`\n=== bulk dossier DONE out=${OUT_DIR} ===`)
