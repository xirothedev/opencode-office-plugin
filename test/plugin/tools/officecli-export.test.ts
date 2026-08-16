import { describe, it, expect, beforeEach, vi } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { copyFile } from "fs/promises"
import { join } from "path"

const { pandocCalls, tmpMarkdownContents } = vi.hoisted(() => {
  const pandocCalls: string[] = []
  const tmpMarkdownContents: string[] = []
  return { pandocCalls, tmpMarkdownContents }
})

vi.mock("child_process", async () => {
  const fs = await import("node:fs")
  return {
    exec: vi.fn((cmd: string, cb: (err: Error | null, result: { stdout: string }) => void) => {
      pandocCalls.push(cmd)
      const tmpMatch = cmd.match(/"([^"]+\.tmp\.md)"/)
      if (tmpMatch) {
        try {
          tmpMarkdownContents.push(fs.readFileSync(tmpMatch[1], "utf-8"))
        } catch {
          // temp file may not exist yet
        }
      }
      cb(null, { stdout: "" })
    }),
  }
})

describe("officecli export", () => {
  const testFile = "/tmp/test-export.docx"
  const pdfTarget = "/tmp/test-export-target.pdf"
  const docxTarget = "/tmp/test-export-target.docx"
  const fixturePath = join(process.cwd(), "test/fixtures/sample.docx")
  const pdfFixturePath = join(process.cwd(), "test/fixtures/sample.pdf")
  setupHermeticDirs()
  cleanupTestFile(testFile)
  cleanupTestFile(pdfTarget)
  cleanupTestFile(docxTarget)
  cleanupTestFile("/tmp/test-export-source.pdf")
  cleanupTestFile("/tmp/test-export-image.png")

  beforeEach(async () => {
    await copyFile(fixturePath, testFile)
    pandocCalls.length = 0
    tmpMarkdownContents.length = 0
  })

  it("export docx draft to pdf converts the draft content, not the real file", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Draft content\n\nExported marker text" })
    const result = await runTool(officecliTool, { action: "export", filePath: testFile, targetPath: pdfTarget })
    expect(result).toContain(`Exported ${testFile} to ${pdfTarget}`)
    expect(pandocCalls).toHaveLength(1)
    expect(pandocCalls[0]).toContain(`-o "${pdfTarget}"`)
    expect(tmpMarkdownContents[0]).toContain("Exported marker text")
  })

  it("export pdf to docx without a draft converts the real file", async () => {
    await copyFile(pdfFixturePath, "/tmp/test-export-source.pdf")
    const result = await runTool(officecliTool, {
      action: "export",
      filePath: "/tmp/test-export-source.pdf",
      targetPath: docxTarget,
    })
    expect(result).toContain("Exported")
    // DOCX now uses docx library, not pandoc — check file created
    const { existsSync } = await import("fs")
    expect(existsSync(docxTarget)).toBe(true)
  })

  it("errors when targetPath is the same file as filePath", async () => {
    await expect(runTool(officecliTool, { action: "export", filePath: testFile, targetPath: testFile })).rejects.toThrow(
      /targetPath must differ from filePath/
    )
  })

  it("errors when the source format is an image", async () => {
    await copyFile(fixturePath, "/tmp/test-export-image.png")
    await expect(
      runTool(officecliTool, { action: "export", filePath: "/tmp/test-export-image.png", targetPath: pdfTarget })
    ).rejects.toThrow(/export source format not supported: \.png/)
  })

  it("errors when the target format is an image", async () => {
    await expect(
      runTool(officecliTool, { action: "export", filePath: testFile, targetPath: "/tmp/test-export-target.png" })
    ).rejects.toThrow(/export target format not supported: \.png/)
  })

  it("errors when the source file does not exist and no draft exists", async () => {
    await expect(
      runTool(officecliTool, { action: "export", filePath: "/tmp/test-export-missing.docx", targetPath: pdfTarget })
    ).rejects.toThrow(/file not found/)
  })
})
