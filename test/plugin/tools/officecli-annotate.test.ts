import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir } from "@/core/storage/paths"
import { copyFile, rm, mkdir, readFile } from "fs/promises"
import { join } from "path"
import sharp from "sharp"

describe("officecli annotate", () => {
  const testFile = "/tmp/test-annotate.png"
  const baseImage = "/tmp/test-annotate-base.png"
  const docxFixture = join(process.cwd(), "test/fixtures/sample.docx")
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

  async function makeBaseImage(path: string) {
    await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .png()
      .toFile(path)
  }

  beforeEach(async () => {
    await makeBaseImage(baseImage)
    await copyFile(baseImage, testFile)
    await mkdir(getDraftsDir(), { recursive: true })
    await mkdir(getHistoryDir(), { recursive: true })
    await mkdir(getLocksDir(), { recursive: true })
  })

  afterEach(async () => {
    await rm(testFile, { force: true })
    await rm(baseImage, { force: true })
    await rm(getDraftsDir(), { recursive: true, force: true })
    await rm(getHistoryDir(), { recursive: true, force: true })
    await rm(getLocksDir(), { recursive: true, force: true })
  })

  it("annotate renders a stamp onto the accepted image", async () => {
    const before = await readFile(testFile)
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Image draft\n\nOCR text" },
      mockContext
    )
    const result = await officecliTool.execute(
      {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "stamp", text: "APPROVED", position: { x: 0.5, y: 0.5 } }]),
      },
      mockContext
    )
    expect(result.output).toContain("Annotations added")
    const acceptResult = await officecliTool.execute({ action: "accept", filePath: testFile }, mockContext)
    expect(acceptResult.output).toContain("Accepted")
    const after = await readFile(testFile)
    expect(after.equals(before)).toBe(false)
    const meta = await sharp(testFile).metadata()
    expect(meta.format).toBe("png")
  })

  it("annotations accumulate until accept", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Image draft" },
      mockContext
    )
    await officecliTool.execute(
      {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "note", text: "Check this", position: { x: 0.1, y: 0.1 } }]),
      },
      mockContext
    )
    await officecliTool.execute(
      {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "stamp", text: "DRAFT", position: { x: 0.5, y: 0.5 } }]),
      },
      mockContext
    )
    await officecliTool.execute({ action: "accept", filePath: testFile }, mockContext)
    const both = await readFile(testFile)

    await copyFile(baseImage, testFile)
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Image draft" },
      mockContext
    )
    await officecliTool.execute(
      {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "note", text: "Check this", position: { x: 0.1, y: 0.1 } }]),
      },
      mockContext
    )
    await officecliTool.execute({ action: "accept", filePath: testFile }, mockContext)
    const noteOnly = await readFile(testFile)

    expect(both.equals(noteOnly)).toBe(false)
  })

  it("annotations are cleared with an empty array", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Image draft" },
      mockContext
    )
    await officecliTool.execute(
      {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "stamp", text: "DRAFT", position: { x: 0.5, y: 0.5 } }]),
      },
      mockContext
    )
    const clearResult = await officecliTool.execute(
      { action: "annotate", filePath: testFile, annotations: "[]" },
      mockContext
    )
    expect(clearResult.output).toContain("Annotations cleared")
    await officecliTool.execute({ action: "accept", filePath: testFile }, mockContext)
    const after = await readFile(testFile)
    expect(after.equals(await readFile(baseImage))).toBe(true)
  })

  it("stamp text is restricted to the fixed palette", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Image draft" },
      mockContext
    )
    const result = await officecliTool.execute(
      {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "stamp", text: "BANANA", position: { x: 0.5, y: 0.5 } }]),
      },
      mockContext
    )
    expect(result.output).toContain("error: stamp 0 text must be one of: DRAFT, APPROVED, CONFIDENTIAL")
  })

  it("note requires text and position", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Image draft" },
      mockContext
    )
    const result = await officecliTool.execute(
      { action: "annotate", filePath: testFile, annotations: JSON.stringify([{ type: "note", position: { x: 0.1, y: 0.1 } }]) },
      mockContext
    )
    expect(result.output).toContain("error: note 0 requires text and position")
  })

  it("highlight requires a rect", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Image draft" },
      mockContext
    )
    const result = await officecliTool.execute(
      { action: "annotate", filePath: testFile, annotations: JSON.stringify([{ type: "highlight" }]) },
      mockContext
    )
    expect(result.output).toContain("error: highlight 0 requires rect")
  })

  it("errors on invalid annotations JSON", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "# Image draft" },
      mockContext
    )
    const result = await officecliTool.execute(
      { action: "annotate", filePath: testFile, annotations: "not json" },
      mockContext
    )
    expect(result.output).toContain("error: invalid annotations JSON")
  })

  it("errors without a draft", async () => {
    const result = await officecliTool.execute(
      {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "stamp", text: "DRAFT", position: { x: 0.5, y: 0.5 } }]),
      },
      mockContext
    )
    expect(result.output).toContain("error: no active draft")
  })

  it("errors on non-image files", async () => {
    const result = await officecliTool.execute(
      { action: "annotate", filePath: docxFixture, annotations: JSON.stringify([{ type: "stamp", text: "DRAFT", position: { x: 0.5, y: 0.5 } }]) },
      mockContext
    )
    expect(result.output).toContain("error: annotate only supported for PNG and JPG images")
  })
})
