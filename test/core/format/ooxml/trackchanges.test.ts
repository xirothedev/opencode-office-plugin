import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeTrackChange, readTrackChanges } from "../../../../src/core/format/ooxml/trackchanges"
import { Document, Packer, Paragraph, TextRun } from "docx"
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("OOXML Track Changes Writer", () => {
  let testDir: string
  let testDocPath: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `ooxml-tc-test-${Date.now()}`)
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

  it("writes insertion track change to DOCX", async () => {
    const trackChange = {
      id: "tc-1",
      type: "insertion" as const,
      author: "AI Agent",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      text: " inserted text",
      paragraph: 0,
      offset: 12,
    }

    await writeTrackChange(testDocPath, trackChange)

    const changes = await readTrackChanges(testDocPath)
    expect(changes).toHaveLength(1)
    expect(changes[0].id).toBe("tc-1")
    expect(changes[0].type).toBe("insertion")
    expect(changes[0].author).toBe("AI Agent")
    expect(changes[0].text).toBe(" inserted text")
  })

  it("writes deletion track change to DOCX", async () => {
    const trackChange = {
      id: "tc-2",
      type: "deletion" as const,
      author: "Reviewer",
      timestamp: new Date("2026-08-12T11:00:00Z"),
      text: "test document",
      paragraph: 0,
      offset: 27,
    }

    await writeTrackChange(testDocPath, trackChange)

    const changes = await readTrackChanges(testDocPath)
    expect(changes).toHaveLength(1)
    expect(changes[0].id).toBe("tc-2")
    expect(changes[0].type).toBe("deletion")
    expect(changes[0].author).toBe("Reviewer")
    expect(changes[0].text).toBe("test document")
  })
})
