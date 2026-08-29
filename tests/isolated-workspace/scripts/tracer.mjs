#!/usr/bin/env bun
// ponytail: minimal tracer — create→edit→read→history→revert per format, capture JSON, report markdown. No frameworks.

import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { getDraftsDir, getHistoryDir, getLocksDir, getRegistryDir, getSidecarsDir } from "../../../src/core/storage/paths.ts"
import { mkdir, writeFile, readFile, rm } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Effect, Schema } from "effect"

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
const CAPTURE_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.capture"
const REPORT_PATH = join(CAPTURE_DIR, "report.md")
const DOCS_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs"

configureOptions({ dataDir: DATA_DIR, pdfEngine: "weasyprint" })

await rm(DATA_DIR, { recursive: true, force: true })
await mkdir(DATA_DIR, { recursive: true })
await mkdir(getDraftsDir(), { recursive: true })
await mkdir(getHistoryDir(), { recursive: true })
await mkdir(getLocksDir(), { recursive: true })
await mkdir(getRegistryDir(), { recursive: true })
await mkdir(getSidecarsDir(), { recursive: true })
await mkdir(CAPTURE_DIR, { recursive: true })
await mkdir(DOCS_DIR, { recursive: true })

const mockContext = {
  agent: "tracer",
  sessionID: "tracer-" + Date.now(),
  messageID: "tracer-msg",
  id: "tracer-call",
  progress: () => Effect.void,
}

async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const result = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return result.output
}

const captures = []

async function tracked(label, args) {
  const start = Date.now()
  let output = null
  let error = null
  try {
    output = await call(args)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    // keep throw for caller to decide
    // but still capture
  }
  const ms = Date.now() - start
  const entry = { label, args, output, error, ms, ts: new Date().toISOString() }
  captures.push(entry)
  const safeLabel = label.replace(/[^a-z0-9]+/gi, "-")
  await writeFile(join(CAPTURE_DIR, `${Date.now()}-${safeLabel}.json`), JSON.stringify(entry, null, 2))
  console.log(`${error ? "❌" : "✅"} ${label} (${ms}ms)${error ? ": " + error : ""}`)
  if (error) throw new Error(error)
  return output
}

const formats = [
  { ext: "docx", content1: "# Test DOCX\n\nHello world\n\n- item 1\n- item 2", content2: "# Test DOCX v2\n\nHello updated world", finalContent: "# Final\n\nFinal content for docx" },
  { ext: "xlsx", content1: "# Sheet\n\n| A | B |\n| 1 | 2 |", content2: "# Sheet v2\n\n| A | B |\n| 3 | 4 |", finalContent: "# Sheet Final\n\n| A | B |\n| 9 | 9 |" },
  { ext: "pptx", content1: "# Slide 1\n\nHello PPTX", content2: "# Slide 1 Updated\n\nHello PPTX v2", finalContent: "# Final Slide\n\nFinal pptx" },
  { ext: "pdf", content1: "# PDF Test\n\nHello PDF", content2: "# PDF Test v2\n\nHello PDF updated", finalContent: "# PDF Final\n\nFinal pdf" },
]

const results = []

for (const fmt of formats) {
  const filePath = join(DOCS_DIR, `tracer-${fmt.ext}.${fmt.ext}`)
  // clean previous
  if (existsSync(filePath)) await rm(filePath, { force: true })
  const flow = `tracer-${fmt.ext}`
  let status = "PASS"
  let failStep = null
  let failErr = null
  try {
    // 1 create
    await tracked(`${flow}: create`, { action: "create", filePath, content: fmt.content1 })
    // 2 edit
    await tracked(`${flow}: edit`, { action: "edit", filePath, content: fmt.content2 })
    // 3 read (draft)
    const read1 = await tracked(`${flow}: read-draft`, { action: "read", filePath })
    if (!read1 || read1.length < 5) throw new Error(`read empty: ${read1}`)
    // 4 accept v2
    await tracked(`${flow}: accept-v2`, { action: "accept", filePath })
    // verify file exists
    const exists = existsSync(filePath)
    if (!exists) throw new Error("file not created after accept")
    // 5 create v3 for history depth 2
    await tracked(`${flow}: create-v3`, { action: "create", filePath, content: fmt.finalContent })
    await tracked(`${flow}: accept-v3`, { action: "accept", filePath })
    // 6 history should have 2
    const hist = await tracked(`${flow}: history`, { action: "history", filePath })
    if (!hist.includes("2 accept-points") && !hist.includes("2")) {
      // parse JSON inside
      const m = hist.match(/\[[\s\S]*\]/)
      if (m) {
        const arr = JSON.parse(m[0])
        if (arr.length < 2) throw new Error(`history length ${arr.length} <2`)
      } else if (!hist.includes("accept-points")) {
        throw new Error(`history unexpected: ${hist.slice(0,200)}`)
      }
    }
    // extract timestamps for revert
    const histJson = hist.match(/\[[\s\S]*\]/)
    let tsToRevert = null
    if (histJson) {
      const arr = JSON.parse(histJson[0])
      tsToRevert = arr[0].timestamp
    }
    if (tsToRevert != null) {
      await tracked(`${flow}: revert-to-v1`, { action: "revert", filePath, timestamp: tsToRevert })
      await tracked(`${flow}: accept-revert`, { action: "accept", filePath })
      const readAfter = await tracked(`${flow}: read-after-revert`, { action: "read", filePath })
      if (!readAfter) throw new Error("read after revert empty")
    }
  } catch (e) {
    status = "FAIL"
    failStep = e.message
    failErr = e.stack || e.message
  }
  results.push({ format: fmt.ext, filePath, status, failStep })
}

let md = `# Tracer Bullet Report\n\nGenerated: ${new Date().toISOString()}\nDataDir: ${DATA_DIR}\n\n## Summary\n\n`
for (const r of results) {
  md += `- ${r.format}: ${r.status === "PASS" ? "✅ PASS" : "❌ FAIL"} ${r.failStep ? `— ${r.failStep}` : ""} — \`${r.filePath}\`\n`
}
md += `\n## Captures\n\nCaptures stored in \`.capture/\` (${captures.length} files):\n\n`
for (const c of captures) {
  md += `- ${c.label}: ${c.error ? "error" : "ok"} (${c.ms}ms) — args: \`${JSON.stringify(c.args).slice(0,120)}\`\n`
}
md += `\n## Details\n\n`
for (const r of results) {
  md += `### ${r.format} — ${r.status}\n\nFile: \`${r.filePath}\`\n\n${r.failStep ? `Fail: ${r.failStep}\n` : "All steps passed.\n"}\n`
}
md += `\n---\nIsolated Runtime: only @xirothedev/openoffice-plugin-opencode loaded. No global plugins.\n`

await writeFile(REPORT_PATH, md)
console.log(`\nReport written to ${REPORT_PATH}`)
for (const r of results) console.log(`${r.status === "PASS" ? "✅" : "❌"} ${r.format}: ${r.status}`)

const failed = results.filter(r => r.status === "FAIL")
if (failed.length) {
  console.log(`\n${failed.length} format(s) failed — see report for capture links`)
  process.exit(1)
} else {
  console.log("\nAll tracer bullets passed")
}
