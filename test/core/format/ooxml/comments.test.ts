import { describe, it, expect, beforeEach, afterEach } from "vitest"
import JSZip from "jszip"
import { writeComment, readComments, applyCommentSuggestion } from "../../../../src/core/format/ooxml/comments.ts"
import { Document, Packer, Paragraph, TextRun } from "docx"
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("OOXML Comment Writer", () => {
  let testDir: string
  let testDocPath: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `ooxml-test-${Date.now()}`)
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }
    testDocPath = join(testDir, "test.docx")

    // Create test DOCX with initial content
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [new TextRun("Hello world. This is a test document.")],
            }),
          ],
        },
      ],
    })
    const buffer = await Packer.toBuffer(doc)
    writeFileSync(testDocPath, buffer)
  })

  afterEach(() => {
    if (existsSync(testDocPath)) {
      unlinkSync(testDocPath)
    }
  })

  it("writes single comment to DOCX", async () => {
    const comment = {
      id: "comment-1",
      author: "AI Agent",
      text: "This needs review",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      rangeStart: { paragraph: 0, offset: 6 },
      rangeEnd: { paragraph: 0, offset: 11 },
      parentId: null,
      resolved: false,
    }

    await writeComment(testDocPath, comment)

    const comments = await readComments(testDocPath)
    expect(comments).toHaveLength(1)
    expect(comments[0].id).toBe("comment-1")
    expect(comments[0].author).toBe("AI Agent")
    expect(comments[0].text).toBe("This needs review")
    expect(comments[0].resolved).toBe(false)
  })

  it("writes suggestion comment and reads it back", async () => {
    const comment = {
      id: "comment-s1",
      author: "AI Agent",
      text: "Original note",
      suggestedText: "Revised clause text",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      rangeStart: { paragraph: 0, offset: 0 },
      rangeEnd: { paragraph: 0, offset: 5 },
      parentId: null,
      resolved: false,
    }

    await writeComment(testDocPath, comment)

    const comments = await readComments(testDocPath)
    expect(comments).toHaveLength(1)
    expect(comments[0].text).toBe("Suggested text: Revised clause text")
    expect(comments[0].suggestedText).toBe("Revised clause text")
  })

  it("approve applies suggestion text to the paragraph and removes the comment", async () => {
    await writeComment(testDocPath, {
      id: "comment-s1",
      author: "AI Agent",
      text: "Original note",
      suggestedText: "Approved wording",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      rangeStart: { paragraph: 0, offset: 0 },
      rangeEnd: { paragraph: 0, offset: 5 },
      parentId: null,
      resolved: false,
    })

    const result = await applyCommentSuggestion(testDocPath, "comment-s1")
    expect(result).toBe("applied")

    const comments = await readComments(testDocPath)
    expect(comments).toHaveLength(0)
    const zip = await JSZip.loadAsync(readFileSync(testDocPath))
    const docXml = await zip.file("word/document.xml")!.async("string")
    expect(docXml).toContain("Approved wording")
    expect(docXml).not.toContain("commentRangeStart")
  })

  it("approve rejects comments without a suggestion", async () => {
    await writeComment(testDocPath, {
      id: "comment-1",
      author: "AI Agent",
      text: "This needs review",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      rangeStart: { paragraph: 0, offset: 6 },
      rangeEnd: { paragraph: 0, offset: 11 },
      parentId: null,
      resolved: false,
    })

    const result = await applyCommentSuggestion(testDocPath, "comment-1")
    expect(result).toBe("no-suggestion")
  })

  it("approve returns not-found for unknown comment id", async () => {
    const result = await applyCommentSuggestion(testDocPath, "missing-1")
    expect(result).toBe("not-found")
  })
})
