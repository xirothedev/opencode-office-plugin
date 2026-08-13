import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli.js"
import { getDraftsDir, getHistoryDir, getLocksDir, getFilePathHash } from "@/core/storage/paths.js"
import { mkdir, rm } from "fs/promises"
import { existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

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

describe("officecli preview action", () => {
  const testFile = "/tmp/officecli-preview.txt"
  const previewDir = join(tmpdir(), "openoffice-preview")
  const previewPath = join(previewDir, `${getFilePathHash(testFile)}.html`)
  const mockContext = {
    agent: "test-agent",
    sessionID: "test-session",
    messageID: "test-message",
    directory: "/tmp",
    worktree: "/tmp",
  }

  beforeEach(async () => {
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
    if (existsSync(previewPath)) await rm(previewPath)
    if (existsSync(testFile)) await rm(testFile)
  })

  function pandocCommands(): string[] {
    const m = vi.mocked(exec) as unknown as { mock: { calls: string[][] } }
    return m.mock.calls.map((c) => c[0])
  }

  it("renders the draft to an HTML file via pandoc and returns its path", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Report\n\nHello.\n" },
      mockContext
    )
    const result = await officecliTool.execute({ action: "preview", filePath: testFile }, mockContext)
    expect(result.output).toContain(previewPath)
    const commands = pandocCommands()
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain('pandoc "')
    expect(commands[0]).toContain(`-o "${previewPath}"`)
  })

  it("errors when there is no draft", async () => {
    const result = await officecliTool.execute({ action: "preview", filePath: testFile }, mockContext)
    expect(result.output).toContain("error: no active draft to preview")
  })

  it("returns an error string when pandoc fails", async () => {
    process.env.MOCK_PANDOC_FAIL = "1"
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "content" },
      mockContext
    )
    const result = await officecliTool.execute({ action: "preview", filePath: testFile }, mockContext)
    expect(result.output).toContain("error: pandoc preview failed")
  })

  it("requires filePath", async () => {
    const result = await officecliTool.execute({ action: "preview" }, mockContext)
    expect(result.output).toContain("error")
  })
})
