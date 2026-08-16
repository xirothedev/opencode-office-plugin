import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"

describe("officecli validate action", () => {
  const testFile = "/tmp/officecli-validate.txt"
  setupHermeticDirs()
  cleanupTestFile(testFile)

  it("reports pass for every rule that matches the draft", async () => {
    await runTool(officecliTool, {
      action: "create",
      filePath: testFile,
      content: "# Invoice 2024-015\nSigned by: Manager\n",
    })
    const result = await runTool(officecliTool, {
      action: "validate",
      filePath: testFile,
      rules: JSON.stringify([
        { type: "regex", pattern: "Invoice" },
        { type: "required", pattern: "Signed by" },
      ]),
    })
    expect(result).toContain("2 rules, 2 passed, 0 failed")
    expect(result).toContain('pass: regex "Invoice"')
    expect(result).toContain('pass: required "Signed by"')
  })

  it("reports failed rules individually without blocking", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "no signature here\n" })
    const result = await runTool(officecliTool, {
      action: "validate",
      filePath: testFile,
      rules: JSON.stringify([
        { type: "regex", pattern: "^DRAFT$" },
        { type: "required", pattern: "Signature" },
      ]),
    })
    expect(result).toContain("2 rules, 0 passed, 2 failed")
    expect(result).toContain('fail: regex "^DRAFT$"')
    expect(result).toContain('fail: required "Signature"')
  })

  it("errors when there is no draft", async () => {
    await expect(
      runTool(officecliTool, {
        action: "validate",
        filePath: testFile,
        rules: JSON.stringify([{ type: "required", pattern: "x" }]),
      })
    ).rejects.toThrow(/no active draft to validate/)
  })

  it("errors on invalid rules JSON", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "content" })
    await expect(
      runTool(officecliTool, { action: "validate", filePath: testFile, rules: "{not json" })
    ).rejects.toThrow(/invalid rules JSON/)
  })

  it("errors on a rule with an unknown type", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "content" })
    await expect(
      runTool(officecliTool, {
        action: "validate",
        filePath: testFile,
        rules: JSON.stringify([{ type: "schema", pattern: "x" }]),
      })
    ).rejects.toThrow(/rule 0 has unknown type schema/)
  })

  it("errors on an invalid regex pattern", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "content" })
    await expect(
      runTool(officecliTool, {
        action: "validate",
        filePath: testFile,
        rules: JSON.stringify([{ type: "regex", pattern: "(" }]),
      })
    ).rejects.toThrow(/invalid regex pattern/)
  })

  it("requires filePath and rules", async () => {
    await expect(runTool(officecliTool, { action: "validate", filePath: testFile })).rejects.toThrow(/rules|filePath/)
  })
})
