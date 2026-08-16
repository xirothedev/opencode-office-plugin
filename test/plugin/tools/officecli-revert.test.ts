import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { getFilePathHash } from "@/core/storage/paths"
import { readFile } from "fs/promises"
import { getDraftPath } from "@/core/draft/manager"

describe("officecli revert action", () => {
  const testFile = "/tmp/revert-test.docx"
  const testHash = getFilePathHash(testFile)
  setupHermeticDirs()
  cleanupTestFile(testFile)

  it("revert creates draft from snapshot", async () => {
    // Create + accept with timestamp
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "v1" })
    await runTool(officecliTool, { action: "accept", filePath: testFile, timestamp: 1000 })

    // Create + accept with different content
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "v2" })
    await runTool(officecliTool, { action: "accept", filePath: testFile, timestamp: 2000 })

    // Revert to v1
    const result = await runTool(officecliTool, { action: "revert", filePath: testFile, timestamp: 1000 })
    expect(result).toContain("Reverted")

    // Verify draft created with v1 content
    const draftPath = getDraftPath(testHash, "test-session", ".docx")
    const draftContent = await readFile(draftPath, "utf-8")
    expect(draftContent).toBe("v1")
  })

  it("revert requires valid timestamp", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "v1" })
    await runTool(officecliTool, { action: "accept", filePath: testFile, timestamp: 1000 })

    // Try revert with non-existent timestamp
    await expect(
      runTool(officecliTool, { action: "revert", filePath: testFile, timestamp: 9999 })
    ).rejects.toThrow(/snapshot not found for timestamp/)
  })
})
