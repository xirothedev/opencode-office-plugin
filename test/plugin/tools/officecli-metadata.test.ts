import { describe, it, expect, beforeEach, mock } from "bun:test"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { copyFile, readFile } from "node:fs/promises"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import JSZip from "jszip"
import { PDFDocument } from "pdf-lib"
import { spawnSync } from "bun"

// ponytail: bun:test has no importOriginal — non-PDF commands fall through to the
// real shell via spawnSync. Mock the owned seam, never node:child_process
// (sharp imports spawnSync from it). Factory stays sync: dynamic imports
// inside the factory can deadlock module evaluation (seen with pdf-lib).
mock.module("@/core/format/exec", () => {
  const decoder = new TextDecoder()
  return {
    runCommand: mock(async (cmd: string) => {
      const outMatch = cmd.match(/-o "([^"]+)"/)
      if (outMatch && outMatch[1].toLowerCase().endsWith(".pdf")) {
        const doc = await PDFDocument.create()
        doc.addPage([200, 200])
        writeFileSync(outMatch[1], await doc.save())
        return
      }
      const proc = spawnSync({ cmd: ["sh", "-c", cmd], stdout: "pipe", stderr: "pipe" })
      if (proc.exitCode !== 0) {
        const stderr = decoder.decode(proc.stderr).trim()
        throw new Error(stderr || `command failed: ${cmd}`)
      }
    }),
  }
})

describe("officecli metadata", () => {
  const docxFile = "/tmp/test-metadata.docx"
  const pdfFile = "/tmp/test-metadata.pdf"
  const docxFixture = join(process.cwd(), "test/fixtures/sample.docx")
  const pdfFixture = join(process.cwd(), "test/fixtures/sample.pdf")
  setupHermeticDirs()
  cleanupTestFile(docxFile)
  cleanupTestFile(pdfFile)

  beforeEach(async () => {
    await copyFile(docxFixture, docxFile)
    await copyFile(pdfFixture, pdfFile)
  })

  async function setMetadata(filePath: string, properties: string) {
    return await runTool(officecliTool, { action: "metadata", filePath, properties })
  }

  it("metadata read returns JSON for a real docx", async () => {
    const result = await runTool(officecliTool, { action: "metadata", filePath: docxFile })
    const parsed = JSON.parse(result)
    expect(typeof parsed).toBe("object")
  })

  it("metadata set writes pending values visible to read before accept", async () => {
    await runTool(officecliTool, { action: "create", filePath: docxFile, content: "# Doc\n\nBody" })
    const result = await setMetadata(docxFile, JSON.stringify({ title: "Quarterly Report", author: "Ada Lovelace" }))
    expect(result).toContain("Metadata set")
    const read = await runTool(officecliTool, { action: "metadata", filePath: docxFile })
    const parsed = JSON.parse(read)
    expect(parsed.title).toBe("Quarterly Report")
    expect(parsed.author).toBe("Ada Lovelace")
  })

  it("metadata persists into the accepted docx core properties", async () => {
    await runTool(officecliTool, { action: "create", filePath: docxFile, content: "# Doc\n\nBody" })
    await setMetadata(docxFile, JSON.stringify({ title: "Quarterly Report", author: "Ada Lovelace" }))
    const acceptResult = await runTool(officecliTool, { action: "accept", filePath: docxFile })
    expect(acceptResult).toContain("Accepted")
    const zip = await JSZip.loadAsync(await readFile(docxFile))
    const coreXml = await zip.file("docProps/core.xml")?.async("string")
    expect(coreXml).toContain("<dc:title>Quarterly Report</dc:title>")
    expect(coreXml).toContain("<dc:creator>Ada Lovelace</dc:creator>")
  })

  it("custom fields are stored in the accepted docx custom.xml", async () => {
    await runTool(officecliTool, { action: "create", filePath: docxFile, content: "# Doc\n\nBody" })
    await setMetadata(docxFile, JSON.stringify({ custom: { Project: "Alpha", Budget: "12000" } }))
    await runTool(officecliTool, { action: "accept", filePath: docxFile })
    const zip = await JSZip.loadAsync(await readFile(docxFile))
    const customXml = await zip.file("docProps/custom.xml")?.async("string")
    expect(customXml).toContain('name="Project"')
    expect(customXml).toContain("<vt:lpwstr>Alpha</vt:lpwstr>")
    expect(customXml).toContain('name="Budget"')
  })

  it("metadata read returns the PDF info dict", async () => {
    const result = await runTool(officecliTool, { action: "metadata", filePath: pdfFile })
    const parsed = JSON.parse(result)
    expect(typeof parsed).toBe("object")
  })

  it("metadata write applies to the accepted pdf", async () => {
    await runTool(officecliTool, { action: "create", filePath: pdfFile, content: "# PDF draft\n\nBody" })
    await setMetadata(pdfFile, JSON.stringify({ title: "PDF Title", author: "Grace Hopper" }))
    const acceptResult = await runTool(officecliTool, { action: "accept", filePath: pdfFile })
    expect(acceptResult).toContain("Accepted")
    const read = await runTool(officecliTool, { action: "metadata", filePath: pdfFile })
    const parsed = JSON.parse(read)
    expect(parsed.title).toBe("PDF Title")
    expect(parsed.author).toBe("Grace Hopper")
  })

  it("revert restores the pending metadata of the accepted state", async () => {
    await runTool(officecliTool, { action: "create", filePath: docxFile, content: "# Doc\n\nBody" })
    await setMetadata(docxFile, JSON.stringify({ title: "Quarterly Report" }))
    await runTool(officecliTool, { action: "accept", filePath: docxFile })
    const history = await runTool(officecliTool, { action: "history", filePath: docxFile })
    const timestamps = JSON.parse(history.slice(history.indexOf("[")))
    const timestamp = timestamps[0].timestamp

    await runTool(officecliTool, { action: "revert", filePath: docxFile, timestamp })
    const read = await runTool(officecliTool, { action: "metadata", filePath: docxFile })
    expect(JSON.parse(read).title).toBe("Quarterly Report")
  })

  it("errors on non-string property values", async () => {
    await runTool(officecliTool, { action: "create", filePath: docxFile, content: "# Doc\n\nBody" })
    await expect(setMetadata(docxFile, JSON.stringify({ title: 42 }))).rejects.toThrow(
      /property "title" must be a string/
    )
  })

  it("errors on text files", async () => {
    await expect(
      runTool(officecliTool, { action: "metadata", filePath: "/tmp/test-metadata.txt" })
    ).rejects.toThrow(/metadata only supported for DOCX, XLSX, PPTX and PDF files/)
  })

  it("errors when writing metadata without a draft", async () => {
    await expect(setMetadata(docxFile, JSON.stringify({ title: "X" }))).rejects.toThrow(/no active draft/)
  })
})
