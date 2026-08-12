import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli.js"
import { copyFile, rm } from "fs/promises"
import { join } from "path"

describe("officecli read DOCX", () => {
  const testFile = "/tmp/test-read.docx"
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
    await copyFile(fixturePath, testFile)
  })

  afterEach(async () => {
    await rm(testFile, { force: true })
  })

  it("read DOCX returns markdown with extracted text", async () => {
    const result = await officecliTool.execute(
      { action: "read", filePath: testFile },
      mockContext
    )
    expect(result.output).toContain("Hello DOCX")
  })
})
