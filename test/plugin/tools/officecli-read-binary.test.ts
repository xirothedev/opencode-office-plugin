import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { writeFile } from "fs/promises"

describe("officecli read binary file", () => {
  const testFile = "/tmp/read-binary-test.bin"
  setupHermeticDirs()
  cleanupTestFile(testFile)

  it("read unknown extension treats as text", async () => {
    // Write binary file
    await writeFile(testFile, "fake binary content", "utf-8")

    const result = await runTool(officecliTool, { action: "read", filePath: testFile })
    expect(result).toContain("fake binary content")
  })
})
