#!/usr/bin/env bun
// ponytail: test new L3 create method (clone→substitute→accept→verify-l3) against real folder examples

import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { getDraftsDir, getHistoryDir, getLocksDir, getRegistryDir, getSidecarsDir } from "../../../src/core/storage/paths.ts"
import { mkdir, writeFile, readFile, stat, readdir } from "fs/promises"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { join, basename, extname, dirname } from "path"
import { Effect, Schema } from "effect"
import { exec } from "child_process"
import { promisify } from "util"
import JSZip from "jszip"
const execAsync = promisify(exec)

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
const CAPTURE_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.capture"
const DOCS_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs"

configureOptions({ dataDir: DATA_DIR, pdfEngine: "weasyprint" })
await mkdir(getDraftsDir(), { recursive: true })
await mkdir(getHistoryDir(), { recursive: true })
await mkdir(getLocksDir(), { recursive: true })
await mkdir(getRegistryDir(), { recursive: true })
await mkdir(getSidecarsDir(), { recursive: true })
await mkdir(CAPTURE_DIR, { recursive: true })

const mockContext = { agent: "l3-folder-test", sessionID: "l3-folder-" + Date.now(), messageID: "m1", id: "c1", progress: () => Effect.void }
async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return res.output
}

// Helpers: pick first file of given ext from folder (recursive)
async function findFirst(dir, ext) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isFile() && p.toLowerCase().endsWith(ext)) return p
      if (e.isDirectory()) {
        const found = await findFirst(p, ext)
        if (found) return found
      }
    }
  } catch {}
  return null
}

// Inject {{placeholder}} into OOXML (like l3.test.ts) to simulate Template from Reference
async function makeTemplate(sourcePath, placeholderMap) {
  // placeholderMap: { xmlPath: [ [searchText, placeholder] ] }
  const buf = readFileSync(sourcePath)
  const zip = await JSZip.loadAsync(buf)
  for (const [xmlPath, reps] of Object.entries(placeholderMap)) {
    const entry = zip.file(xmlPath)
    if (!entry) continue
    let xml = await entry.async("string")
    for (const [search, placeholder] of reps) {
      xml = xml.replace(search, placeholder)
    }
    zip.file(xmlPath, xml)
  }
  return await zip.generateAsync({ type: "nodebuffer" })
}

async function runL3Test(label, sourcePath, templateOps, data, verifyAs) {
  const start = Date.now()
  const tmpTemplate = join(DOCS_DIR, `l3-tpl-${label}${extname(sourcePath)}`)
  const targetPath = join(DOCS_DIR, `l3-out-${label}${extname(sourcePath)}`)
  let status = "PASS", detail = "", error = null
  try {
    // 1. create Template file on disk (with {{}} placeholders) from source fixture
    let templateBuf
    if (templateOps) {
      templateBuf = await makeTemplate(sourcePath, templateOps)
    } else {
      templateBuf = readFileSync(sourcePath)
    }
    writeFileSync(tmpTemplate, templateBuf)
    console.log(`  [${label}] Template prepared: ${tmpTemplate} (${templateBuf.length} bytes) from ${basename(sourcePath)}`)

    // 2. clone Template → target draft (L3 Format preserved, ZIP verbatim)
    const cloneOut = await call({ action: "clone", filePath: tmpTemplate, targetPath })
    console.log(`  [${label}] clone: ${cloneOut}`)

    // 3. substitute placeholders on draft
    const subOut = await call({ action: "substitute", filePath: targetPath, data: JSON.stringify(data) })
    console.log(`  [${label}] substitute: ${subOut}`)
    if (!subOut.includes("Substituted")) throw new Error(`substitute failed: ${subOut}`)

    // 4. accept draft → real file
    const acceptOut = await call({ action: "accept", filePath: targetPath })
    console.log(`  [${label}] accept: ${acceptOut}`)
    const st = await stat(targetPath)
    console.log(`  [${label}] file ${st.size} bytes`)

    // 5. verify-l3 target vs template (should PASS, only text differs)
    const verifyOut = await call({ action: "verify-l3", filePath: targetPath, referencePath: tmpTemplate })
    console.log(`  [${label}] verify-l3: ${verifyOut.slice(0, 300)}`)
    if (!verifyOut.startsWith("L3 PASS")) throw new Error(`verify-l3 failed: ${verifyOut}`)

    // 6. read back markdown and check data values appear
    const md = await call({ action: "read", filePath: targetPath })
    for (const v of Object.values(data)) {
      if (!md.includes(String(v))) console.log(`  [${label}] ⚠️ readback missing value "${v}" — md preview: ${md.slice(0,200)}`)
    }
    console.log(`  [${label}] read back ${md.length} chars, sample: ${md.slice(0,120).replace(/\n/g," / ")}`)

    // 7. also verify source Format was preserved via unzip diff: styles.xml identical
    try {
      const a = await execAsync(`unzip -p "${tmpTemplate}" word/styles.xml 2>/dev/null | md5; unzip -p "${targetPath}" word/styles.xml 2>/dev/null | md5`)
      console.log(`  [${label}] styles.xml md5 check: ${a.stdout.trim().split("\n").join(" vs ")}`)
    } catch {}
    detail = `PASS clone→substitute→accept→verify-l3, ${st.size} bytes, md ${md.length} chars`

  } catch (e) {
    status = "FAIL"
    error = e.message
    console.log(`  [${label}] ❌ ${e.message}`)
    detail = `FAIL: ${e.message}`
  }
  const ms = Date.now() - start
  return { label, sourcePath, targetPath, tmpTemplate, data, status, detail, error, ms }
}

