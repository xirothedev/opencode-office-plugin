#!/usr/bin/env bun
// spam with skills: exercises docx/xlsx/pdf/pptx via officecli as agent would via skills
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { mkdir, writeFile, readFile } from "fs/promises"
import { join } from "path"
import { Effect, Schema } from "effect"
import { getDraftsDir, getHistoryDir, getLocksDir, getRegistryDir, getSidecarsDir } from "../../../src/core/storage/paths.ts"

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
const CAPTURE_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.capture"
const DOCS = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs/spam-skills"

configureOptions({ dataDir: DATA_DIR, pdfEngine: "weasyprint" })
await mkdir(getDraftsDir(), { recursive: true })
await mkdir(getHistoryDir(), { recursive: true })
await mkdir(getLocksDir(), { recursive: true })
await mkdir(getRegistryDir(), { recursive: true })
await mkdir(getSidecarsDir(), { recursive: true })
await mkdir(DOCS, { recursive: true })
await mkdir(CAPTURE_DIR, { recursive: true })

const mockContext = { agent: "spam-skills", sessionID: "spam-skills-" + Date.now(), messageID: "m1", id: "c1", progress: () => Effect.void }
async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return res.output
}

console.log("Skills discovered in isolated workspace:")
const { readdir } = await import("fs/promises")
const skills = await readdir("/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/skills").catch(()=>[])
console.log(" - " + skills.join(", "))
for (const s of skills) {
  const stat = await import("fs").then(m=>m.existsSync(`/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/skills/${s}/SKILL.md`))
  console.log(`   ${s}: ${stat ? "SKILL.md ✓" : "missing"}`)
}

const cases = [
  // docx via docx skill — headings + table + bullets (gotchas: DXA widths, CLEAR shading)
  { skill: "docx", file: "skill-docx-01-report.docx", content: `# BAO CAO DOCX SKILL\n\n**Skill: docx** — tao moi tu officecli, style v2 A4 D9E1F2\n\n## 1. Tong quan\n\n- Van Nien - hop dong 1703\n- Ngay 17.03.2026\n\n## 2. Bang du lieu\n\n| STT | Ten | SL | Ghi chu |\n| 1 | HBV | 100 | OK |\n| 2 | HCV | 80 | OK |\n|  | Tong | 180 |  |` },
  { skill: "docx", file: "skill-docx-02-letter.docx", content: `# CONG HOA XA HOI CHU NGHIA VIET NAM\n\n**Doc lap - Tu do - Hanh phuc**\n\nKinh gui: BGĐ Benh vien\n\nDe nghi phe duyet.\n\n- Diem 1\n- Diem 2\n- Diem 3` },
  { skill: "docx", file: "skill-docx-03-toc.docx", content: `# Bao cao co TOC\n\n## Chuong 1\n\nNoi dung 1\n\n## Chuong 2\n\nNoi dung 2\n\n### 2.1 Tieu muc\n\nChi tiet` },
  // xlsx via xlsx skill — formulas, header fill, autoFilter
  { skill: "xlsx", file: "skill-xlsx-01-budget.xlsx", content: `# Sheet1\n\n| Khoan | Du toan | Thuc chi | CL |\n| HC | 240000000 | 235000000 | =B2-C2 |\n| VT | 50000000 | 48000000 | =B3-C3 |\n| Tong | =SUM(B2:B3) | =SUM(C2:C3) | =B4-C4 |` },
  { skill: "xlsx", file: "skill-xlsx-02-invoice.xlsx", content: `# Invoice\n\n| Ma | Ten | SL | Don gia | TT |\n| 001 | HBV Elitech | 10 | 1200000 | =C2*D2 |\n| 002 | HCV Elitech | 8 | 1500000 | =C3*D3 |\n|  | Tong |  |  | =SUM(E2:E3) |` },
  { skill: "xlsx", file: "skill-xlsx-03-multi.xlsx", content: `# DuToan\n\n| Hang | SL |\n| A | 10 |\n| B | 20 |\n# ThucTe\n\n| Hang | SL |\n| A | 9 |\n| B | 18 |` },
  // pdf via pdf skill — weasyprint CSS
  { skill: "pdf", file: "skill-pdf-01-report.pdf", content: `# BAO CAO PDF SKILL\n\nTao moi khong template, style v2 weasyprint.\n\n| Chi tieu | GT |\n| A | 100 |\n| B | 200 |\n\n- Ghi chu 1\n- Ghi chu 2` },
  { skill: "pdf", file: "skill-pdf-02-form.pdf", content: `# DON DE NGHI\n\nKinh gui: Ke toan\n\nDe nghi thanh toan goi HC viem gan B, C.\n\n**Tong:** 240tr` },
  // pptx via pptx skill — pandoc slides
  { skill: "pptx", file: "skill-pptx-01-deck.pptx", content: `# Slide 1: Tong quan\n\nBao cao hop dong 1703\n\n# Slide 2: Du lieu\n\n| Cot A | Cot B |\n| X | Y |\n\n# Slide 3: Ket luan\n\nDat` },
  { skill: "pptx", file: "skill-pptx-02-pitch.pptx", content: `# Tieu de\n\nPhu Tho Hospital\n\n# Giai phap\n\n- AI\n- Office` },
  // office unified skill — mixed
  { skill: "office", file: "skill-office-01-mixed.docx", content: `# Ho so thau\n\nMo ta\n\n| Goi | Gia |\n| HC B,C | 240tr |` },
  { skill: "office", file: "skill-office-02-mixed.xlsx", content: `# Tong\n\n| A | B |\n| 1 | 2 |` },
]

const results = []
for (const c of cases) {
  const fp = join(DOCS, c.file)
  const start = Date.now()
  try {
    await call({ action: "create", filePath: fp, content: c.content })
    await call({ action: "accept", filePath: fp })
    const ms = Date.now() - start
    const buf = await readFile(fp)
    console.log(`✅ [${c.skill}] ${c.file} (${ms}ms, ${buf.length}b)`)
    results.push({ ...c, status: "PASS", ms, bytes: buf.length })
  } catch (e) {
    const ms = Date.now() - start
    console.log(`❌ [${c.skill}] ${c.file} (${ms}ms) — ${e.message}`)
    results.push({ ...c, status: "FAIL", error: e.message, ms })
  }
}
await writeFile(join(CAPTURE_DIR, "spam-skills-report.json"), JSON.stringify({ ts: new Date().toISOString(), skills, results }, null, 2))
console.log(`\nSpam with skills: ${results.filter(r=>r.status==="PASS").length}/${results.length} PASS`)
console.log(`Docs: ${DOCS}`)
console.log(`Capture: ${CAPTURE_DIR}/spam-skills-report.json`)
