import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../../../src/core/storage/paths.ts"
import { mkdir, rm, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { resolve } from "path"

describe("officecli diff action", () => {
  const testFile = "/tmp/officecli-diff.txt"
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
    if (existsSync(testFile)) await rm(testFile)
  })

  it("returns a unified diff between real file and draft", async () => {
    await writeFile(testFile, "line one\nline two\nline three\n")
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "line one\nline two changed\nline three\n" },
      mockContext
    )
    const result = await officecliTool.execute({ action: "diff", filePath: testFile }, mockContext)
    expect(result.output).toContain("-line two")
    expect(result.output).toContain("+line two changed")
  })

  it("reports no differences when draft equals the real file", async () => {
    await writeFile(testFile, "same content\n")
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "same content\n" },
      mockContext
    )
    const result = await officecliTool.execute({ action: "diff", filePath: testFile }, mockContext)
    expect(result.output).not.toContain("@@")
  })

  it("errors when no draft exists", async () => {
    await writeFile(testFile, "content\n")
    const result = await officecliTool.execute({ action: "diff", filePath: testFile }, mockContext)
    expect(result.output).toContain("error: no active draft")
  })

  it("names the other session when a draft exists but not for this session", async () => {
    await writeFile(testFile, "content\n")
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "other session's draft\n" },
      { ...mockContext, sessionID: "other-session" }
    )
    const result = await officecliTool.execute({ action: "diff", filePath: testFile }, mockContext)
    expect(result.output).toContain("error: no draft for this session; draft held by session other-session")
  })

  it("errors when the real file does not exist", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "draft only\n" },
      mockContext
    )
    const result = await officecliTool.execute({ action: "diff", filePath: testFile }, mockContext)
    expect(result.output).toContain("error: file not found")
  })

  it("diffs a docx draft against the extracted real file", async () => {
    const docxPath = resolve("test/fixtures/sample.docx")
    const result = await officecliTool.execute(
      { action: "create", filePath: docxPath, content: "Some draft content with changes.\n" },
      mockContext
    )
    expect(result).toEqual({ output: expect.stringContaining("Draft created") })
    const diff = await officecliTool.execute({ action: "diff", filePath: docxPath }, mockContext)
    expect(diff.output).toContain("+Some draft content with changes.")
  })
})
