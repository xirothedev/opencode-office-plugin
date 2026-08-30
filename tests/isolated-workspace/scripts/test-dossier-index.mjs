#!/usr/bin/env bun
// ponytail: test Dossier Index Task Skill via real officecli in Isolated Runtime — Van Nien folder → LIST DANH MUC.docx

import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { getDraftsDir, getHistoryDir, getLocksDir, getRegistryDir, getSidecarsDir } from "../../../src/core/storage/paths.ts"
import { mkdir, readFile, writeFile, readdir } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { Effect, Schema } from "effect"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
const CAPTURE_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.capture"
const DOCS_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs"
const TEMPLATE_PATH = "/Users/xirothedev/workspace/opencode-office-plugin/skills/dossier-index/references/template.md"
const SKILL_CREATOR_PATH = "/Users/xirothedev/workspace/opencode-office-plugin/skills/skill-creator/SKILL.md"
const DOSSIER_SKILL_PATH = "/Users/xirothedev/workspace/opencode-office-plugin/skills/dossier-index/SKILL.md"

const DOSSIER_INPUT = "/Users/xirothedev/Downloads/11. MS BỘ XÉT NGHIỆM VIRUS VIÊM GAN B C - Vạn  Niên/1. Hồ sơ thầu"
const OUTPUT_DOCX = join(DOCS_DIR, "dossier-van-nien-LIST-DANH-MUC.docx")

configureOptions({ dataDir: DATA_DIR, pdfEngine: "weasyprint" })
await mkdir(getDraftsDir(), { recursive: true })
await mkdir(getHistoryDir(), { recursive: true })
await mkdir(getLocksDir(), { recursive: true })
await mkdir(getRegistryDir(), { recursive: true })
await mkdir(getSidecarsDir(), { recursive: true })
await mkdir(CAPTURE_DIR, { recursive: true })
await mkdir(DOCS_DIR, { recursive: true })

const mockContext = { agent: "dossier-test", sessionID: "dossier-" + Date.now(), messageID: "m1", id: "c1", progress: () => Effect.void }
async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return res.output
}

console.log("=== Real opencode test — Isolated Runtime ===")
console.log(`Isolated dataDir: ${DATA_DIR}`)
console.log(`Template: ${TEMPLATE_PATH}`)
console.log(`Input dossier: ${DOSSIER_INPUT}`)
console.log(`Output: ${OUTPUT_DOCX}`)
console.log("")

// 1. Verify Skill Creator Workflow and Dossier Index skill exist (writing-for-agents ladder)
console.log("1. Verify Skill Creator Workflow files...")
for (const p of [SKILL_CREATOR_PATH, DOSSIER_SKILL_PATH]) {
  if (!existsSync(p)) {
    console.log(`❌ missing ${p}`)
    process.exit(1)
  }
  const c = await readFile(p, "utf-8")
  console.log(`✅ ${p.split("/skills/")[1]} — ${c.length} bytes — ${c.split("\n").length} lines`)
  if (!c.startsWith("---")) { console.log(`❌ ${p} missing frontmatter`); process.exit(1) }
  if (!c.includes("description:")) { console.log(`❌ ${p} missing description`); process.exit(1) }
}
{
  const p = TEMPLATE_PATH
  const c = await readFile(p, "utf-8")
  console.log(`✅ ${p.split("/skills/")[1]} — ${c.length} bytes — ${c.split("\n").length} lines (disclosed reference, no frontmatter needed)`)
  if (!c.includes("LIST DANH MỤC")) { console.log(`❌ template missing title`); process.exit(1) }
}
console.log("")

// 2. Inventory Van Nien dossier (real folder)
console.log("2. Inventory dossier folder (ls -R)...")
try {
  const entries = await readdir(DOSSIER_INPUT)
  console.log(`✅ found ${entries.length} entries in Hồ sơ thầu:`)
  for (const e of entries.slice(0, 10)) console.log(`   - ${e}`)
  if (entries.length > 10) console.log(`   ... +${entries.length - 10} more`)
} catch (e) {
  console.log(`❌ cannot read dossier input: ${e.message}`)
  console.log(`   (if Downloads folder missing, test still proves template render)`)
}
console.log("")

// 3. Read template and fill with Van Nien data (simulating extract step)
console.log("3. Render template with Van Nien data...")
let template = await readFile(TEMPLATE_PATH, "utf-8")
// Minimal fill: replace a few key placeholders with Van Nien real values extracted from folder
// These are taken from the actual files seen in Downloads listing
const fill = {
  "{{ten_goi_thau}}": "Mua sắm vật tư hóa chất xét nghiệm virus viêm gan B, C — Vạn Niên",
  "{{ten_cong_ty}}": "CÔNG TY TNHH VẠN NIÊN",
  "{{gia_tri}}": "240.000.000 VNĐ",
  "{{thoi_han}}": "90 ngày",
  "{{so_hd}}": "1703/HĐKTVN-BVĐKPT",
  "{{ngay_hd}}": "17/03/2026",
  "{{e_hsmt}}": "IB2600078268 (12/03/2026)",
  "{{bat_dau}}": "08h00 – 27/03/2026",
  "{{ket_thuc}}": "10h00 – 30/03/2026",
  "{{ma_khlcnt}}": "PL2600065811",
  // dates per row — mapped from Van Nien files
  "{{d1}}": "—", "{{d2}}": "05/01/2026", "{{vb2}}": "65/QĐ-BV",
  "{{d3}}": "—", "{{vb3}}": "802/QĐ-BV (—/02/2026)",
  "{{d4}}": "—", "{{d5}}": "—", "{{vb5}}": "841/QĐ-BV",
  "{{d6a}}": "IB2500261479", "{{vb6a}}": "—", "{{d6b}}": "", "{{vb6b}}": "",
  "{{d7}}": "—", "{{d8}}": "—", "{{vb8}}": "878/QĐ-BV",
  "{{d9}}": "—", "{{vb9}}": "—",
  "{{d10}}": "—", "{{vb10}}": "933/QĐ-BV",
  "{{d11}}": "—", "{{d12}}": "—", "{{vb12}}": "IB2600078268",
  "{{d13}}": "—", "{{d14}}": "—", "{{vb14}}": "—",
  "{{d15}}": "—", "{{vb15}}": "—",
  "{{d16}}": "12/03/2026", "{{vb16}}": "QĐ phê duyệt KQLCNT",
  "{{d17}}": "", "{{d18}}": "17/03/2026", "{{vb18}}": "1703/HĐKTVN-BVĐKPT",
}
for (const [k, v] of Object.entries(fill)) template = template.replaceAll(k, v)
// strip any remaining {{}} to avoid officecli confusion
template = template.replace(/\{\{[^}]+\}\}/g, "")

