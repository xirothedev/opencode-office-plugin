import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir, getFilePathHash } from "@/core/storage/paths"
import { mkdir, rm } from "fs/promises"
import { getLock } from "@/core/draft/lock"

describe("officecli undo action", () => {
  const testFile = "/tmp/undo-test.docx"
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

  it("undo releases lock", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "test" },
      mockContext
    )
    expect(getLock(testHash)).not.toBeNull()

    const result = await officecliTool.execute(
      { action: "undo", filePath: testFile },
      mockContext
    )
    expect(result.output).toContain("undone")
    expect(getLock(testHash)).toBeNull()
  })
})
