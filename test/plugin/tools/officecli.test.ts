import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { readFileSync, existsSync } from "fs"

describe("officecli tool", () => {
  const testFile = "/tmp/officecli-test.txt"
  setupHermeticDirs()
  cleanupTestFile(testFile)

  it("create action creates draft", async () => {
    const result = await runTool(officecliTool, { action: "create", filePath: testFile, content: "test content" })
    expect(result).toContain("Draft created")
  })

  it("accept action writes real file", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "draft content" })
    const result = await runTool(officecliTool, { action: "accept", filePath: testFile })
    expect(result).toContain("Accepted")
    expect(existsSync(testFile)).toBe(true)
    const content = readFileSync(testFile, "utf-8")
    expect(content).toBe("draft content")
  })
})
