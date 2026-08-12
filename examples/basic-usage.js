#!/usr/bin/env node

/**
 * Example: Using @openoffice/plugin programmatically
 *
 * This script demonstrates how the plugin works internally.
 * In real usage, opencode calls these tools automatically.
 */

import { officecliTool } from "../dist/plugin/tools/officecli.js"
import { mkdir } from "fs/promises"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../dist/core/storage/paths.js"

const mockContext = {
  agent: "example-agent",
  sessionID: "example-session",
  messageID: "example-message",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

async function main() {
  // Setup directories
  await mkdir(getDraftsDir(), { recursive: true })
  await mkdir(getHistoryDir(), { recursive: true })
  await mkdir(getLocksDir(), { recursive: true })

  const testFile = "/tmp/example-doc.docx"

  console.log("1. Create draft document")
  await officecliTool.execute(
    { action: "create", filePath: testFile, content: "# Example Document\n\nThis is a test." },
    mockContext
  )
  console.log("   ✓ Draft created")

  console.log("\n2. Read draft")
  const readResult = await officecliTool.execute(
    { action: "read", filePath: testFile },
    mockContext
  )
  console.log("   Content:", readResult.output.substring(0, 50) + "...")

  console.log("\n3. Accept changes")
  await officecliTool.execute({ action: "accept", filePath: testFile }, mockContext)
  console.log("   ✓ Document written to", testFile)

  console.log("\n4. View history")
  const historyResult = await officecliTool.execute(
    { action: "history", filePath: testFile },
    mockContext
  )
  console.log("   History:", historyResult.output)

  console.log("\n5. Read real file (extract text from DOCX)")
  const finalRead = await officecliTool.execute(
    { action: "read", filePath: testFile },
    mockContext
  )
  console.log("   Extracted:", finalRead.output.substring(0, 50) + "...")

  console.log("\n✅ Example complete!")
  console.log("   Real file created:", testFile)
  console.log("   Run: pandoc", testFile, "-t markdown")
}

main().catch(console.error)
