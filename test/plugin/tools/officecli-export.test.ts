import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir } from "@/core/storage/paths"
import { copyFile, rm, mkdir } from "fs/promises"
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
    pandocCalls.length = 0
    tmpMarkdownContents.length = 0
    await mkdir(getDraftsDir(), { recursive: true })
    await mkdir(getHistoryDir(), { recursive: true })
    await mkdir(getLocksDir(), { recursive: true })
  })

  afterEach(async () => {
    await rm(testFile, { force: true })
    await rm(pdfTarget, { force: true })
    await rm(docxTarget, { force: true })
    await rm(getDraftsDir(), { recursive: true, force: true })
    await rm(getHistoryDir(), { recursive: true, force: true })
    await rm(getLocksDir(), { recursive: true, force: true })
  })

  it("export docx draft to pdf converts the draft content, not the real file", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Draft content\n\nExported marker text" },
      mockContext
    )
    const result = await officecliTool.execute(
      { action: "export", filePath: testFile, targetPath: pdfTarget },
      mockContext
    )
    expect(result.output).toContain(`Exported ${testFile} to ${pdfTarget}`)
    expect(pandocCalls).toHaveLength(1)
    expect(pandocCalls[0]).toContain(`-o "${pdfTarget}"`)
    expect(tmpMarkdownContents[0]).toContain("Exported marker text")
  })

  it("export pdf to docx without a draft converts the real file", async () => {
    await copyFile(pdfFixturePath, "/tmp/test-export-source.pdf")
    const result = await officecliTool.execute(
      { action: "export", filePath: "/tmp/test-export-source.pdf", targetPath: docxTarget },
      mockContext
    )
    expect(result.output).toContain("Exported")
    expect(pandocCalls).toHaveLength(1)
    expect(pandocCalls[0]).toContain(`-o "${docxTarget}"`)
    expect(tmpMarkdownContents[0].length).toBeGreaterThan(0)
  })

  it("errors when targetPath is the same file as filePath", async () => {
    const result = await officecliTool.execute(
      { action: "export", filePath: testFile, targetPath: testFile },
      mockContext
    )
    expect(result.output).toContain("error: targetPath must differ from filePath")
  })

  it("errors when the source format is an image", async () => {
    await copyFile(fixturePath, "/tmp/test-export-image.png")
    const result = await officecliTool.execute(
      { action: "export", filePath: "/tmp/test-export-image.png", targetPath: pdfTarget },
      mockContext
    )
    expect(result.output).toContain("error: export source format not supported: .png")
  })

  it("errors when the target format is an image", async () => {
    const result = await officecliTool.execute(
      { action: "export", filePath: testFile, targetPath: "/tmp/test-export-target.png" },
      mockContext
    )
    expect(result.output).toContain("error: export target format not supported: .png")
  })

  it("errors when the source file does not exist and no draft exists", async () => {
    const result = await officecliTool.execute(
      { action: "export", filePath: "/tmp/test-export-missing.docx", targetPath: pdfTarget },
      mockContext
    )
    expect(result.output).toContain("error: file not found")
  })
})
