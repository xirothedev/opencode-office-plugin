import { describe, it, expect } from "vitest"
import { editTool } from "@/plugin/tools/edit"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { writeFileSync } from "fs"

describe("edit tool", () => {
  const testFile = "/tmp/edit-test.txt"
  const binaryFile = "/tmp/edit-test.docx"
  setupHermeticDirs()
  cleanupTestFile(testFile)
  cleanupTestFile(binaryFile)

  it("denies binary files", async () => {
    writeFileSync(binaryFile, "binary content")
    await expect(runTool(editTool, { filePath: binaryFile, oldString: "old", newString: "new" })).rejects.toThrow(
      /use officecli tool for office\/PDF files/
    )
  })

  it("edits text files via draft", async () => {
    writeFileSync(testFile, "hello world")
    const result = await runTool(editTool, { filePath: testFile, oldString: "world", newString: "opencode" })
    expect(result).toContain("applied to draft")
  })
})
