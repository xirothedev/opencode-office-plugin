import { describe, it, expect, beforeEach, vi } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { getFilePathHash } from "@/core/storage/paths"
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
  setupHermeticDirs()
  cleanupTestFile(testFile)
  cleanupTestFile(previewPath)

  beforeEach(() => {
    delete process.env.MOCK_PANDOC_FAIL
    vi.mocked(exec).mockClear()
  })

  function pandocCommands(): string[] {
    const m = vi.mocked(exec) as unknown as { mock: { calls: string[][] } }
    return m.mock.calls.map((c) => c[0])
  }

  it("renders the draft to an HTML file via pandoc and returns its path", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Report\n\nHello.\n" })
    const result = await runTool(officecliTool, { action: "preview", filePath: testFile })
    expect(result).toContain(previewPath)
    const commands = pandocCommands()
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain('pandoc "')
    expect(commands[0]).toContain(`-o "${previewPath}"`)
  })

  it("errors when there is no draft", async () => {
    await expect(runTool(officecliTool, { action: "preview", filePath: testFile })).rejects.toThrow(
      /no active draft to preview/
    )
  })

  it("returns an error string when pandoc fails", async () => {
    process.env.MOCK_PANDOC_FAIL = "1"
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "content" })
    await expect(runTool(officecliTool, { action: "preview", filePath: testFile })).rejects.toThrow(
      /pandoc preview failed/
    )
  })

  it("requires filePath", async () => {
    await expect(runTool(officecliTool, { action: "preview" })).rejects.toThrow()
  })
})
