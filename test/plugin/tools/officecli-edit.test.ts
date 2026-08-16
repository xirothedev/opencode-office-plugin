import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs } from "./harness"
import { getFilePathHash } from "@/core/storage/paths"
import { readFile } from "fs/promises"
import { getDraftPath } from "@/core/draft/manager"

describe("officecli edit action", () => {
  const testFile = "/tmp/edit-test.docx"
  const testHash = getFilePathHash(testFile)
  setupHermeticDirs()

  it("edit updates draft content", async () => {
    // Create draft first
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "initial content" })

    // Edit draft
    const result = await runTool(officecliTool, { action: "edit", filePath: testFile, content: "updated content" })
    expect(result).toContain("edited")

    // Verify draft updated
    const draftPath = getDraftPath(testHash, "test-session", ".docx")
    const draftContent = await readFile(draftPath, "utf-8")
    expect(draftContent).toBe("updated content")
  })

  it("edit requires active lock", async () => {
    // Try edit without creating draft first
    await expect(runTool(officecliTool, { action: "edit", filePath: testFile, content: "updated" })).rejects.toThrow(
      /no active draft to edit/
    )
  })
})
