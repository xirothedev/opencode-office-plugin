import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { copyFile } from "fs/promises"
import { join } from "path"

describe("officecli read PDF", () => {
  const testFile = "/tmp/test-read.pdf"
  const fixturePath = join(process.cwd(), "test/fixtures/sample.pdf")
  setupHermeticDirs()
  cleanupTestFile(testFile)

  it("read PDF returns markdown with extracted text", async () => {
    await copyFile(fixturePath, testFile)
    const result = await runTool(officecliTool, { action: "read", filePath: testFile })
    expect(result).toContain("Hello PDF")
  })
})
