#!/usr/bin/env bun
// spam baseline: 10 creates before style defaults, capture timing
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { mkdir, writeFile } from "fs/promises"
import { join } from "path"
import { Effect, Schema } from "effect"
import { getDraftsDir, getHistoryDir, getLocksDir, getRegistryDir, getSidecarsDir } from "../../../src/core/storage/paths.ts"

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
const CAPTURE_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.capture"
const DOCS = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs/spam-baseline"

configureOptions({ dataDir: DATA_DIR, pdfEngine: "weasyprint" })
await mkdir(getDraftsDir(), { recursive: true })
await mkdir(getHistoryDir(), { recursive: true })
await mkdir(getLocksDir(), { recursive: true })
await mkdir(getRegistryDir(), { recursive: true })
await mkdir(getSidecarsDir(), { recursive: true })
await mkdir(DOCS, { recursive: true })
await mkdir(CAPTURE_DIR, { recursive: true })

const mockContext = { agent: "spam-baseline", sessionID: "spam-" + Date.now(), messageID: "m1", id: "c1", progress: () => Effect.void }
async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return res.output
}

const cases = [
  { file: "01-report.docx", content: "# BAO CAO NGAY\n\nNoi dung bao cao don gian.\n\n- Muc 1\n- Muc 2" },
  { file: "02-letter.docx", content: "# CONG HOA XA HOI CHU NGHIA VIET NAM\n\n**Doc lap - Tu do - Hanh phuc**\n\nKinh gui: Ban Giam Doc" },
  { file: "03-table.docx", content: "# BANG KE\n\n| STT | Ten | SL |\n| 1 | Vat tu A | 10 |\n| 2 | Vat tu B | 20 |" },
  { file: "04-heading.docx", content: "# Heading 1\n\n## Heading 2\n\n### Heading 3\n\nNoi dung duoi heading." },
  { file: "05-mixed.docx", content: "# HO SO THAU\n\nMo ta ho so.\n\n| Goi | Gia tri |\n| HC Virus | 123tr |" },
  { file: "06-sheet.xlsx", content: "# Sheet1\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |" },
  { file: "07-budget.xlsx", content: "# Budget\n\n| Khoan | Du toan | Thuc chi |\n| HC | 100 | 90 |\n| VT | 200 | 210 |" },
  { file: "08-invoice.xlsx", content: "# Invoice\n\n| Ma | Ten | Don gia | SL | Thanh tien |\n| 001 | HBV | 1200000 | 10 | =C2*D2 |\n" },
  { file: "09-simple.pdf", content: "# PDF DON GIAN\n\nTao PDF khong can template.\n\n- Dong 1\n- Dong 2" },
  { file: "10-report.pdf", content: "# BAO CAO PDF\n\nNoi dung bao cao.\n\n| Cot A | Cot B |\n| X | Y |" },
]

const results = []
for (const c of cases) {
  const fp = join(DOCS, c.file)
  const start = Date.now()
  try {
    await call({ action: "create", filePath: fp, content: c.content })
    await call({ action: "accept", filePath: fp })
    const ms = Date.now() - start
    console.log(`✅ ${c.file} (${ms}ms)`)
    results.push({ file: c.file, status: "PASS", ms })
  } catch (e) {
    const ms = Date.now() - start
    console.log(`❌ ${c.file} (${ms}ms) — ${e.message}`)
    results.push({ file: c.file, status: "FAIL", error: e.message, ms })
  }
}
await writeFile(join(CAPTURE_DIR, "spam-baseline-report.json"), JSON.stringify({ ts: new Date().toISOString(), results }, null, 2))
console.log(`\nSpam baseline done: ${results.filter(r=>r.status==="PASS").length}/${results.length} PASS`)
console.log(`Docs: ${DOCS}`)
