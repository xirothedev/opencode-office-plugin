import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli.js"
import { getDraftsDir, getHistoryDir, getLocksDir } from "@/core/storage/paths.js"
import { mkdir, rm } from "fs/promises"
import { readFileSync, existsSync } from "fs"

describe("officecli tool", () => {
  const testFile = "/tmp/officecli-test.txt"
  const mockContext = {
    agent: "test-agent",
    sessionID: "test-session",
    messageID: "test-message",
    directory: "/tmp",
    worktree: "/tmp",
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
    if (existsSync(testFile)) {
      await rm(testFile)
    }
  })

  it("create action creates draft", async () => {
    const result = await officecliTool.execute(
      { action: "create", filePath: testFile, content: "test content" },
      mockContext
    )
    expect(result).toEqual({ output: expect.stringContaining("Draft created") })
  })

  it("accept action writes real file", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "draft content" },
      mockContext
    )
    const result = await officecliTool.execute({ action: "accept", filePath: testFile }, mockContext)
    expect(result).toEqual({ output: expect.stringContaining("Accepted") })
    expect(existsSync(testFile)).toBe(true)
    const content = readFileSync(testFile, "utf-8")
    expect(content).toBe("draft content")
  })
})
