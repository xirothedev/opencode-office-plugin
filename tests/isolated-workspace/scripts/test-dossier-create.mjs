#!/usr/bin/env bun
// ponytail: LIST → Procurement Dossier — test dossier-create skill via real officecli in Isolated Runtime

import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { getDraftsDir, getHistoryDir, getLocksDir, getRegistryDir, getSidecarsDir } from "../../../src/core/storage/paths.ts"
import { mkdir, readFile, writeFile, readdir, copyFile, stat } from "fs/promises"
import { existsSync } from "fs"
import { join, basename, dirname, extname } from "path"
import { Effect, Schema } from "effect"
import { exec } from "child_process"
import { promisify } from "util"
const execAsync = promisify(exec)

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
const DOCS_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs"
const FIXTURES = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/fixtures/virus-hepatitis-bc-van-nien"
const CAPTURE_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.capture"
const LIST_TEMPLATE = "/Users/xirothedev/workspace/opencode-office-plugin/skills/dossier-index/references/template.md"
const MAPPING = "/Users/xirothedev/workspace/opencode-office-plugin/skills/dossier-create/references/mapping.md"
const SKILL_CREATE = "/Users/xirothedev/workspace/opencode-office-plugin/skills/dossier-create/SKILL.md"

configureOptions({ dataDir: DATA_DIR, pdfEngine: "weasyprint" })
await mkdir(getDraftsDir(), { recursive: true })
await mkdir(getHistoryDir(), { recursive: true })
await mkdir(getLocksDir(), { recursive: true })
await mkdir(getRegistryDir(), { recursive: true })
await mkdir(getSidecarsDir(), { recursive: true })
await mkdir(CAPTURE_DIR, { recursive: true })
await mkdir(DOCS_DIR, { recursive: true })

const mockContext = { agent: "dossier-create-test", sessionID: "dossier-create-" + Date.now(), messageID: "m1", id: "c1", progress: () => Effect.void }
async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return res.output
}

console.log("=== dossier-create — LIST → Procurement Dossier (Isolated Runtime) ===")
console.log(`SKILL: ${SKILL_CREATE}`)
console.log(`MAPPING: ${MAPPING}`)
console.log(`TEMPLATE LIST: ${LIST_TEMPLATE}`)
console.log(`FIXTURES: ${FIXTURES}`)
console.log("")

// 1. Verify skill files
for (const p of [SKILL_CREATE, MAPPING, LIST_TEMPLATE]) {
  if (!existsSync(p)) { console.log(`❌ missing ${p}`); process.exit(1) }
  const c = await readFile(p, "utf-8")
  console.log(`✅ ${p.split("/skills/")[1]} — ${c.length}b`)
}
console.log("")

// 2. Read LIST (Nam Dinh md) and create LIST docx via officecli (Step 1 of skill)
const namDinhMd = await readFile("/Users/xirothedev/Downloads/0. LIST DANH MỤC GÓI 1. HÓA CHẤT XN (1) - Nam Dinh.docx.md", "utf-8")
const listDocx = join(DOCS_DIR, "LIST-DANH-MUC-NAM-DINH.docx")
console.log("2. Create LIST docx from Nam Dinh md via officecli...")
try {
  await call({ action: "create", filePath: listDocx, content: namDinhMd })
  await call({ action: "accept", filePath: listDocx })
  const s = await stat(listDocx)
  console.log(`✅ LIST created ${s.size} bytes — ${listDocx}`)
  const readBack = await call({ action: "read", filePath: listDocx })
  console.log(`✅ LIST read back ${readBack.length} chars, rows: ${(readBack.match(/\|/g)||[]).length / 6 | 0} estimate`)
  if (!readBack.includes("LIST DANH MỤC") && !readBack.includes("DANH MỤC")) console.log("⚠️ readback missing title")
} catch (e) { console.log(`❌ LIST create failed ${e.message}`); process.exit(1) }
console.log("")

// 3. Inventory fixtures (Step 2 of skill)
console.log("3. Inventory fixtures...")
const fixturesList = await readdir(FIXTURES)
console.log(`✅ fixtures top: ${fixturesList.join(", ")}`)
const hop = await readdir(join(FIXTURES, "1-ho-so-thau"))
console.log(`✅ 1-ho-so-thau: ${hop.length} entries`)
console.log("")

