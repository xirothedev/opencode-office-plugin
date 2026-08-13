import { describe, it, expect } from "vitest"
import { detectFormat } from "../../../src/core/format/detect"

describe("format detection", () => {
  it("detects PDF", () => {
    expect(detectFormat("/path/to/file.pdf")).toBe("pdf")
  })

  it("detects DOCX", () => {
    expect(detectFormat("/path/to/file.docx")).toBe("docx")
  })

  it("detects XLSX", () => {
    expect(detectFormat("/path/to/file.xlsx")).toBe("xlsx")
  })

  it("detects PPTX", () => {
    expect(detectFormat("/path/to/file.pptx")).toBe("pptx")
  })

  it("detects images", () => {
    expect(detectFormat("/path/to/file.png")).toBe("image")
    expect(detectFormat("/path/to/file.jpg")).toBe("image")
  })

  it("returns text for unknown", () => {
    expect(detectFormat("/path/to/file.txt")).toBe("text")
    expect(detectFormat("/path/to/file.md")).toBe("text")
    expect(detectFormat("/path/to/file.ts")).toBe("text")
  })
})
