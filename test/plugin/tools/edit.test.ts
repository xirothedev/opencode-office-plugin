import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { editTool } from "../../../src/plugin/tools/edit.js"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../../../src/core/storage/paths.js"
import { mkdir, rm } from "fs/promises"
import { readFileSync, writeFileSync, existsSync } from "fs"

describe("edit tool", () => {
  const testFile = "/tmp/edit-test.txt"
  const binaryFile = "/tmp/edit-test.docx"
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
    if (existsSync(testFile)) await rm(testFile)
    if (existsSync(binaryFile)) await rm(binaryFile)
  })

  it("denies binary files", async () => {
    writeFileSync(binaryFile, "binary content")
    const result = await editTool.execute(
      { filePath: binaryFile, oldString: "old", newString: "new" },
      mockContext
    )
    expect(result.output).toContain("use officecli")
  })

  it("edits text files via draft", async () => {
    writeFileSync(testFile, "hello world")
    const result = await editTool.execute(
      { filePath: testFile, oldString: "world", newString: "opencode" },
      mockContext
    )
    expect(result.output).toContain("applied to draft")
  })
})
