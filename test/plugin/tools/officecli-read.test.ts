import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { writeFile } from "fs/promises"

describe("officecli read action", () => {
  const testFile = "/tmp/read-test.txt"
  setupHermeticDirs()
  cleanupTestFile(testFile)

  it("read returns draft content if exists", async () => {
    // Create draft
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "draft content" })

    const result = await runTool(officecliTool, { action: "read", filePath: testFile })
    expect(result).toContain("draft content")
  })

  it("read returns real file if no draft", async () => {
    // Write real file
    await writeFile(testFile, "real content", "utf-8")

    const result = await runTool(officecliTool, { action: "read", filePath: testFile })
    expect(result).toContain("real content")
  })
})
