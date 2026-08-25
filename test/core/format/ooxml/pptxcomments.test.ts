import { describe, it, expect, beforeEach, afterEach } from "vitest"
import JSZip from "jszip"
import { writeComment, readComments, applySlideSuggestion } from "@/core/format/ooxml/pptxcomments"
import { copyFileSync, unlinkSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs"
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
      status: "open",
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
    expect(comments[0].status).toBe("open")
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
      status: "open",
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
      status: "open",
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
      status: "open",
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
      status: "open",
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
      status: "open",
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

  it("writes text suggestion and reads it back", async () => {
    await writeComment(testPptxPath, {
      id: "s1",
      author: "AI Agent",
      text: "Original note",
      suggestedText: "Revised slide heading",
      targetText: "Hello from slide 1",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      slide: 0,
      x: 100000,
      y: 100000,
      parentId: null,
      status: "open",
    })

    const comments = await readComments(testPptxPath)
    expect(comments).toHaveLength(1)
    expect(comments[0].text).toBe("Suggested text: Revised slide heading\nTarget text: Hello from slide 1")
    expect(comments[0].suggestedText).toBe("Revised slide heading")
    expect(comments[0].targetText).toBe("Hello from slide 1")
  })

  it("approve replaces first text box and removes the comment", async () => {
    await writeComment(testPptxPath, {
      id: "s1",
      author: "AI Agent",
      text: "Original note",
      suggestedText: "Approved slide text",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      slide: 0,
      x: 100000,
      y: 100000,
      parentId: null,
      status: "open",
    })

    const result = await applySlideSuggestion(testPptxPath, "slide-0-cm-1")
    expect(result).toBe("applied")

    expect(await readComments(testPptxPath)).toHaveLength(0)
    const zip = await JSZip.loadAsync(readFileSync(testPptxPath))
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string")
    expect(slide).toContain("Approved slide text")
    expect(slide).not.toContain("Hello from slide 1")
  })

  it("approve rejects plain comments and unknown ids", async () => {
    await writeComment(testPptxPath, {
      id: "c1",
      author: "AI Agent",
      text: "Just a note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      slide: 0,
      x: 100000,
      y: 100000,
      parentId: null,
      status: "open",
    })

    expect(await applySlideSuggestion(testPptxPath, "slide-0-cm-1")).toBe("no-suggestion")
    expect(await applySlideSuggestion(testPptxPath, "slide-5-cm-9")).toBe("not-found")
  })

  it("approve targets the text box matching targetText", async () => {
    const zip = await JSZip.loadAsync(readFileSync(testPptxPath))
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string")
    const extraShape =
      '<p:sp><p:nvSpPr><p:cNvPr id="99" name="Sidebar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Sidebar note</a:t></a:r></a:p></p:txBody></p:sp>'
    zip.file("ppt/slides/slide1.xml", slideXml.replace("</p:spTree>", `${extraShape}</p:spTree>`))
    writeFileSync(testPptxPath, await zip.generateAsync({ type: "nodebuffer" }))

    await writeComment(testPptxPath, {
      id: "s1",
      author: "AI Agent",
      text: "Original note",
      suggestedText: "Revised sidebar",
      targetText: "sidebar note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      slide: 0,
      x: 100000,
      y: 100000,
      parentId: null,
      status: "open",
    })

    const result = await applySlideSuggestion(testPptxPath, "slide-0-cm-1")
    expect(result).toBe("applied")

    expect(await readComments(testPptxPath)).toHaveLength(0)
    const updated = await JSZip.loadAsync(readFileSync(testPptxPath))
    const slide = await updated.file("ppt/slides/slide1.xml")!.async("string")
    expect(slide).toContain("Revised sidebar")
    expect(slide).toContain("Hello from slide 1")
  })

  it("approve fails with candidates when targetText matches no box", async () => {
    await writeComment(testPptxPath, {
      id: "s1",
      author: "AI Agent",
      text: "Original note",
      suggestedText: "Revised text",
      targetText: "text that exists nowhere",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      slide: 0,
      x: 100000,
      y: 100000,
      parentId: null,
      status: "open",
    })

    await expect(applySlideSuggestion(testPptxPath, "slide-0-cm-1")).rejects.toThrow(
      /No text box on slide matches target.*Text boxes:/s
    )
  })

  it("round-trips comment status", async () => {
    await writeComment(testPptxPath, {
      id: "cm-1",
      author: "AI Agent",
      text: "Needs a diagram",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      slide: 0,
      x: 100000,
      y: 200000,
      parentId: null,
      status: "denied",
    })
    const comments = await readComments(testPptxPath)
    expect(comments).toHaveLength(1)
    expect(comments[0].id).toBe("slide-0-cm-1")
    expect(comments[0].status).toBe("denied")
    const zip = await JSZip.loadAsync(readFileSync(testPptxPath))
    const xml = await zip.file("ppt/comments/comment1.xml")!.async("string")
    expect(xml).toContain('oo:status="denied"')
    expect(xml).toContain('xmlns:oo="http://opencode.ai/openoffice-plugin"')
  })
})