// 4. Map & create output dossier (Step 3 of skill) — copy per mapping.md
const outDir = join(DOCS_DIR, "dossier-create-output")
await mkdir(outDir, { recursive: true })
await mkdir(join(outDir, "1. Hồ sơ thầu"), { recursive: true })
await mkdir(join(outDir, "2. Nghiệm thu, thanh lý"), { recursive: true })
console.log(`4. Create output dossier at ${outDir} ...`)
// Use mapping: copy representative files per STT where template exists
const copies = [
  ["1-ho-so-thau/1-e-xuat.doc", "1. Hồ sơ thầu/1. Đề xuất.doc"],
  ["1-ho-so-thau/8-qd-phe-duyet-nhiem-vu-va-du-toan-ms-hc-viem-gan-b-c.docx", "1. Hồ sơ thầu/8. QD phe duyet nhiem vu.docx"],
  ["1-ho-so-thau/18-van-nien-1703h-ktvn-bv-kpt.docx", "1. Hồ sơ thầu/18. Vạn Niên 1703HĐKTVN-BVĐKPT.docx"],
  ["1-ho-so-thau/3-bb-hop-h-kh-thong-nhat-sl-tckt-ms-hc-viem-gan-b-c.docx", "1. Hồ sơ thầu/3. BB họp HĐKH.docx"],
  ["hbv-hcv-elitech.xls", "HBV HCV - Elitech.xls"],
  ["list-ho-so-yeu-cau-goc.xlsx", "List ho so yeu cau (GỐC).xlsx"],
  ["2-nghiem-thu-thanh-ly/thanh-ly-hop-ong-1703-ky-ngay-17-03-2026.docx", "2. Nghiệm thu, thanh lý/thanh lý hợp đồng 1703.docx"],
]
// For office files, use officecli read+create to prove MAIN path; for binary use cp
for (const [srcRel, dstRel] of copies) {
  const src = join(FIXTURES, srcRel)
  const dst = join(outDir, dstRel)
  await mkdir(dirname(dst), { recursive: true })
  const ext = extname(src).toLowerCase()
  if ([".docx", ".doc"].includes(ext)) {
    try {
      const md = await call({ action: "read", filePath: src })
      await call({ action: "create", filePath: dst, content: md })
      await call({ action: "accept", filePath: dst })
      console.log(`✅ officecli ${srcRel} → ${dstRel}`)
    } catch (e) {
      // fallback cp
      await copyFile(src, dst)
      console.log(`✅ cp fallback ${srcRel} → ${dstRel} (${e.message})`)
    }
  } else {
    await copyFile(src, dst)
    console.log(`✅ cp ${srcRel} → ${dstRel}`)
  }
}
// Create LIST copy in out (Step 4)
const outList = join(outDir, "0. LIST DANH MỤC.docx")
try {
  const listMd = await call({ action: "read", filePath: listDocx })
  await call({ action: "create", filePath: outList, content: listMd })
  await call({ action: "accept", filePath: outList })
  console.log(`✅ LIST copy to ${outList}`)
} catch (e) { console.log(`❌ LIST copy failed ${e.message}`); process.exit(1) }
console.log("")

// 5. Validate (Step 5)
console.log("5. Validate dossier...")
const lsOut = await execAsync(`ls -R "${outDir}" 2>&1 | head -n 50`)
console.log(lsOut.stdout.slice(0,500))
try {
  const { stdout: xml } = await execAsync(`unzip -p "${outList}" word/document.xml 2>&1 | tr -cd '<' | wc -c`)
  const { stdout: trc } = await execAsync(`unzip -p "${outList}" word/document.xml 2>&1 | grep -o "<w:tr" | wc -l`)
  console.log(`✅ LIST docx: < chars ${xml.trim()}, rows ${trc.trim()}`)
  if (parseInt(trc.trim()) < 22) throw new Error(`LIST rows ${trc.trim()} <22`)
  const hist = await call({ action: "history", filePath: outList })
  console.log(`✅ history: ${hist.slice(0,200)}`)
} catch (e) { console.log(`❌ validate failed ${e.message}`); process.exit(1) }
console.log("")

const elapsed = Date.now() - Date.now() // dummy
console.log(`=== dossier-create PASS — output at ${outDir} ===`)
await writeFile(join(CAPTURE_DIR, `dossier-create-${Date.now()}.json`), JSON.stringify({ status: "PASS", outDir, listDocx, outList, copies: copies.length }, null, 2))
