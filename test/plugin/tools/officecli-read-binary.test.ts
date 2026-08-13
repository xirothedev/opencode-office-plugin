import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../../../src/core/storage/paths.ts"
import { mkdir, rm, writeFile } from "fs/promises"

describe("officecli read binary file", () => {
  const testFile = "/tmp/read-binary-test.bin"
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

  it("read unknown extension treats as text", async () => {
    // Write binary file
    await writeFile(testFile, "fake binary content", "utf-8")

    const result = await officecliTool.execute(
      { action: "read", filePath: testFile },
      mockContext
    )
    expect(result.output).toContain("fake binary content")
  })
})
