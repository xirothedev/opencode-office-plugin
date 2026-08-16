import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { copyFile } from "fs/promises"
import { join } from "path"

describe("officecli edit binary (DOCX)", () => {
  const testFile = "/tmp/test-edit.docx"
  const fixturePath = join(process.cwd(), "test/fixtures/sample.docx")
  setupHermeticDirs()
  cleanupTestFile(testFile)

  it("edit DOCX updates content after accept", async () => {
    await copyFile(fixturePath, testFile)

    // Read original
    const readResult = await runTool(officecliTool, { action: "read", filePath: testFile })
    expect(readResult).toContain("Hello DOCX")

    // Create draft with new content
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "# Updated DOCX\n\nNew content here." })

    // Accept
    await runTool(officecliTool, { action: "accept", filePath: testFile })

    // Read again to verify
    const newReadResult = await runTool(officecliTool, { action: "read", filePath: testFile })
    expect(newReadResult).toContain("Updated DOCX")
    expect(newReadResult).toContain("New content here")
  })
})