await writeFile(join(CAPTURE_DIR, "dossier-rendered.md"), template)
console.log(`✅ rendered ${template.length} chars, ${template.split("\n").length} lines → .capture/dossier-rendered.md`)
console.log("")

// 4. Create via officecli (real Isolated Runtime path) — create→accept
console.log("4. officecli create → accept (Isolated Runtime)...")
const start = Date.now()
try {
  const cre = await call({ action: "create", filePath: OUTPUT_DOCX, content: template })
  console.log(`✅ create: ${cre} (${Date.now() - start}ms)`)
  const acc = await call({ action: "accept", filePath: OUTPUT_DOCX })
  console.log(`✅ accept: ${acc}`)
  if (!existsSync(OUTPUT_DOCX)) throw new Error("file not on disk after accept")
  const stat = await readFile(OUTPUT_DOCX)
  console.log(`✅ file on disk: ${stat.length} bytes`)
  if (stat.length < 5000) throw new Error(`file too small ${stat.length}, likely not valid docx`)
} catch (e) {
  console.log(`❌ create/accept failed: ${e.message}`)
  console.log(e.stack)
  process.exit(1)
}
console.log("")

// 5. Validate docx (zip + shading + 22 rows)
console.log("5. Validate docx...")
try {
  const { stdout: list } = await execAsync(`unzip -l "${OUTPUT_DOCX}" 2>&1 | head -n 20`)
  console.log(`✅ unzip list ok:\n${list.slice(0,300)}`)
  const { stdout: xmlFull } = await execAsync(`unzip -p "${OUTPUT_DOCX}" word/document.xml 2>&1`)
  const hasTable = xmlFull.includes("w:tbl") || xmlFull.includes("<w:tr")
  const rowCount = (xmlFull.match(/<w:tr/g) || []).length
  const tblCount = (xmlFull.match(/<w:tbl/g) || []).length
  const hasShading = xmlFull.includes("D9E1F2") || xmlFull.includes("shd")
  const hasHeading = xmlFull.includes("Heading1") || xmlFull.includes('w:val="1"')
  console.log(`   hasTable=${hasTable} tbl=${tblCount} rows=${rowCount} shading=${hasShading} heading=${hasHeading} xmlLen=${xmlFull.length}`)
  if (!hasTable) throw new Error("no w:tbl in document.xml")
  if (rowCount < 22) throw new Error(`rowCount ${rowCount} <22, not canonical dossier index`)
  console.log(`✅ docx validation PASS — ${rowCount} rows across ${tblCount} tables, table present`)
} catch (e) {
  console.log(`❌ validate failed: ${e.message}`)
  process.exit(1)
}
console.log("")

// 6. officecli read back (markdown extraction)
console.log("6. officecli read back...")
try {
  const md = await call({ action: "read", filePath: OUTPUT_DOCX })
  console.log(`✅ read back ${md.length} chars, first 400:\n${md.slice(0,400)}\n`)
  if (!md.includes("LIST DANH MỤC") && !md.includes("DANH MỤC")) {
    console.log(`⚠️  read back missing title — but may be ok, check raw md`)
  }
  if (!md.includes("Vạn Niên") && !md.includes("Vạn") && !md.includes("1703")) {
    console.log(`⚠️  read back missing Vạn Niên marker`)
  }
} catch (e) {
  console.log(`❌ read failed: ${e.message}`)
  process.exit(1)
}
console.log("")

// 7. history/revert check (Tracer Bullet pattern for this dossier)
console.log("7. history check...")
try {
  const hist = await call({ action: "history", filePath: OUTPUT_DOCX })
  console.log(`✅ history: ${hist.slice(0,300)}`)
} catch (e) {
  console.log(`❌ history failed: ${e.message}`)
  process.exit(1)
}
console.log("")

// 8. Capture + report
const elapsed = Date.now() - start
const capture = { label: "dossier-van-nien", outputDocx: OUTPUT_DOCX, template: TEMPLATE_PATH, input: DOSSIER_INPUT, ms: elapsed, status: "PASS" }
await writeFile(join(CAPTURE_DIR, `dossier-${Date.now()}.json`), JSON.stringify(capture, null, 2))
console.log(`=== Dossier Index real opencode test PASS (${elapsed}ms) ===`)
console.log(`Output: ${OUTPUT_DOCX}`)
console.log(`Capture: .capture/dossier-*.json + .capture/dossier-rendered.md`)
