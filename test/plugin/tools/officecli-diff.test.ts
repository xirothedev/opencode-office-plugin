import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { writeFile } from "fs/promises"
import { resolve } from "path"

describe("officecli diff action", () => {
  const testFile = "/tmp/officecli-diff.txt"
  setupHermeticDirs()
  cleanupTestFile(testFile)

  it("returns a unified diff between real file and draft", async () => {
    await writeFile(testFile, "line one\nline two\nline three\n")
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "line one\nline two changed\nline three\n" })
    const result = await runTool(officecliTool, { action: "diff", filePath: testFile })
    expect(result).toContain("-line two")
    expect(result).toContain("+line two changed")
  })

  it("reports no differences when draft equals the real file", async () => {
    await writeFile(testFile, "same content\n")
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "same content\n" })
    const result = await runTool(officecliTool, { action: "diff", filePath: testFile })
    expect(result).not.toContain("@@")
  })

  it("errors when no draft exists", async () => {
    await writeFile(testFile, "content\n")
    await expect(runTool(officecliTool, { action: "diff", filePath: testFile })).rejects.toThrow(
      /no active draft to diff/
    )
  })

  it("names the other session when a draft exists but not for this session", async () => {
    await writeFile(testFile, "content\n")
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "other session's draft\n" }, {
      sessionID: "other-session",
    })
    await expect(runTool(officecliTool, { action: "diff", filePath: testFile })).rejects.toThrow(
      /no draft for this session; draft held by session other-session/
    )
  })

  it("errors when the real file does not exist", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "draft only\n" })
    await expect(runTool(officecliTool, { action: "diff", filePath: testFile })).rejects.toThrow(
      /file not found/
    )
  })

  it("diffs a docx draft against the extracted real file", async () => {
    const docxPath = resolve("test/fixtures/sample.docx")
    const result = await runTool(officecliTool, { action: "create", filePath: docxPath, content: "Some draft content with changes.\n" })
    expect(result).toContain("Draft created")
    const diff = await runTool(officecliTool, { action: "diff", filePath: docxPath })
    expect(diff).toContain("+Some draft content with changes.")
  })
})
