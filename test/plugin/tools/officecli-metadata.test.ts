import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir } from "@/core/storage/paths"
import { copyFile, rm, mkdir, readFile } from "fs/promises"
import { join } from "path"
import JSZip from "jszip"

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
          doc.addPage([200, 200])
          fs.writeFileSync(outMatch[1], await doc.save())
          cb(null, { stdout: "" })
        })()
      } else {
        actual.exec(cmd, (err: Error | null, stdout: string, stderr: string) => cb(err, stdout, stderr))
      }
    }),
  }
})

describe("officecli metadata", () => {
  const docxFile = "/tmp/test-metadata.docx"
  const pdfFile = "/tmp/test-metadata.pdf"
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

  async function setMetadata(filePath: string, properties: string) {
    return await officecliTool.execute(
      { action: "metadata", filePath, properties },
      mockContext
    )
  }

  it("metadata read returns JSON for a real docx", async () => {
    const result = await officecliTool.execute({ action: "metadata", filePath: docxFile }, mockContext)
    const parsed = JSON.parse(result.output)
    expect(typeof parsed).toBe("object")
  })

  it("metadata set writes pending values visible to read before accept", async () => {
    await officecliTool.execute(
      { action: "create", filePath: docxFile, content: "# Doc\n\nBody" },
      mockContext
    )
    const result = await setMetadata(docxFile, JSON.stringify({ title: "Quarterly Report", author: "Ada Lovelace" }))
    expect(result.output).toContain("Metadata set")
    const read = await officecliTool.execute({ action: "metadata", filePath: docxFile }, mockContext)
    const parsed = JSON.parse(read.output)
    expect(parsed.title).toBe("Quarterly Report")
    expect(parsed.author).toBe("Ada Lovelace")
  })

  it("metadata persists into the accepted docx core properties", async () => {
    await officecliTool.execute(
      { action: "create", filePath: docxFile, content: "# Doc\n\nBody" },
      mockContext
    )
    await setMetadata(docxFile, JSON.stringify({ title: "Quarterly Report", author: "Ada Lovelace" }))
    const acceptResult = await officecliTool.execute({ action: "accept", filePath: docxFile }, mockContext)
    expect(acceptResult.output).toContain("Accepted")
    const zip = await JSZip.loadAsync(await readFile(docxFile))
    const coreXml = await zip.file("docProps/core.xml")?.async("string")
    expect(coreXml).toContain("<dc:title>Quarterly Report</dc:title>")
    expect(coreXml).toContain("<dc:creator>Ada Lovelace</dc:creator>")
  })

  it("custom fields are stored in the accepted docx custom.xml", async () => {
    await officecliTool.execute(
      { action: "create", filePath: docxFile, content: "# Doc\n\nBody" },
      mockContext
    )
    await setMetadata(docxFile, JSON.stringify({ custom: { Project: "Alpha", Budget: "12000" } }))
    await officecliTool.execute({ action: "accept", filePath: docxFile }, mockContext)
    const zip = await JSZip.loadAsync(await readFile(docxFile))
    const customXml = await zip.file("docProps/custom.xml")?.async("string")
    expect(customXml).toContain('name="Project"')
    expect(customXml).toContain("<vt:lpwstr>Alpha</vt:lpwstr>")
    expect(customXml).toContain('name="Budget"')
  })

  it("metadata read returns the PDF info dict", async () => {
    const result = await officecliTool.execute({ action: "metadata", filePath: pdfFile }, mockContext)
    const parsed = JSON.parse(result.output)
    expect(typeof parsed).toBe("object")
  })

  it("metadata write applies to the accepted pdf", async () => {
    await officecliTool.execute(
      { action: "create", filePath: pdfFile, content: "# PDF draft\n\nBody" },
      mockContext
    )
    await setMetadata(pdfFile, JSON.stringify({ title: "PDF Title", author: "Grace Hopper" }))
    const acceptResult = await officecliTool.execute({ action: "accept", filePath: pdfFile }, mockContext)
    expect(acceptResult.output).toContain("Accepted")
    const read = await officecliTool.execute({ action: "metadata", filePath: pdfFile }, mockContext)
    const parsed = JSON.parse(read.output)
    expect(parsed.title).toBe("PDF Title")
    expect(parsed.author).toBe("Grace Hopper")
  })

  it("revert restores the pending metadata of the accepted state", async () => {
    await officecliTool.execute(
      { action: "create", filePath: docxFile, content: "# Doc\n\nBody" },
      mockContext
    )
    await setMetadata(docxFile, JSON.stringify({ title: "Quarterly Report" }))
    await officecliTool.execute({ action: "accept", filePath: docxFile }, mockContext)
    const history = await officecliTool.execute({ action: "history", filePath: docxFile }, mockContext)
    const timestamps = JSON.parse(history.output.slice(history.output.indexOf("[")))
    const timestamp = timestamps[0].timestamp

    await officecliTool.execute({ action: "revert", filePath: docxFile, timestamp }, mockContext)
    const read = await officecliTool.execute({ action: "metadata", filePath: docxFile }, mockContext)
    expect(JSON.parse(read.output).title).toBe("Quarterly Report")
  })

  it("errors on non-string property values", async () => {
    await officecliTool.execute(
      { action: "create", filePath: docxFile, content: "# Doc\n\nBody" },
      mockContext
    )
    const result = await setMetadata(docxFile, JSON.stringify({ title: 42 }))
    expect(result.output).toContain('error: property "title" must be a string')
  })

  it("errors on text files", async () => {
    const result = await officecliTool.execute({ action: "metadata", filePath: "/tmp/test-metadata.txt" }, mockContext)
    expect(result.output).toContain("error:")
  })

  it("errors when writing metadata without a draft", async () => {
    const result = await setMetadata(docxFile, JSON.stringify({ title: "X" }))
    expect(result.output).toContain("error: no active draft")
  })
})
