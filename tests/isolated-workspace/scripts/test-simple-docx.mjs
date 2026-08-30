#!/usr/bin/env bun
// ponytail: opencode officecli simple test — create a docx draft, accept it, report size

import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { stat } from "fs/promises"
import { Effect, Schema } from "effect"

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
const FILE = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs/opencode-simple-test.docx"

configureOptions({ dataDir: DATA_DIR, staleLockHours: 24, pdfEngine: "weasyprint" })

const mockContext = {
  agent: "opencode",
  sessionID: process.env.OPENCODE_SESSION_ID ?? "ses_opencode_simple_test",
  messageID: "m1",
  id: "c1",
  progress: () => Effect.void,
}

async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const res = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return res.output
}

const content = "# Hello from opencode\n\nThis is a test via officecli tool."

console.log("1. officecli create...")
console.log(await call({ action: "create", filePath: FILE, content }))

console.log("2. officecli accept...")
console.log(await call({ action: "accept", filePath: FILE }))

const s = await stat(FILE)
console.log(`3. accepted file: ${FILE}`)
console.log(`   size: ${s.size} bytes`)
