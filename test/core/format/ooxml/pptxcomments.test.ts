import { describe, it, expect, beforeEach, afterEach } from "vitest"
import JSZip from "jszip"
import { writeComment, readComments } from "@/core/format/ooxml/pptxcomments"
import { copyFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const FIXTURE = join(process.cwd(), "test/fixtures/sample.pptx")

describe("OOXML PPTX Comment Writer", () => {
  let testDir: string
  let testPptxPath: string

  beforeEach(() => {
    testDir = join(tmpdir(), `ooxml-pptx-test-${Date.now()}`)
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }
    testPptxPath = join(testDir, "test.pptx")
    copyFileSync(FIXTURE, testPptxPath)
  })

  afterEach(() => {
    if (existsSync(testPptxPath)) {
      unlinkSync(testPptxPath)
    }
  })

  it("writes single comment to PPTX", async () => {
    const comment = {
      id: "comment-1",
      author: "AI Agent",
      text: "Add diagram to clarify",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      slide: 0,
      x: 100000,
      y: 200000,
      parentId: null,
      resolved: false,
    }

    await writeComment(testPptxPath, comment)

    const comments = await readComments(testPptxPath)
    expect(comments).toHaveLength(1)
    expect(comments[0].id).toBe("slide-0-cm-1")
    expect(comments[0].author).toBe("AI Agent")
    expect(comments[0].text).toBe("Add diagram to clarify")
    expect(comments[0].slide).toBe(0)
    expect(comments[0].x).toBe(100000)
    expect(comments[0].y).toBe(200000)
    expect(comments[0].resolved).toBe(false)
  })

  it("supports multiple comments from different authors", async () => {
    await writeComment(testPptxPath, {
      id: "c1",
      author: "AI Agent",
      text: "First comment",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      slide: 0,
      x: 100000,
      y: 100000,
      parentId: null,
      resolved: false,
    })
    await writeComment(testPptxPath, {
      id: "c2",
      author: "Reviewer",
      text: "Second comment",
      timestamp: new Date("2026-08-12T11:00:00Z"),
      slide: 0,
      x: 200000,
      y: 200000,
      parentId: null,
      resolved: false,
    })

    const comments = await readComments(testPptxPath)
    expect(comments).toHaveLength(2)
    expect(comments[0].author).toBe("AI Agent")
    expect(comments[1].author).toBe("Reviewer")
    expect(comments[0].text).toBe("First comment")
    expect(comments[1].text).toBe("Second comment")
  })

  it("returns empty list when presentation has no comments", async () => {
    const comments = await readComments(testPptxPath)
    expect(comments).toEqual([])
  })

  it("assigns per-author comment indexes", async () => {
    await writeComment(testPptxPath, {
      id: "c1",
      author: "AI Agent",
      text: "First",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      slide: 0,
      x: 100000,
      y: 100000,
      parentId: null,
      resolved: false,
    })
    await writeComment(testPptxPath, {
      id: "c2",
      author: "Reviewer",
      text: "Second",
      timestamp: new Date("2026-08-12T11:00:00Z"),
      slide: 0,
      x: 200000,
      y: 200000,
      parentId: null,
      resolved: false,
    })
    await writeComment(testPptxPath, {
      id: "c3",
      author: "AI Agent",
      text: "Third",
      timestamp: new Date("2026-08-12T11:30:00Z"),
      slide: 0,
      x: 300000,
      y: 300000,
      parentId: null,
      resolved: false,
    })

    const zip = await JSZip.loadAsync(readFileSync(testPptxPath))
    const cmXml = await zip.file("ppt/comments/comment1.xml")!.async("string")
    const indexes = [...cmXml.matchAll(/authorId="(\d+)"[^>]*idx="(\d+)"/g)].map((m) => ({
      authorId: m[1],
      idx: m[2],
    }))
    expect(indexes).toEqual([
      { authorId: "0", idx: "1" },
      { authorId: "1", idx: "1" },
      { authorId: "0", idx: "2" },
    ])
    const authorsXml = await zip.file("ppt/commentAuthors.xml")!.async("string")
    expect(authorsXml).toContain('id="0" name="AI Agent"')
    expect(authorsXml).toContain('lastIdx="2"')
  })
})
