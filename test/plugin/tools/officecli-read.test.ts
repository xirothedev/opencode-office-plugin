import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../../../src/core/storage/paths.ts"
import { mkdir, rm, writeFile } from "fs/promises"

describe("officecli read action", () => {
  const testFile = "/tmp/read-test.txt"
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

  it("read returns draft content if exists", async () => {
    // Create draft
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "draft content" },
      mockContext
    )

    const result = await officecliTool.execute(
      { action: "read", filePath: testFile },
      mockContext
    )
    expect(result.output).toContain("draft content")
  })

  it("read returns real file if no draft", async () => {
    // Write real file
    await writeFile(testFile, "real content", "utf-8")

    const result = await officecliTool.execute(
      { action: "read", filePath: testFile },
      mockContext
    )
    expect(result.output).toContain("real content")
  })
})
