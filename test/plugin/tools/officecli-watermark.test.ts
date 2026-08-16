import { describe, it, expect, beforeEach, vi } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { copyFile, readFile } from "fs/promises"
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
  setupHermeticDirs()
  cleanupTestFile(docxFile)
  cleanupTestFile(pdfFile)
  cleanupTestFile("/tmp/test-watermark.xlsx")

  beforeEach(async () => {
    await copyFile(docxFixture, docxFile)
    await copyFile(pdfFixture, pdfFile)
  })

  async function withDraft(filePath: string, content: string) {
    await runTool(officecliTool, { action: "create", filePath, content })
  }

  it("watermark text renders into the accepted pdf", async () => {
    await withDraft(pdfFile, "# PDF draft\n\nBody")
    const setResult = await runTool(officecliTool, {
      action: "watermark",
      filePath: pdfFile,
      text: "DRAFT",
      position: "diagonal-center",
    })
    expect(setResult).toContain("Watermark set")
    await runTool(officecliTool, { action: "accept", filePath: pdfFile })
    const pdfText = await extractTextFromPDF(pdfFile)
    expect(pdfText).toContain("DRAFT")
  })

  it("empty text removes the watermark from the accepted pdf", async () => {
    await withDraft(pdfFile, "# PDF draft\n\nBody")
    await runTool(officecliTool, { action: "watermark", filePath: pdfFile, text: "DRAFT" })
    const removeResult = await runTool(officecliTool, { action: "watermark", filePath: pdfFile, text: "" })
    expect(removeResult).toContain("Watermark removed")
    await runTool(officecliTool, { action: "accept", filePath: pdfFile })
    const pdfText = await extractTextFromPDF(pdfFile)
    expect(pdfText).not.toContain("DRAFT")
  })

  it("watermark injects a header into the accepted docx", async () => {
    await withDraft(docxFile, "# Doc\n\nBody")
    await runTool(officecliTool, {
      action: "watermark",
      filePath: docxFile,
      text: "CONFIDENTIAL",
      position: "top-center",
    })
    await runTool(officecliTool, { action: "accept", filePath: docxFile })
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
    await runTool(officecliTool, { action: "watermark", filePath: docxFile, text: "CONFIDENTIAL" })
    const acceptResult = await runTool(officecliTool, { action: "accept", filePath: docxFile })
    expect(acceptResult).toContain("Accepted")
    const zip = await JSZip.loadAsync(await readFile(docxFile))
    const headerXml = await zip.file("word/header1.xml")?.async("string")
    expect(headerXml).toContain("CONFIDENTIAL")
  })

  it("errors on diagonal-center for docx", async () => {
    await withDraft(docxFile, "# Doc\n\nBody")
    await expect(
      runTool(officecliTool, {
        action: "watermark",
        filePath: docxFile,
        text: "DRAFT",
        position: "diagonal-center",
      })
    ).rejects.toThrow(/diagonal-center watermark not supported for DOCX/)
  })

  it("errors on opacity for docx", async () => {
    await withDraft(docxFile, "# Doc\n\nBody")
    await expect(
      runTool(officecliTool, { action: "watermark", filePath: docxFile, text: "DRAFT", opacity: 0.5 })
    ).rejects.toThrow(/opacity not supported for DOCX watermarks/)
  })

  it("errors on unsupported formats (xlsx)", async () => {
    await copyFile(docxFixture, "/tmp/test-watermark.xlsx")
    await expect(
      runTool(officecliTool, { action: "watermark", filePath: "/tmp/test-watermark.xlsx", text: "DRAFT" })
    ).rejects.toThrow(/watermark only supported for DOCX and PDF/)
  })

  it("errors when writing a watermark without a draft", async () => {
    await expect(
      runTool(officecliTool, { action: "watermark", filePath: docxFile, text: "DRAFT" })
    ).rejects.toThrow(/no active draft/)
  })

  it("errors on invalid position", async () => {
    await withDraft(pdfFile, "# PDF draft\n\nBody")
    await expect(
      runTool(officecliTool, {
        action: "watermark",
        filePath: pdfFile,
        text: "DRAFT",
        position: "left-middle",
      })
    ).rejects.toThrow(/invalid position/)
  })
})
