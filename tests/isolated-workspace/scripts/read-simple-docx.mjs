#!/usr/bin/env bun
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { configureOptions } from "../../../src/core/options.ts"
import { Effect, Schema } from "effect"

configureOptions({ dataDir: "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/.data" })
const mockContext = { agent: "opencode", sessionID: "ses_fb0e1366fffe3ra4BOzT7KQOgc", messageID: "m1", id: "c1", progress: () => Effect.void }
const input = Schema.decodeUnknownSync(officecliTool.input)({
  action: "read",
  filePath: "/Users/xirothedev/workspace/opencode-office-plugin/tests/isolated-workspace/docs/opencode-simple-test.docx",
})
console.log(await (await Effect.runPromise(officecliTool.execute(input, mockContext))).output)
