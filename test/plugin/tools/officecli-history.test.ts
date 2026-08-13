import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "../../../src/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../../../src/core/storage/paths"
import { mkdir, rm } from "fs/promises"

describe("officecli history action", () => {
  const testFile = "/tmp/history-test.docx"
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

  it("history returns list of accept-points", async () => {
    // Create + accept twice
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "v1" },
      mockContext
    )
    await officecliTool.execute(
      { action: "accept", filePath: testFile },
      mockContext
    )

    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "v2" },
      mockContext
    )
    await officecliTool.execute(
      { action: "accept", filePath: testFile },
      mockContext
    )

    const result = await officecliTool.execute(
      { action: "history", filePath: testFile },
      mockContext
    )
    expect(result.output).toContain("2 accept-points")
  })

  it("history returns metadata with timestamps and session IDs", async () => {
    // Create + accept with different timestamps
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "v1" },
      mockContext
    )
    await officecliTool.execute(
      { action: "accept", filePath: testFile, timestamp: 1000 },
      mockContext
    )

    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "v2" },
      mockContext
    )
    await officecliTool.execute(
      { action: "accept", filePath: testFile, timestamp: 2000 },
      mockContext
    )

    const result = await officecliTool.execute(
      { action: "history", filePath: testFile },
      mockContext
    )

    // Output should be JSON-parseable
    const jsonMatch = result.output.match(/\[[\s\S]*\]/)
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