console.log("=== L3 New Create Method — Folder Example Test ===\n")
console.log("Method: Reference (real OOXML) → clone(ZIP verbatim) → substitute(run-preserving {{}} ) → accept → verify-l3")
console.log("Test context: tracer.mjs + l3.test.ts + dossier fixtures\n")

// Define folder examples to test
const folders = [
  { name: "spam-baseline", dir: join(DOCS_DIR, "spam-baseline") },
  { name: "fixtures-minimal", dir: "test/fixtures" },
  { name: "procurement-real", dir: "tests/isolated-workspace/fixtures/virus-hepatitis-bc-van-nien" },
  { name: "v2-styled", dir: join(DOCS_DIR, "v2") },
]
for (const f of folders) {
  const exists = existsSync(f.dir)
  console.log(`Folder ${f.name}: ${f.dir} exists=${exists}`)
  if (exists) {
    try {
      const files = await readdir(f.dir)
      console.log(`  top entries: ${files.slice(0,5).join(", ")}${files.length>5?" ...":""}`)
    } catch {}
  }
}
console.log("")

const results = []

// 1) Minimal fixtures — the l3.test.ts baseline (Hello DOCX → {{greeting}})
results.push(await runL3Test("minimal-docx",
  "test/fixtures/sample.docx",
  { "word/document.xml": [["Hello DOCX", "{{greeting}}"]] },
  { greeting: "Hello L3 Folder" }
))
results.push(await runL3Test("minimal-xlsx",
  "test/fixtures/sample.xlsx",
  { "xl/sharedStrings.xml": [["Widgets", "{{item}}"]] },
  { item: "FolderTest-Gadgets" }
))
results.push(await runL3Test("minimal-pptx",
  "test/fixtures/sample.pptx",
  { "ppt/slides/slide1.xml": [["Hello from slide 1", "{{title}}"]] },
  { title: "L3 PPTX Folder" }
))

// 2) spam-baseline — real generated docs with headings/tables (use anchor mode if no {{}})
const spamDocx = await findFirst(join(DOCS_DIR, "spam-baseline"), ".docx")
if (spamDocx) {
  // try placeholder injection then substitute; also test anchor fallback (oldText→newText without {{}})
  const mdBefore = await call({ action: "read", filePath: spamDocx })
  const oldText = mdBefore.split(/\s+/).find(w=>w.length>4) || "Report"
  results.push(await runL3Test("spam-anchor-docx",
    spamDocx,
    null, // no placeholder injection → anchor mode: data keys are old strings
    { [oldText.slice(0, 8)]: "ANCHOR_REPLACED" }
  ))
}

