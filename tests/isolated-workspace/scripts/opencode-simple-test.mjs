#!/usr/bin/env bun
// opencode simple test — drive the officecli plugin tool: create draft -> accept -> report size
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { stat } from "fs/promises"
import { Effect, Schema } from "effect"

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
const FP = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs/opencode-simple-test.docx"
const CONTENT = "# Hello from opencode\n\nThis is a test via officecli tool."

configureOptions({ dataDir: DATA_DIR, staleLockHours: 24, pdfEngine: "weasyprint" })

const mockContext = { agent: "opencode", sessionID: "ses_fb0dc70eeffeaO78out72DWx3a", messageID: "m1", id: "c1", progress: () => Effect.void }
async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return res.output
}

console.log("[1] create:", await call({ action: "create", filePath: FP, content: CONTENT }))
console.log("[2] accept:", await call({ action: "accept", filePath: FP }))

const s = await stat(FP)
console.log(`[3] file size: ${s.size} bytes — ${FP}`)
