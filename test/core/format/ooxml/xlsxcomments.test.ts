import { describe, it, expect, beforeEach, afterEach } from "vitest"
import JSZip from "jszip"
import { writeComment, readComments, applyCellSuggestion } from "@/core/format/ooxml/xlsxcomments"
import { copyFileSync, unlinkSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const FIXTURE = join(process.cwd(), "test/fixtures/sample.xlsx")

describe("OOXML XLSX Comment Writer", () => {
  let testDir: string
  let testXlsxPath: string

  beforeEach(() => {
    testDir = join(tmpdir(), `ooxml-xlsx-test-${Date.now()}`)
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }
    testXlsxPath = join(testDir, "test.xlsx")
    copyFileSync(FIXTURE, testXlsxPath)
  })

  afterEach(() => {
    if (existsSync(testXlsxPath)) {
      unlinkSync(testXlsxPath)
    }
  })

  it("writes single comment to XLSX", async () => {
    const comment = {
      id: "comment-1",
      author: "AI Agent",
      text: "This needs review",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      cellRef: "B2",
      parentId: null,
      resolved: false,
    }

    await writeComment(testXlsxPath, comment)

    const comments = await readComments(testXlsxPath)
    expect(comments).toHaveLength(1)
    expect(comments[0].id).toBe("B2-0")
    expect(comments[0].author).toBe("AI Agent")
    expect(comments[0].text).toBe("This needs review")
    expect(comments[0].cellRef).toBe("B2")
    expect(comments[0].resolved).toBe(false)
  })

  it("supports multiple comments from different authors", async () => {
    await writeComment(testXlsxPath, {
      id: "c1",
      author: "AI Agent",
      text: "Check amount",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      cellRef: "B2",
      parentId: null,
      resolved: false,
    })
    await writeComment(testXlsxPath, {
      id: "c2",
      author: "Reviewer",
      text: "Confirmed",
      timestamp: new Date("2026-08-12T11:00:00Z"),
      cellRef: "B3",
      parentId: null,
      resolved: false,
    })

    const comments = await readComments(testXlsxPath)
    expect(comments).toHaveLength(2)
    expect(comments[0].author).toBe("AI Agent")
    expect(comments[0].cellRef).toBe("B2")
    expect(comments[1].author).toBe("Reviewer")
    expect(comments[1].cellRef).toBe("B3")
  })

  it("appends to existing comments instead of overwriting", async () => {
    await writeComment(testXlsxPath, {
      id: "c1",
      author: "AI Agent",
      text: "First",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      cellRef: "A1",
      parentId: null,
      resolved: false,
    })
    await writeComment(testXlsxPath, {
      id: "c2",
      author: "AI Agent",
      text: "Second",
      timestamp: new Date("2026-08-12T10:31:00Z"),
      cellRef: "C1",
      parentId: null,
      resolved: false,
    })

    const comments = await readComments(testXlsxPath)
    expect(comments).toHaveLength(2)
    expect(comments.map((c) => c.text)).toEqual(["First", "Second"])
  })

  it("reads comment text from rich text runs (Excel/openpyxl style)", async () => {
    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath))
    const rich = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>AI Agent</author></authors><commentList><comment ref="B2" authorId="0"><text><r><rPr><b/><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t xml:space="preserve">This needs review</t></r></text></comment><comment ref="B3" authorId="0"><text><r><rPr><sz val="10"/></rPr><t xml:space="preserve">First part</t></r><r><t>second part</t></r></text></comment></commentList></comments>`
    zip.file("xl/comments1.xml", rich)
    writeFileSync(testXlsxPath, await zip.generateAsync({ type: "nodebuffer" }))

    const comments = await readComments(testXlsxPath)
    expect(comments).toHaveLength(2)
    expect(comments[0].text).toBe("This needs review")
    expect(comments[1].text).toBe("First partsecond part")
  })

  it("uses unique VML shape ids and z-indexes for multiple comments", async () => {
    const base = {
      author: "AI Agent",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      parentId: null,
      resolved: false,
    }
    await writeComment(testXlsxPath, { ...base, id: "c1", text: "First", cellRef: "A1" })
    await writeComment(testXlsxPath, { ...base, id: "c2", text: "Second", cellRef: "C1" })

    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath))
    const vml = await zip.file("xl/drawings/vmlDrawing1.vml")!.async("string")
    const shapeIds = [...vml.matchAll(/id="_x0000_s(\d+)"/g)].map((m) => m[1])
    const zIndexes = [...vml.matchAll(/z-index:(\d+)/g)].map((m) => m[1])
    expect(new Set(shapeIds).size).toBe(2)
    expect(new Set(zIndexes).size).toBe(2)
  })

  it("does not duplicate sheet relationships across writes", async () => {
    const base = {
      author: "AI Agent",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      parentId: null,
      resolved: false,
    }
    await writeComment(testXlsxPath, { ...base, id: "c1", text: "First", cellRef: "A1" })
    await writeComment(testXlsxPath, { ...base, id: "c2", text: "Second", cellRef: "C1" })

    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath))
    const rels = await zip.file("xl/worksheets/_rels/sheet1.xml.rels")!.async("string")
    const commentRels = (rels.match(/relationships\/comments/g) || []).length
    const vmlRels = (rels.match(/relationships\/vmlDrawing/g) || []).length
    expect(commentRels).toBe(1)
    expect(vmlRels).toBe(1)
  })

  it("writes value suggestion and reads it back", async () => {
    await writeComment(testXlsxPath, {
      id: "s1",
      author: "AI Agent",
      text: "Original note",
      suggestedText: "42",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      cellRef: "B2",
      parentId: null,
      resolved: false,
    })

    const comments = await readComments(testXlsxPath)
    expect(comments).toHaveLength(1)
    expect(comments[0].text).toBe("Suggested value: 42")
    expect(comments[0].suggestedText).toBe("42")
  })

  it("approve writes numeric value into the cell and removes comment and note shape", async () => {
    await writeComment(testXlsxPath, {
      id: "s1",
      author: "AI Agent",
      text: "Original note",
      suggestedText: "42",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      cellRef: "B2",
      parentId: null,
      resolved: false,
    })

    const result = await applyCellSuggestion(testXlsxPath, "B2-0")
    expect(result).toBe("applied")

    expect(await readComments(testXlsxPath)).toHaveLength(0)
    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath))
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string")
    expect(sheet).toMatch(/<c r="B2">\s*<v>42<\/v>\s*<\/c>/)
    const vml = await zip.file("xl/drawings/vmlDrawing1.vml")!.async("string")
    expect(vml).not.toContain("<v:shape")
  })

  it("approve writes string value as inline string into a new cell", async () => {
    await writeComment(testXlsxPath, {
      id: "s2",
      author: "AI Agent",
      text: "Original note",
      suggestedText: "Pending approval",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      cellRef: "D1",
      parentId: null,
      resolved: false,
    })

    const result = await applyCellSuggestion(testXlsxPath, "D1-0")
    expect(result).toBe("applied")

    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath))
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string")
    expect(sheet).toMatch(/<c r="D1" t="inlineStr">\s*<is>\s*<t>Pending approval<\/t>\s*<\/is>\s*<\/c>/)
  })

  it("approve rejects plain comments and unknown ids", async () => {
    await writeComment(testXlsxPath, {
      id: "c1",
      author: "AI Agent",
      text: "Just a note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      cellRef: "B2",
      parentId: null,
      resolved: false,
    })

    expect(await applyCellSuggestion(testXlsxPath, "B2-0")).toBe("no-suggestion")
    expect(await applyCellSuggestion(testXlsxPath, "Z9-9")).toBe("not-found")
  })
})
