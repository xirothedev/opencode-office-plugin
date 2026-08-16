import { describe, it, expect, beforeEach, vi } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
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
  setupHermeticDirs()
  cleanupTestFile(testFile)

  beforeEach(() => {
    delete process.env.OFFICECLI_PDF_ENGINE
    delete process.env.MOCK_PANDOC_FAIL
    vi.mocked(exec).mockClear()
  })

  function pandocCommands(): string[] {
    const m = vi.mocked(exec) as unknown as { mock: { calls: string[][] } }
    return m.mock.calls.map((c) => c[0])
  }

  it("accept converts the markdown draft to PDF via pandoc with xelatex", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Report\n\nHello world.\n" })
    const result = await runTool(officecliTool, { action: "accept", filePath: testFile })
    expect(result).toContain("Accepted")
    const commands = pandocCommands()
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain('pandoc "')
    expect(commands[0]).toContain("--pdf-engine=xelatex")
    expect(commands[0]).toContain(`-o "${testFile}"`)
  })

  it("uses the engine from OFFICECLI_PDF_ENGINE when set", async () => {
    process.env.OFFICECLI_PDF_ENGINE = "typst"
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "content\n" })
    await runTool(officecliTool, { action: "accept", filePath: testFile })
    expect(pandocCommands()[0]).toContain("--pdf-engine=typst")
  })

  it("cleans up the temporary markdown file", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "content\n" })
    await runTool(officecliTool, { action: "accept", filePath: testFile })
    expect(existsSync(`${testFile}.tmp.md`)).toBe(false)
  })

  it("surfaces a clear error when pandoc is missing", async () => {
    process.env.MOCK_PANDOC_FAIL = "1"
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "content\n" })
    await expect(runTool(officecliTool, { action: "accept", filePath: testFile })).rejects.toThrow(
      /pandoc PDF conversion failed: spawn pandoc ENOENT/
    )
  })
})
