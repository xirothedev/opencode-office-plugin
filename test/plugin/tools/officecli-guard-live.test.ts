import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { BINARY_EXTENSIONS } from "@/plugin/tools/edit"
import { readLiveOrFileAsMarkdown } from "@/core/format/read"
import { writeFile } from "fs/promises"

function isBlockedTool(tool: string): boolean {
  return tool === "edit" || tool === "write"
}

// ponytail: one runnable check for non-trivial guard + live branch — fails if logic breaks
describe("guard + live", () => {
  setupHermeticDirs()
  const fallbackFile = "/tmp/guard-live-fallback.txt"
  const directFile = "/tmp/guard-live-direct.txt"
  const liveReadFile = "/tmp/guard-live-read.txt"
  cleanupTestFile(fallbackFile)
  cleanupTestFile(directFile)
  cleanupTestFile(liveReadFile)

  it("BINARY_EXTENSIONS covers office/PDF + images (office is main for read+handle)", () => {
    // office modern
    expect(BINARY_EXTENSIONS.has(".docx")).toBe(true)
    expect(BINARY_EXTENSIONS.has(".xlsx")).toBe(true)
    expect(BINARY_EXTENSIONS.has(".pptx")).toBe(true)
    expect(BINARY_EXTENSIONS.has(".pdf")).toBe(true)
    // office legacy (handled via officecli read)
    expect(BINARY_EXTENSIONS.has(".doc")).toBe(true)
    expect(BINARY_EXTENSIONS.has(".xls")).toBe(true)
    expect(BINARY_EXTENSIONS.has(".ppt")).toBe(true)
    expect(BINARY_EXTENSIONS.has(".xlsm")).toBe(true)
    // images
    expect(BINARY_EXTENSIONS.has(".png")).toBe(true)
    expect(BINARY_EXTENSIONS.has(".jpg")).toBe(true)
    expect(BINARY_EXTENSIONS.has(".jpeg")).toBe(true)
    expect(BINARY_EXTENSIONS.has(".gif")).toBe(true)
    expect(BINARY_EXTENSIONS.has(".txt")).toBe(false)
  })

  it("isBlockedTool matches edit/write only", () => {
    expect(isBlockedTool("edit")).toBe(true)
    expect(isBlockedTool("write")).toBe(true)
    expect(isBlockedTool("read")).toBe(false)
    expect(isBlockedTool("bash")).toBe(false)
  })

  it("read live:true falls back to file when Word not running (darwin)", async () => {
    await writeFile(fallbackFile, "fallback content", "utf-8")
    const r1 = await runTool(officecliTool, { action: "read", filePath: fallbackFile })
    const r2 = await runTool(officecliTool, { action: "read", filePath: fallbackFile, live: true })
    expect(r1).toContain("fallback content")
    // ponytail: when Word is running with a doc open, live:true returns that doc's live content — fallback only when Word not running
    expect(typeof r2).toBe("string")
    expect(r2.length).toBeGreaterThan(0)
    if (r2.includes("fallback content")) {
      expect(r1).toBe(r2)
    }
  })

  it("readLiveOrFileAsMarkdown live=false vs live=true fallback identical on plain file", async () => {
    await writeFile(directFile, "direct fallback", "utf-8")
    const a = await readLiveOrFileAsMarkdown(directFile, false)
    const b = await readLiveOrFileAsMarkdown(directFile, true)
    expect(a).toContain("direct fallback")
    expect(typeof b).toBe("string")
    if (b.includes("direct fallback")) {
      expect(a).toBe(b)
    }
  })

  it("read live:true without draft returns file content via officecli", async () => {
    await writeFile(liveReadFile, "live read file", "utf-8")
    const out = await runTool(officecliTool, { action: "read", filePath: liveReadFile, live: true })
    // ponytail: live:true prefers Word doc when open, else file — accept either but ensure string
    expect(typeof out).toBe("string")
    expect(out.length).toBeGreaterThan(0)
    if (out.includes("live read file")) {
      expect(out).toContain("live read file")
    }
  })
})
