import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir, getFilePathHash } from "@/core/storage/paths"
import { mkdir, rm, readFile } from "fs/promises"
import { getDraftPath } from "@/core/draft/manager"

describe("officecli edit action", () => {
  const testFile = "/tmp/edit-test.docx"
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

  it("edit updates draft content", async () => {
    // Create draft first
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "initial content" },
      mockContext
    )

    // Edit draft
    const result = await officecliTool.execute(
      { action: "edit", filePath: testFile, content: "updated content" },
      mockContext
    )
    expect(result.output).toContain("edited")

    // Verify draft updated
    const draftPath = getDraftPath(testHash, "test-session", ".docx")
    const draftContent = await readFile(draftPath, "utf-8")
    expect(draftContent).toBe("updated content")
  })

  it("edit requires active lock", async () => {
    // Try edit without creating draft first
    const result = await officecliTool.execute(
      { action: "edit", filePath: testFile, content: "updated" },
      mockContext
    )
    expect(result.output).toContain("error")
  })
})
