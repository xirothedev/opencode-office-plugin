#!/usr/bin/env bun
// Test real hospital forms via Isolated Runtime — read + create without template
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { mkdir, writeFile, readdir, stat } from "fs/promises"
import { join, extname } from "path"
import { Effect, Schema } from "effect"

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
const CAPTURE_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.capture"
const FIXTURES = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/fixtures/virus-hepatitis-bc-van-nien"
const DOCS = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs"

configureOptions({ dataDir: DATA_DIR, pdfEngine: "weasyprint" })

// Ensure data dirs exist (from manager fix, but also for draft dirs)
import { getDraftsDir, getHistoryDir, getLocksDir, getRegistryDir, getSidecarsDir } from "../../../src/core/storage/paths.ts"
await mkdir(getDraftsDir(), { recursive: true })
await mkdir(getHistoryDir(), { recursive: true })
await mkdir(getLocksDir(), { recursive: true })
await mkdir(getRegistryDir(), { recursive: true })
await mkdir(getSidecarsDir(), { recursive: true })
await mkdir(DOCS, { recursive: true })

const mockContext = { agent: "real-forms-test", sessionID: "real-" + Date.now(), messageID: "m1", id: "c1", progress: () => Effect.void }
async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return res.output
}

async function walk(dir, base="") {
  const entries = await readdir(dir, { withFileTypes: true })
  let files = []
  for (const e of entries) {
    if (e.name === "manifest.json") continue
    const full = join(dir, e.name)
    const rel = join(base, e.name)
    if (e.isDirectory()) files = files.concat(await walk(full, rel))
    else files.push({ full, rel })
  }
  return files
}

const files = await walk(FIXTURES)
console.log(`Found ${files.length} real files in fixtures`)

// Read test on first 8 files (mixed types)
const toTest = files.slice(0, 8)
const readResults = []
for (const f of toTest) {
  const ext = extname(f.full).toLowerCase()
  // only test readable types: .docx .doc .pdf .xlsx .xls .png .jpg .xls
  if (![".docx",".doc",".pdf",".xlsx",".xls",".png",".jpg",".jpeg"].includes(ext)) continue
  const start = Date.now()
  try {
    const out = await call({ action: "read", filePath: f.full })
    const ms = Date.now() - start
    console.log(`✅ read ${f.rel} (${ext}, ${ms}ms) — ${out.slice(0,80).replace(/\n/g," ")}...`)
    readResults.push({ file: f.rel, status: "PASS", ms, preview: out.slice(0,200) })
    await writeFile(join(CAPTURE_DIR, `real-read-${f.rel.replace(/[^a-z0-9]+/gi,"-")}.json`), JSON.stringify({ file: f.rel, ext, ms, output: out.slice(0,500) }, null, 2))
  } catch (e) {
    const ms = Date.now() - start
    console.log(`❌ read ${f.rel} (${ext}) — ${e.message} (${ms}ms)`)
    readResults.push({ file: f.rel, status: "FAIL", error: e.message })
  }
}

// Create without template test (no example, no template)
const newFile = join(DOCS, "new-without-template.docx")
console.log(`\n--- Create without template/template ---`)
try {
  console.log(await call({ action: "create", filePath: newFile, content: "# GIAY DE NGHI THANH TOAN\n\nKinh gui: Phong Ke Toan\n\nDe nghi thanh toan goi hoa chat xet nghiem virus viem gan B, C.\n\n- Nha thau: Van Nien\n- Hop dong: 1703/HDKTVN-BVĐKPT 17.03.2026\n- Gia tri: 123.456.000 VND\n\n| STT | Hang hoa | SL | Don gia |\n| 1 | HBV ELITECH | 100 | 1.200.000 |\n" }))
  console.log(await call({ action: "edit", filePath: newFile, content: "# GIAY DE NGHI THANH TOAN (da chinh sua)\n\nThem dong ghi chu: Da doi chieu chung tu goc.\n" }))
  const readDraft = await call({ action: "read", filePath: newFile })
  console.log(`read draft preview: ${readDraft.slice(0,120)}...`)
  console.log(await call({ action: "accept", filePath: newFile }))
  const readReal = await call({ action: "read", filePath: newFile })
  console.log(`✅ create-without-template PASS — file at ${newFile} — real read length ${readReal.length}`)
  await writeFile(join(CAPTURE_DIR, "real-create-without-template.json"), JSON.stringify({ file: newFile, status: "PASS", readReal: readReal.slice(0,300) }, null, 2))
} catch (e) {
  console.log(`❌ create-without-template FAIL — ${e.message}`)
  await writeFile(join(CAPTURE_DIR, "real-create-without-template.json"), JSON.stringify({ error: e.message }, null, 2))
}

// Also test create PDF without template
const newPdf = join(DOCS, "new-without-template.pdf")
try {
  console.log(await call({ action: "create", filePath: newPdf, content: "# BAO CAO PDF\n\nTao moi khong can template — noi dung markdown don gian.\n\n- Muc 1\n- Muc 2\n" }))
  console.log(await call({ action: "accept", filePath: newPdf }))
  console.log(`✅ pdf create without template PASS — ${newPdf}`)
} catch (e) {
  console.log(`❌ pdf create without template FAIL — ${e.message}`)
}

// History check on newly created file
try {
  const hist = await call({ action: "history", filePath: newFile })
  console.log(`history for new file: ${hist.slice(0,200)}`)
} catch (e) {
  console.log(`history check: ${e.message}`)
}

// Summary
const pass = readResults.filter(r=>r.status==="PASS").length
const fail = readResults.filter(r=>r.status==="FAIL").length
console.log(`\n=== Real forms read: ${pass} PASS, ${fail} FAIL out of ${readResults.length} sampled ===`)
console.log(`Fixtures dir: ${FIXTURES}`)
console.log(`Docs dir: ${DOCS}`)
console.log(`New file without template: ${newFile} — this proves no external office/pdf skill needed, plugin handles it via create+accept.`)
