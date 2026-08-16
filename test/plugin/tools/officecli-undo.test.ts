import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { getFilePathHash } from "@/core/storage/paths"
import { getLock } from "@/core/draft/lock"

describe("officecli undo action", () => {
  const testFile = "/tmp/undo-test.docx"
  const testHash = getFilePathHash(testFile)
  setupHermeticDirs()
  cleanupTestFile(testFile)

  it("undo releases lock", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "test" })
    expect(getLock(testHash)).not.toBeNull()

    const result = await runTool(officecliTool, { action: "undo", filePath: testFile })
    expect(result).toContain("undone")
    expect(getLock(testHash)).toBeNull()
  })

  it("undo requires an active draft", async () => {
    await expect(runTool(officecliTool, { action: "undo", filePath: testFile })).rejects.toThrow(
      /no active draft to undo/
    )
  })
})
