import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "../../../src/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../../../src/core/storage/paths"
import { mkdir, rm } from "fs/promises"
import { existsSync } from "fs"

describe("officecli validate action", () => {
  const testFile = "/tmp/officecli-validate.txt"
  const mockContext = {
    agent: "test-agent",
    sessionID: "test-session",
    messageID: "test-message",
    directory: "/tmp",
    worktree: "/tmp",
  }

  beforeEach(async () => {
    await mkdir(getDraftsDir(), { recursive: true })
    await mkdir(getHistoryDir(), { recursive: true })
    await mkdir(getLocksDir(), { recursive: true })
  })

  afterEach(async () => {
    await rm(getDraftsDir(), { recursive: true, force: true })
    await rm(getHistoryDir(), { recursive: true, force: true })
    await rm(getLocksDir(), { recursive: true, force: true })
    if (existsSync(testFile)) await rm(testFile)
  })

  it("reports pass for every rule that matches the draft", async () => {
    await officecliTool.execute(
      {
        action: "create",
        filePath: testFile,
        content: "# Invoice 2024-015\nSigned by: Manager\n",
      },
      mockContext
    )
    const result = await officecliTool.execute(
      {
        action: "validate",
        filePath: testFile,
        rules: JSON.stringify([
          { type: "regex", pattern: "Invoice" },
          { type: "required", pattern: "Signed by" },
        ]),
      },
      mockContext
    )
    expect(result.output).toContain("2 rules, 2 passed, 0 failed")
    expect(result.output).toContain("pass: regex \"Invoice\"")
    expect(result.output).toContain("pass: required \"Signed by\"")
  })

  it("reports failed rules individually without blocking", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "no signature here\n" },
      mockContext
    )
    const result = await officecliTool.execute(
      {
        action: "validate",
        filePath: testFile,
        rules: JSON.stringify([
          { type: "regex", pattern: "^DRAFT$" },
          { type: "required", pattern: "Signature" },
        ]),
      },
      mockContext
    )
    expect(result.output).toContain("2 rules, 0 passed, 2 failed")
    expect(result.output).toContain("fail: regex \"^DRAFT$\"")
    expect(result.output).toContain("fail: required \"Signature\"")
  })

  it("errors when there is no draft", async () => {
    const result = await officecliTool.execute(
      { action: "validate", filePath: testFile, rules: JSON.stringify([{ type: "required", pattern: "x" }]) },
      mockContext
    )
    expect(result.output).toContain("error: no active draft to validate")
  })

  it("errors on invalid rules JSON", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "content" },
      mockContext
    )
    const result = await officecliTool.execute(
      { action: "validate", filePath: testFile, rules: "{not json" },
      mockContext
    )
    expect(result.output).toContain("error: invalid rules JSON")
  })

  it("errors on a rule with an unknown type", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "content" },
      mockContext
    )
    const result = await officecliTool.execute(
      {
        action: "validate",
        filePath: testFile,
        rules: JSON.stringify([{ type: "schema", pattern: "x" }]),
      },
      mockContext
    )
    expect(result.output).toContain("error: rule 0 has unknown type schema")
  })

  it("errors on an invalid regex pattern", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "content" },
      mockContext
    )
    const result = await officecliTool.execute(
      {
        action: "validate",
        filePath: testFile,
        rules: JSON.stringify([{ type: "regex", pattern: "(" }]),
      },
      mockContext
    )
    expect(result.output).toContain("error: invalid regex pattern")
  })

  it("requires filePath and rules", async () => {
    const result = await officecliTool.execute({ action: "validate", filePath: testFile }, mockContext)
    expect(result.output).toContain("error")
  })
})
