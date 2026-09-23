import { describe, it, expect, beforeEach, mock } from "bun:test"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { getFilePathHash } from "@/core/storage/paths"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

describe("officecli preview action", () => {
  const testFile = "/tmp/officecli-preview.txt"
  const previewDir = join(tmpdir(), "openoffice-preview")
  const previewPath = join(previewDir, `${getFilePathHash(testFile)}.html`)
  setupHermeticDirs()
  cleanupTestFile(testFile)
  cleanupTestFile(previewPath)

  beforeEach(() => {
    delete process.env.MOCK_PANDOC_FAIL
    pandocCalls.length = 0
  })

  function pandocCommands(): string[] {
    return [...pandocCalls]
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
