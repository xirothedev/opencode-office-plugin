import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir } from "@/core/storage/paths"
import { mkdir, rm } from "fs/promises"
import { existsSync } from "fs"

vi.mock("child_process", () => {
  const calls: string[] = []
  const exec = vi.fn((cmd: string, cb: (err: Error | null, result: { stdout: string }) => void) => {
    calls.push(cmd)
    if (process.env.MOCK_PANDOC_FAIL === "1") {
      cb(new Error("spawn pandoc ENOENT"), { stdout: "" })
    } else {
      cb(null, { stdout: "" })
    }
  })
  return { exec, __calls: calls }
})

import { exec } from "child_process"

describe("officecli PDF write", () => {
  const testFile = "/tmp/officecli-pdf-write.pdf"
  const mockContext = {
    agent: "test-agent",
    sessionID: "test-session",
    messageID: "test-message",
    directory: "/tmp",
    worktree: "/tmp",
  }

  beforeEach(async () => {
    delete process.env.OFFICECLI_PDF_ENGINE
    delete process.env.MOCK_PANDOC_FAIL
    vi.mocked(exec).mockClear()
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

  function pandocCommands(): string[] {
    const m = vi.mocked(exec) as unknown as { mock: { calls: string[][] } }
    return m.mock.calls.map((c) => c[0])
  }

  it("accept converts the markdown draft to PDF via pandoc with xelatex", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Report\n\nHello world.\n" },
      mockContext
    )
    const result = await officecliTool.execute({ action: "accept", filePath: testFile }, mockContext)
    expect(result).toEqual({ output: expect.stringContaining("Accepted") })
    const commands = pandocCommands()
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain('pandoc "')
    expect(commands[0]).toContain("--pdf-engine=xelatex")
    expect(commands[0]).toContain(`-o "${testFile}"`)
  })

  it("uses the engine from OFFICECLI_PDF_ENGINE when set", async () => {
    process.env.OFFICECLI_PDF_ENGINE = "typst"
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "content\n" },
      mockContext
    )
    await officecliTool.execute({ action: "accept", filePath: testFile }, mockContext)
    expect(pandocCommands()[0]).toContain("--pdf-engine=typst")
  })

  it("cleans up the temporary markdown file", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "content\n" },
      mockContext
    )
    await officecliTool.execute({ action: "accept", filePath: testFile }, mockContext)
    expect(existsSync(`${testFile}.tmp.md`)).toBe(false)
  })

  it("surfaces a clear error when pandoc is missing", async () => {
    process.env.MOCK_PANDOC_FAIL = "1"
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "content\n" },
      mockContext
    )
    await expect(
      officecliTool.execute({ action: "accept", filePath: testFile }, mockContext)
    ).rejects.toThrow(/pandoc PDF conversion failed: spawn pandoc ENOENT/)
  })
})
