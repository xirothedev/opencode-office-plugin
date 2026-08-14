import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir } from "@/core/storage/paths"
import { copyFile, rm, mkdir, readFile } from "fs/promises"
import { join } from "path"
import JSZip from "jszip"
import { extractTextFromPDF } from "@/core/format/backends/pdf"

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  const { PDFDocument } = await import("pdf-lib")
  const fs = await import("node:fs")
  return {
    exec: vi.fn((cmd: string, cb: (...args: unknown[]) => void) => {
      const outMatch = cmd.match(/-o "([^"]+)"/)
      if (outMatch && outMatch[1].toLowerCase().endsWith(".pdf")) {
        void (async () => {
          const doc = await PDFDocument.create()
          doc.addPage([300, 300])
          fs.writeFileSync(outMatch[1], await doc.save())
          cb(null, { stdout: "" })
        })()
      } else {
        actual.exec(cmd, (err: Error | null, stdout: string, stderr: string) => cb(err, stdout, stderr))
      }
    }),
  }
})

describe("officecli watermark", () => {
  const docxFile = "/tmp/test-watermark.docx"
  const pdfFile = "/tmp/test-watermark.pdf"
  const docxFixture = join(process.cwd(), "test/fixtures/sample.docx")
  const pdfFixture = join(process.cwd(), "test/fixtures/sample.pdf")
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
    await copyFile(docxFixture, docxFile)
    await copyFile(pdfFixture, pdfFile)
    await mkdir(getDraftsDir(), { recursive: true })
    await mkdir(getHistoryDir(), { recursive: true })
    await mkdir(getLocksDir(), { recursive: true })
  })

  afterEach(async () => {
    await rm(docxFile, { force: true })
    await rm(pdfFile, { force: true })
    await rm(getDraftsDir(), { recursive: true, force: true })
    await rm(getHistoryDir(), { recursive: true, force: true })
    await rm(getLocksDir(), { recursive: true, force: true })
  })

  async function withDraft(filePath: string, content: string) {
    await officecliTool.execute({ action: "create", filePath, content }, mockContext)
  }

  it("watermark text renders into the accepted pdf", async () => {
    await withDraft(pdfFile, "# PDF draft\n\nBody")
    const setResult = await officecliTool.execute(
      { action: "watermark", filePath: pdfFile, text: "DRAFT", position: "diagonal-center" },
      mockContext
    )
    expect(setResult.output).toContain("Watermark set")
    await officecliTool.execute({ action: "accept", filePath: pdfFile }, mockContext)
    const pdfText = await extractTextFromPDF(pdfFile)
    expect(pdfText).toContain("DRAFT")
  })

  it("empty text removes the watermark from the accepted pdf", async () => {
    await withDraft(pdfFile, "# PDF draft\n\nBody")
    await officecliTool.execute({ action: "watermark", filePath: pdfFile, text: "DRAFT" }, mockContext)
    const removeResult = await officecliTool.execute({ action: "watermark", filePath: pdfFile, text: "" }, mockContext)
    expect(removeResult.output).toContain("Watermark removed")
    await officecliTool.execute({ action: "accept", filePath: pdfFile }, mockContext)
    const pdfText = await extractTextFromPDF(pdfFile)
    expect(pdfText).not.toContain("DRAFT")
  })

  it("watermark injects a header into the accepted docx", async () => {
    await withDraft(docxFile, "# Doc\n\nBody")
    await officecliTool.execute(
      { action: "watermark", filePath: docxFile, text: "CONFIDENTIAL", position: "top-center" },
      mockContext
    )
    await officecliTool.execute({ action: "accept", filePath: docxFile }, mockContext)
    const zip = await JSZip.loadAsync(await readFile(docxFile))
    const headerXml = await zip.file("word/header1.xml")?.async("string")
    expect(headerXml).toContain("CONFIDENTIAL")
    const documentXml = await zip.file("word/document.xml")?.async("string")
    expect(documentXml).toContain("headerReference")
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string")
    expect(contentTypes).toContain("wordprocessingml.header+xml")
  })

  it("watermark on docx defaults to top-center without a position", async () => {
    await withDraft(docxFile, "# Doc\n\nBody")
    await officecliTool.execute({ action: "watermark", filePath: docxFile, text: "CONFIDENTIAL" }, mockContext)
    const acceptResult = await officecliTool.execute({ action: "accept", filePath: docxFile }, mockContext)
    expect(acceptResult.output).toContain("Accepted")
    const zip = await JSZip.loadAsync(await readFile(docxFile))
    const headerXml = await zip.file("word/header1.xml")?.async("string")
    expect(headerXml).toContain("CONFIDENTIAL")
  })

  it("errors on diagonal-center for docx", async () => {
    await withDraft(docxFile, "# Doc\n\nBody")
    const result = await officecliTool.execute(
      { action: "watermark", filePath: docxFile, text: "DRAFT", position: "diagonal-center" },
      mockContext
    )
    expect(result.output).toContain("error: diagonal-center watermark not supported for DOCX")
  })

  it("errors on opacity for docx", async () => {
    await withDraft(docxFile, "# Doc\n\nBody")
    const result = await officecliTool.execute(
      { action: "watermark", filePath: docxFile, text: "DRAFT", opacity: 0.5 },
      mockContext
    )
    expect(result.output).toContain("error: opacity not supported for DOCX watermarks")
  })

  it("errors on unsupported formats (xlsx)", async () => {
    await copyFile(docxFixture, "/tmp/test-watermark.xlsx")
    const result = await officecliTool.execute(
      { action: "watermark", filePath: "/tmp/test-watermark.xlsx", text: "DRAFT" },
      mockContext
    )
    expect(result.output).toContain("error: watermark only supported for DOCX and PDF")
  })

  it("errors when writing a watermark without a draft", async () => {
    const result = await officecliTool.execute(
      { action: "watermark", filePath: docxFile, text: "DRAFT" },
      mockContext
    )
    expect(result.output).toContain("error: no active draft")
  })

  it("errors on invalid position", async () => {
    await withDraft(pdfFile, "# PDF draft\n\nBody")
    const result = await officecliTool.execute(
      { action: "watermark", filePath: pdfFile, text: "DRAFT", position: "left-middle" },
      mockContext
    )
    expect(result.output).toContain("error: invalid position")
  })
})
