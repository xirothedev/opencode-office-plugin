import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "../../../src/plugin/tools/officecli"
import { copyFile, rm, mkdir } from "fs/promises"
import { join } from "path"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../../../src/core/storage/paths"

describe("officecli edit binary (DOCX)", () => {
  const testFile = "/tmp/test-edit.docx"
  const fixturePath = join(process.cwd(), "test/fixtures/sample.docx")
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
    await copyFile(fixturePath, testFile)
  })

  afterEach(async () => {
    await rm(testFile, { force: true })
    await rm(getDraftsDir(), { recursive: true, force: true })
    await rm(getHistoryDir(), { recursive: true, force: true })
    await rm(getLocksDir(), { recursive: true, force: true })
  })

  it("edit DOCX updates content after accept", async () => {
    // Read original
    const readResult = await officecliTool.execute(
      { action: "read", filePath: testFile },
      mockContext
    )
    expect(readResult.output).toContain("Hello DOCX")

    // Create draft with new content
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Updated DOCX\n\nNew content here." },
      mockContext
    )

    // Accept
    await officecliTool.execute(
      { action: "accept", filePath: testFile },
      mockContext
    )

    // Read again to verify
    const newReadResult = await officecliTool.execute(
      { action: "read", filePath: testFile },
      mockContext
    )
    expect(newReadResult.output).toContain("Updated DOCX")
    expect(newReadResult.output).toContain("New content here")
  })
})
