import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"

describe("officecli history action", () => {
  const testFile = "/tmp/history-test.docx"
  setupHermeticDirs()
  cleanupTestFile(testFile)

  it("history returns list of accept-points", async () => {
    // Create + accept twice
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "v1" })
    await runTool(officecliTool, { action: "accept", filePath: testFile })

    await runTool(officecliTool, { action: "create", filePath: testFile, content: "v2" })
    await runTool(officecliTool, { action: "accept", filePath: testFile })

    const result = await runTool(officecliTool, { action: "history", filePath: testFile })
    expect(result).toContain("2 accept-points")
  })

  it("history returns metadata with timestamps and session IDs", async () => {
    // Create + accept with different timestamps
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "v1" })
    await runTool(officecliTool, { action: "accept", filePath: testFile, timestamp: 1000 })

    await runTool(officecliTool, { action: "create", filePath: testFile, content: "v2" })
    await runTool(officecliTool, { action: "accept", filePath: testFile, timestamp: 2000 })

    const result = await runTool(officecliTool, { action: "history", filePath: testFile })

    // Output should be JSON-parseable
    const jsonMatch = result.match(/\[[\s\S]*\]/)
    expect(jsonMatch).toBeTruthy()
    const history = JSON.parse(jsonMatch![0])
    expect(history).toHaveLength(2)
    expect(history[0]).toHaveProperty("timestamp")
    expect(history[0]).toHaveProperty("sessionID")
    expect(history[0].timestamp).toBe(1000)
    expect(history[0].sessionID).toBe("test-session")
    expect(history[1].timestamp).toBe(2000)
  })
})
