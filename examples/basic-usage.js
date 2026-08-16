#!/usr/bin/env bun

/**
 * Example: Using @xirothedev/openoffice-plugin-opencode programmatically
 *
 * This script demonstrates how the plugin works internally.
 * In real usage, opencode calls these tools automatically.
 *
 * Run with: bun examples/basic-usage.js
 */

import { Effect, Schema } from "effect"
import { officecliTool } from "../dist/plugin/tools/officecli"
import { configureOptions } from "../dist/core/options"
import { tmpdir } from "os"
import { join } from "path"

const mockContext = {
  agent: "example-agent",
  sessionID: "example-session",
  messageID: "example-message",
  id: "example-call",
  progress: () => Effect.void,
}

async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const result = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return result.output
}

async function main() {
  configureOptions({ dataDir: join(tmpdir(), "openoffice-example") })

  const testFile = "/tmp/example-doc.docx"

  console.log("1. Create draft document")
  await call({ action: "create", filePath: testFile, content: "# Example Document\n\nThis is a test." })
  console.log("   ✓ Draft created")

  console.log("\n2. Read draft")
  const readResult = await call({ action: "read", filePath: testFile })
  console.log("   Content:", readResult.substring(0, 50) + "...")

  console.log("\n3. Accept changes")
  await call({ action: "accept", filePath: testFile })
  console.log("   ✓ Document written to", testFile)

  console.log("\n4. View history")
  const historyResult = await call({ action: "history", filePath: testFile })
  console.log("   History:", historyResult)

  console.log("\n5. Read real file (extract text from DOCX)")
  const finalRead = await call({ action: "read", filePath: testFile })
  console.log("   Extracted:", finalRead.substring(0, 50) + "...")

  console.log("\n✅ Example complete!")
  console.log("   Real file created:", testFile)
  console.log("   Run: pandoc", testFile, "-t markdown")
}

main().catch(console.error)
