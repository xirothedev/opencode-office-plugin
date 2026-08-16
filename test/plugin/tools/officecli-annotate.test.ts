import { describe, it, expect, beforeEach } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { copyFile, readFile } from "fs/promises"
import { join } from "path"
import sharp from "sharp"

describe("officecli annotate", () => {
  const testFile = "/tmp/test-annotate.png"
  const baseImage = "/tmp/test-annotate-base.png"
  const docxFixture = join(process.cwd(), "test/fixtures/sample.docx")
  setupHermeticDirs()
  cleanupTestFile(testFile)
  cleanupTestFile(baseImage)

  async function makeBaseImage(path: string) {
    await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .png()
      .toFile(path)
  }

  beforeEach(async () => {
    await makeBaseImage(baseImage)
    await copyFile(baseImage, testFile)
  })

  it("annotate renders a stamp onto the accepted image", async () => {
    const before = await readFile(testFile)
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Image draft\n\nOCR text" })
    const result = await runTool(officecliTool, {
      action: "annotate",
      filePath: testFile,
      annotations: JSON.stringify([{ type: "stamp", text: "APPROVED", position: { x: 0.5, y: 0.5 } }]),
    })
    expect(result).toContain("Annotations added")
    const acceptResult = await runTool(officecliTool, { action: "accept", filePath: testFile })
    expect(acceptResult).toContain("Accepted")
    const after = await readFile(testFile)
    expect(after.equals(before)).toBe(false)
    const meta = await sharp(testFile).metadata()
    expect(meta.format).toBe("png")
  })

  it("annotations accumulate until accept", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Image draft" })
    await runTool(officecliTool, {
      action: "annotate",
      filePath: testFile,
      annotations: JSON.stringify([{ type: "note", text: "Check this", position: { x: 0.1, y: 0.1 } }]),
    })
    await runTool(officecliTool, {
      action: "annotate",
      filePath: testFile,
      annotations: JSON.stringify([{ type: "stamp", text: "DRAFT", position: { x: 0.5, y: 0.5 } }]),
    })
    await runTool(officecliTool, { action: "accept", filePath: testFile })
    const both = await readFile(testFile)

    await copyFile(baseImage, testFile)
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Image draft" })
    await runTool(officecliTool, {
      action: "annotate",
      filePath: testFile,
      annotations: JSON.stringify([{ type: "note", text: "Check this", position: { x: 0.1, y: 0.1 } }]),
    })
    await runTool(officecliTool, { action: "accept", filePath: testFile })
    const noteOnly = await readFile(testFile)

    expect(both.equals(noteOnly)).toBe(false)
  })

  it("annotations are cleared with an empty array", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Image draft" })
    await runTool(officecliTool, {
      action: "annotate",
      filePath: testFile,
      annotations: JSON.stringify([{ type: "stamp", text: "DRAFT", position: { x: 0.5, y: 0.5 } }]),
    })
    const clearResult = await runTool(officecliTool, { action: "annotate", filePath: testFile, annotations: "[]" })
    expect(clearResult).toContain("Annotations cleared")
    await runTool(officecliTool, { action: "accept", filePath: testFile })
    const after = await readFile(testFile)
    expect(after.equals(await readFile(baseImage))).toBe(true)
  })

  it("stamp text is restricted to the fixed palette", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Image draft" })
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "stamp", text: "BANANA", position: { x: 0.5, y: 0.5 } }]),
      })
    ).rejects.toThrow(/stamp 0 text must be one of: DRAFT, APPROVED, CONFIDENTIAL/)
  })

  it("note requires text and position", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Image draft" })
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "note", position: { x: 0.1, y: 0.1 } }]),
      })
    ).rejects.toThrow(/note 0 requires text and position/)
  })

  it("highlight requires a rect", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Image draft" })
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "highlight" }]),
      })
    ).rejects.toThrow(/highlight 0 requires rect/)
  })

  it("errors on invalid annotations JSON", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Image draft" })
    await expect(
      runTool(officecliTool, { action: "annotate", filePath: testFile, annotations: "not json" })
    ).rejects.toThrow(/invalid annotations JSON/)
  })

  it("errors without a draft", async () => {
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        filePath: testFile,
        annotations: JSON.stringify([{ type: "stamp", text: "DRAFT", position: { x: 0.5, y: 0.5 } }]),
      })
    ).rejects.toThrow(/no active draft/)
  })

  it("errors on non-image files", async () => {
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        filePath: docxFixture,
        annotations: JSON.stringify([{ type: "stamp", text: "DRAFT", position: { x: 0.5, y: 0.5 } }]),
      })
    ).rejects.toThrow(/annotate only supported for PNG and JPG images/)
  })
})
