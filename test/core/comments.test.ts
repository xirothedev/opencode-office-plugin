import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { copyFileSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import * as Comments from "@/core/comments"

const FIXTURES = {
  ".docx": join(process.cwd(), "test/fixtures/sample.docx"),
  ".xlsx": join(process.cwd(), "test/fixtures/sample.xlsx"),
  ".pptx": join(process.cwd(), "test/fixtures/sample.pptx"),
}

function baseInput(ext: string) {
  const common = { id: "c1", author: "Tester", text: "hello <b>x</b>" }
  if (ext === ".docx")
    return { ...common, rangeStartParagraph: 0, rangeStartOffset: 0, rangeEndParagraph: 0, rangeEndOffset: 5 }
  if (ext === ".xlsx") return { ...common, cellRef: "B2" }
  return { ...common, slide: 0 }
}

describe("Comment intake module", () => {
  let testDir: string

  const fixture = (ext: string) => {
    const p = join(testDir, `copy${ext}`)
    copyFileSync(FIXTURES[ext], p)
    return p
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `comments-intake-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  for (const ext of Object.keys(FIXTURES)) {
    it(`routes add → list → update → remove for ${ext}`, async () => {
      const file = fixture(ext)
      await Comments.add(file, baseInput(ext))
      let comments = await Comments.list(file)
      expect(comments).toHaveLength(1)
      expect(comments[0].text).toBe("hello <b>x</b>")
      expect((await Comments.preview(file))[0].anchor).toBeTruthy()

      const storedId = comments[0].id
      expect(await Comments.update(file, storedId, { text: "edited" })).toBe("updated")
      expect((await Comments.list(file))[0].text).toBe("edited")
      expect(await Comments.remove(file, storedId)).toBe("deleted")
      expect(await Comments.list(file)).toHaveLength(0)
    })
  }

  it("runs the full lifecycle on DOCX (the format with string ids)", async () => {
    const file = fixture(".docx")
    await Comments.add(file, baseInput(".docx"))
    expect(await Comments.setStatus(file, "c1", "resolved")).toBe("ok")
    expect((await Comments.list(file))[0].status).toBe("resolved")
    expect(await Comments.applySuggestion(file, "c1")).toBe("no-suggestion")
    expect(await Comments.applySuggestion(file, "nope")).toBe("not-found")
  })

  it("refuses to approve a denied suggestion, on every format", async () => {
    for (const ext of Object.keys(FIXTURES)) {
      const file = fixture(ext)
      await Comments.add(file, { ...baseInput(ext), suggestedText: "SHOULD-NOT-APPLY" })
      const id = (await Comments.list(file))[0].id
      expect(await Comments.setStatus(file, id, "denied")).toBe("ok")
      expect(await Comments.applySuggestion(file, id)).toBe("denied")
      const after = await Comments.list(file)
      expect(after).toHaveLength(1)
      expect(after[0].status).toBe("denied")
    }
  })

  it("strips XML-illegal control characters at the seam", async () => {
    const file = fixture(".xlsx")
    await Comments.add(file, { id: "c1", author: "a", text: "a\x03b", cellRef: "B2" })
    expect((await Comments.list(file))[0].text).toBe("ab")
  })

  it("rejects unsupported formats with the exact noun message", async () => {
    const txt = join(testDir, "notes.txt")
    expect(() => Comments.requireFormat(txt, "comments")).toThrow(
      "comments only supported for DOCX, XLSX and PPTX files",
    )
    await expect(Comments.add(txt, { id: "c", author: "a", text: "t" })).rejects.toThrow(
      "comments only supported for DOCX, XLSX and PPTX files",
    )
  })

  it("requires per-format params", () => {
    const docx = join(testDir, "a.docx")
    expect(() => Comments.validate(docx, { id: "c", author: "a", text: "t" })).toThrow(
      "comment on DOCX requires rangeStartParagraph, rangeStartOffset, rangeEndParagraph, rangeEndOffset",
    )
    const xlsx = join(testDir, "a.xlsx")
    expect(() => Comments.validate(xlsx, { id: "c", author: "a", text: "t" })).toThrow(
      'comment on XLSX requires cellRef (e.g. "B4")',
    )
  })

  it("preview returns [] for non-Office extensions instead of throwing", async () => {
    const txt = join(testDir, "p.txt")
    expect(await Comments.preview(txt)).toEqual([])
  })
})
