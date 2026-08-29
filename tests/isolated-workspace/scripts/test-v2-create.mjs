#!/usr/bin/env bun
// v2 styled create-from-scratch — no template, no example, just markdown+accept with style defaults
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { mkdir, writeFile, readFile } from "fs/promises"
import { join } from "path"
import { Effect, Schema } from "effect"
import { getDraftsDir, getHistoryDir, getLocksDir, getRegistryDir, getSidecarsDir } from "../../../src/core/storage/paths.ts"

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
const CAPTURE_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.capture"
const DOCS = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs/v2"

configureOptions({ dataDir: DATA_DIR, pdfEngine: "weasyprint" })
await mkdir(getDraftsDir(), { recursive: true })
await mkdir(getHistoryDir(), { recursive: true })
await mkdir(getLocksDir(), { recursive: true })
await mkdir(getRegistryDir(), { recursive: true })
await mkdir(getSidecarsDir(), { recursive: true })
await mkdir(DOCS, { recursive: true })

const mockContext = { agent: "v2-test", sessionID: "v2-" + Date.now(), messageID: "m1", id: "c1", progress: () => Effect.void }
async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return res.output
}

async function testCreate(name, file, content) {
  const fp = join(DOCS, file)
  const start = Date.now()
  try {
    await call({ action: "create", filePath: fp, content })
    await call({ action: "accept", filePath: fp })
    const ms = Date.now() - start
    const stat = await readFile(fp)
    console.log(`✅ ${name} (${ms}ms) — ${stat.length} bytes — ${fp}`)
    // quick check for styled artifacts: unzip docx and grep for shading?
    if (file.endsWith(".docx")) {
      const { exec } = await import("child_process")
      const { promisify } = await import("util")
      const execAsync = promisify(exec)
      try {
        const { stdout } = await execAsync(`unzip -p "${fp}" word/document.xml 2>&1 | head -n 200`)
        const hasShading = stdout.includes("D9E1F2") || stdout.includes("shd")
        const hasHeading = stdout.includes("Heading1") || stdout.includes("w:val=\"1\"")
        console.log(`   styled check: shading=${hasShading}, heading=${hasHeading}`)
      } catch {}
    }
    if (file.endsWith(".xlsx")) {
      // check xlsx contains header fill via unzip?
      try {
        const { exec } = await import("child_process")
        const { promisify } = await import("util")
        const execAsync = promisify(exec)
        const { stdout } = await execAsync(`unzip -l "${fp}" 2>&1 | head`)
        console.log(`   xlsx sheets: ${stdout.slice(0,120)}`)
      } catch {}
    }
    await writeFile(join(CAPTURE_DIR, `v2-${name.replace(/\s+/g,"-")}.json`), JSON.stringify({ name, file, status: "PASS", ms, bytes: stat.length }, null, 2))
    return { name, status: "PASS", ms }
  } catch (e) {
    const ms = Date.now() - start
    console.log(`❌ ${name} (${ms}ms) — ${e.message}`)
    await writeFile(join(CAPTURE_DIR, `v2-${name.replace(/\s+/g,"-")}.json`), JSON.stringify({ name, file, status: "FAIL", error: e.message }, null, 2))
    return { name, status: "FAIL", error: e.message }
  }
}

console.log("=== V2 styled create-from-scratch (no template, no example) ===")
const results = []
results.push(await testCreate("docx styled", "v2-styled.docx", `# BAO CAO HOA CHAT\n\n**Benh vien Da khoa tinh Phu Tho**\n\n## 1. Thong tin chung\n\nGoi thau: Hoa chat xet nghiem virus viem gan B, C\n\n- Nha thau: Van Nien\n- Hop dong: 1703/HDKT 17.03.2026\n\n## 2. Bang ke chi tiet\n\n| STT | Ten hang | Don vi | SL | Don gia | Thanh tien |\n| 1 | HBV Elitech | Test | 100 | 1,200,000 | 120,000,000 |\n| 2 | HCV Elitech | Test | 80 | 1,500,000 | 120,000,000 |\n|  | **Tong** |  |  |  | **240,000,000** |\n\n### Ghi chu\n\nDa kiem tra chung tu goc.`))

results.push(await testCreate("xlsx styled", "v2-styled.xlsx", `# Du toan\n\n| Khoan muc | Du toan | Thuc chi | Chenh lech |\n| Hoa chat | 240000000 | 235000000 | =B2-C2 |\n| Vat tu | 50000000 | 48000000 | =B3-C3 |\n| Tong | =SUM(B2:B3) | =SUM(C2:C3) | =B4-C4 |`))

results.push(await testCreate("pdf styled", "v2-styled.pdf", `# BAO CAO TONG HOP\n\n## Mo ta\n\nDay la bao cao duoc tao moi hoan toan tu markdown, khong can template mau.\n\n| Chi tieu | Gia tri |\n| A | 100 |\n| B | 200 |\n\n- Diem 1\n- Diem 2\n\n**Ket luan:** Dat yeu cau.`))

results.push(await testCreate("pptx styled", "v2-styled.pptx", `# Slide 1\n\nTieu de: Bao cao\n\nNoi dung slide 1\n\n# Slide 2\n\nBang du lieu\n\n| Cot A | Cot B |\n| X | Y |`))

results.push(await testCreate("docx minimal no-table", "v2-minimal.docx", `# GIAY DE NGHI\n\nKinh gui: Phong Ke Toan\n\nDe nghi thanh toan.`))

console.log(`\n=== V2 results: ${results.filter(r=>r.status==="PASS").length}/${results.length} PASS ===`)
for (const r of results) console.log(`${r.status==="PASS"?"✅":"❌"} ${r.name}: ${r.status}`)

if (results.some(r=>r.status==="FAIL")) process.exit(1)
