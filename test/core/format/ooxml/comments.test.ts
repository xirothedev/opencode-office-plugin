import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeComment, readComments } from "@/core/format/ooxml/comments"
import { Document, Packer, Paragraph, TextRun } from "docx"
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs"
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
})
