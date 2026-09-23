import { describe, it, expect, beforeEach, mock } from "bun:test"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { existsSync } from "node:fs"

// ponytail: mock the owned spawn seam, never node:child_process (sharp imports spawnSync from it)
const pandocCalls: string[] = []

mock.module("@/core/format/exec", () => {
  return {
    runCommand: mock(async (cmd: string) => {
      pandocCalls.push(cmd)
      if (process.env.MOCK_PANDOC_FAIL === "1") {
        throw new Error("spawn pandoc ENOENT")
      }
    }),
  }
})

describe("officecli PDF write", () => {
  const testFile = "/tmp/officecli-pdf-write.pdf"
  setupHermeticDirs()
  cleanupTestFile(testFile)

  beforeEach(() => {
    delete process.env.OFFICECLI_PDF_ENGINE
    delete process.env.MOCK_PANDOC_FAIL
    pandocCalls.length = 0
  })

  function pandocCommands(): string[] {
    return [...pandocCalls]
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
