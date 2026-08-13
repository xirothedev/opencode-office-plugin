import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { getDraftsDir, getHistoryDir, getLocksDir, getFilePathHash } from "../../../src/core/storage/paths.ts"
import { mkdir, rm, readFile } from "fs/promises"
import { getDraftPath } from "../../../src/core/draft/manager.ts"

describe("officecli revert action", () => {
  const testFile = "/tmp/revert-test.docx"
  const testHash = getFilePathHash(testFile)
  const mockContext = {
    agent: "test-agent",
    sessionID: "test-session",
    messageID: "test-message",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  beforeEach(async () => {
    await mkdir(getDraftsDir(), { recursive: true })
    await mkdir(getHistoryDir(), { recursive: true })
    await mkdir(getLocksDir(), { recursive: true })
  })

  afterEach(async () => {
    await rm(getDraftsDir(), { recursive: true, force: true })
    await rm(getHistoryDir(), { recursive: true, force: true })
    await rm(getLocksDir(), { recursive: true, force: true })
  })

  it("revert creates draft from snapshot", async () => {
    // Create + accept with timestamp
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "v1" },
      mockContext
    )
    await officecliTool.execute(
      { action: "accept", filePath: testFile, timestamp: 1000 },
      mockContext
    )

    // Create + accept with different content
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "v2" },
      mockContext
    )
    await officecliTool.execute(
      { action: "accept", filePath: testFile, timestamp: 2000 },
      mockContext
    )

    // Revert to v1
    const result = await officecliTool.execute(
      { action: "revert", filePath: testFile, timestamp: 1000 },
      mockContext
    )
    expect(result.output).toContain("Reverted")

    // Verify draft created with v1 content
    const draftPath = getDraftPath(testHash, "test-session", ".docx")
    const draftContent = await readFile(draftPath, "utf-8")
    expect(draftContent).toBe("v1")
  })

  it("revert requires valid timestamp", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "v1" },
      mockContext
    )
    await officecliTool.execute(
      { action: "accept", filePath: testFile, timestamp: 1000 },
      mockContext
    )

    // Try revert with non-existent timestamp
    const result = await officecliTool.execute(
      { action: "revert", filePath: testFile, timestamp: 9999 },
      mockContext
    )
    expect(result.output).toContain("error")
  })
})