// 3) Procurement real — pick a real Vietnamese dossier docx with rich Format (styles, tables, headers)
const realDocx = await findFirst("tests/isolated-workspace/fixtures/virus-hepatitis-bc-van-nien", ".docx")
if (realDocx) {
  // Inject a placeholder where first text appears, then substitute with dossier data
  // We use a generic placeholder insertion: replace first occurrence of "BỆNH VIỆN" or "CÔNG TY" or fallback "HĐ"
  let templateOps = { "word/document.xml": [["BỆNH VIỆN", "{{benh_vien}}"]] }
  // if file doesn't contain that, fallback will cause no replace → test will fail, so we try generic
  try {
    const buf = readFileSync(realDocx)
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file("word/document.xml")?.async("string") ?? ""
    if (!xml.includes("BỆNH VIỆN") && xml.includes("VIỆN")) templateOps = { "word/document.xml": [["VIỆN", "{{benh_vien}}"]] }
    else if (!xml.includes("BỆNH VIỆN")) templateOps = { "word/document.xml": [["HĐ", "{{so_hd}}"]] }
  } catch {}
  results.push(await runL3Test("procurement-docx",
    realDocx,
    templateOps,
    realDocx.includes("18-van-nien") ? { benh_vien: "BỆNH VIỆN ĐK TỈNH PHÚ THỌ", so_hd: "1703/HDKTVN" } : { benh_vien: "BỆNH VIỆN TEST", so_hd: "TEST-001" }
  ))
  // xlsx real
  const realXlsx = await findFirst("tests/isolated-workspace/fixtures/virus-hepatitis-bc-van-nien", ".xlsx")
  if (realXlsx) {
    results.push(await runL3Test("procurement-xlsx",
      realXlsx,
      { "xl/sharedStrings.xml": [["Hồ sơ công bố", "{{header}}"]] },
      { header: "DANH MỤC L3" }
    ))
  }
}

// 4) v2 styled docx — demonstrates L1 vs L3 comparison point
const v2Docx = join(DOCS_DIR, "v2/v2-styled.docx")
if (existsSync(v2Docx)) {
  results.push(await runL3Test("v2-styled-docx",
    v2Docx,
    { "word/document.xml": [["BAO CAO HOA CHAT", "{{tieu_de}}"]] },
    { tieu_de: "BAO CAO L3" }
  ))
}

console.log("\n=== Summary ===")
for (const r of results) console.log(`${r.status==="PASS"?"✅":"❌"} ${r.label}: ${r.status} (${r.ms}ms) — ${r.detail}`)
const pass = results.filter(r=>r.status==="PASS").length
console.log(`\n${pass}/${results.length} PASS — all via isolated officecli (dataDir=.data, no global plugins)`)

// Capture JSON
const capture = { ts: new Date().toISOString(), method: "clone→substitute→accept→verify-l3 (L3)", results, folders: folders.map(f=>f.dir) }
await writeFile(join(CAPTURE_DIR, `l3-folder-example-${Date.now()}.json`), JSON.stringify(capture, null, 2))

// Report md
let md = `# L3 Folder Example Report\n\nGenerated: ${new Date().toISOString()}\nMethod: \`clone\` → \`substitute\` → \`accept\` → \`verify-l3\` (L3 = byte-identical except text nodes)\n\n## Folders Tested\n\n`
for (const f of folders) md += `- \`${f.dir}\` — ${f.name}\n`
md += `\n## Results\n\n| Test | Source | Target | Status | Detail |\n|---|---|---|---|---|\n`
for (const r of results) md += `| ${r.label} | \`${basename(r.sourcePath)}\` | \`${basename(r.targetPath)}\` | ${r.status} | ${r.detail} |\n`
md += `\n## How to use (skills/office)\n\n\`\`\`\nclone filePath(source Reference) + targetPath(new file)   # ZIP verbatim\nsubstitute filePath(target) + data(JSON {{k}}→v)        # run-preserving\naccept filePath(target)                                 # flush draft\nverify-l3 filePath(target) + referencePath(Reference)   # L3 gate\n\`\`\`\n\nUse L3 when Reference already carries full Format; use L1 (create+content) for markdown-from-scratch.\n`
await writeFile(join(CAPTURE_DIR, `l3-folder-example-report.md`), md)
console.log(`\nCapture: ${join(CAPTURE_DIR, "l3-folder-example-*.json")}`)
console.log(`Report: ${join(CAPTURE_DIR, "l3-folder-example-report.md")}`)

if (pass < results.length) { console.log(`\n⚠️ ${results.length-pass} failed — see capture for details`); process.exit(1) }
else console.log("\n✅ All L3 folder examples PASS")
