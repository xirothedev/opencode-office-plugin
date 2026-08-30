#!/usr/bin/env bun
// Ad-hoc officecli tool invoker — drives the real tool code path (read/create/accept) for the grill STT1 run.
// Usage: bun officecli-call.mjs '<json args>'
import { officecliTool } from "/Users/xirothedev/workspace/opencode-office-plugin/src/plugin/tools/officecli.ts"
import { configureOptions } from "/Users/xirothedev/workspace/opencode-office-plugin/src/core/options.ts"
import { getDraftsDir, getHistoryDir, getLocksDir, getRegistryDir, getSidecarsDir } from "/Users/xirothedev/workspace/opencode-office-plugin/src/core/storage/paths.ts"
import { mkdir } from "fs/promises"
import { Effect, Schema } from "effect"

const DATA_DIR = "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data"
configureOptions({ dataDir: DATA_DIR, pdfEngine: "weasyprint" })
for (const d of [getDraftsDir(), getHistoryDir(), getLocksDir(), getRegistryDir(), getSidecarsDir()]) {
  await mkdir(d, { recursive: true })
}

const args = JSON.parse(process.argv[2] ?? "")
const input = Schema.decodeUnknownSync(officecliTool.input)(args)
const sessionID = args.sessionID ?? "grill-stt1"
delete args.sessionID
const context = { agent: "grill-stt1", sessionID, messageID: "m1", id: "c1", progress: () => Effect.void }
const res = await Effect.runPromise(officecliTool.execute(input, context))
process.stdout.write(typeof res.output === "string" ? res.output + "\n" : JSON.stringify(res.output, null, 2))
