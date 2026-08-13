import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "../../../src/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../../../src/core/storage/paths"
import { mkdir, rm, writeFile } from "fs/promises"
import { existsSync } from "fs"

describe("officecli generate action", () => {
  const templateFile = "/tmp/officecli-template.md"
  const outA = "/tmp/officecli-gen-a.txt"
  const outB = "/tmp/officecli-gen-b.txt"
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
    for (const f of [templateFile, outA, outB]) {
      if (existsSync(f)) await rm(f)
    }
  })

  it("creates one draft from a data object", async () => {
    await writeFile(templateFile, "Decision {{NUMBER}}\nDept: {{DEPT}}\n")
    const result = await officecliTool.execute(
      {
        action: "generate",
        templatePath: templateFile,
        filePath: outA,
        data: JSON.stringify({ NUMBER: 1, DEPT: "Microbiology" }),
      },
      mockContext
    )
    expect(result).toEqual({ output: "Generated 1 drafts from /tmp/officecli-template.md" })
    const read = await officecliTool.execute({ action: "read", filePath: outA }, mockContext)
    expect(read.output).toBe("Decision 1\nDept: Microbiology\n")
  })

  it("creates one locked draft per dataArray entry", async () => {
    await writeFile(templateFile, "{{DEPT}} decision {{NUMBER}}\n")
    const result = await officecliTool.execute(
      {
        action: "generate",
        templatePath: templateFile,
        filePaths: JSON.stringify([outA, outB]),
        dataArray: JSON.stringify([
          { DEPT: "Microbiology", NUMBER: 1 },
          { DEPT: "Radiology", NUMBER: 2 },
        ]),
      },
      mockContext
    )
    expect(result).toEqual({ output: "Generated 2 drafts from /tmp/officecli-template.md" })
    const readA = await officecliTool.execute({ action: "read", filePath: outA }, mockContext)
    const readB = await officecliTool.execute({ action: "read", filePath: outB }, mockContext)
    expect(readA.output).toBe("Microbiology decision 1\n")
    expect(readB.output).toBe("Radiology decision 2\n")
  })

  it("generated drafts accept normally", async () => {
    await writeFile(templateFile, "{{DEPT}}\n")
    await officecliTool.execute(
      {
        action: "generate",
        templatePath: templateFile,
        filePath: outA,
        data: JSON.stringify({ DEPT: "Cardiology" }),
      },
      mockContext
    )
    const accepted = await officecliTool.execute({ action: "accept", filePath: outA }, mockContext)
    expect(accepted).toEqual({ output: expect.stringContaining("Accepted") })
    expect(existsSync(outA)).toBe(true)
  })

  it("errors listing missing keys and creates no drafts", async () => {
    await writeFile(templateFile, "{{DEPT}} and {{NUMBER}}\n")
    const result = await officecliTool.execute(
      {
        action: "generate",
        templatePath: templateFile,
        filePath: outA,
        data: JSON.stringify({ DEPT: "X" }),
      },
      mockContext
    )
    expect(result.output).toContain("error: missing template keys: NUMBER")
    const list = await officecliTool.execute({ action: "list" }, mockContext)
    expect(JSON.parse(list.output as string)).toEqual([])
  })

  it("errors on invalid data JSON", async () => {
    await writeFile(templateFile, "{{a}}\n")
    const result = await officecliTool.execute(
      {
        action: "generate",
        templatePath: templateFile,
        filePath: outA,
        data: "{not json",
      },
      mockContext
    )
    expect(result.output).toContain("error: invalid data JSON")
  })

  it("errors when dataArray and filePaths lengths differ", async () => {
    await writeFile(templateFile, "{{a}}\n")
    const result = await officecliTool.execute(
      {
        action: "generate",
        templatePath: templateFile,
        filePaths: JSON.stringify([outA]),
        dataArray: JSON.stringify([{ a: "1" }, { a: "2" }]),
      },
      mockContext
    )
    expect(result.output).toContain("error")
  })

  it("errors when the template file does not exist", async () => {
    const result = await officecliTool.execute(
      {
        action: "generate",
        templatePath: "/tmp/does-not-exist.md",
        filePath: outA,
        data: JSON.stringify({}),
      },
      mockContext
    )
    expect(result.output).toContain("error: template not found")
  })

  it("accepts extra keys in the data", async () => {
    await writeFile(templateFile, "{{a}}\n")
    const result = await officecliTool.execute(
      {
        action: "generate",
        templatePath: templateFile,
        filePath: outA,
        data: JSON.stringify({ a: "1", unused: "2" }),
      },
      mockContext
    )
    expect(result.output).toContain("Generated 1 drafts")
  })

  it("rejects a data value that is neither string nor number", async () => {
    await writeFile(templateFile, "{{a}}\n")
    const result = await officecliTool.execute(
      {
        action: "generate",
        templatePath: templateFile,
        filePath: outA,
        data: JSON.stringify({ a: true }),
      },
      mockContext
    )
    expect(result.output).toContain("error: data must be a JSON object with string or number values")
  })

  it("aborts with no partial drafts when another session holds the lock", async () => {
    await writeFile(templateFile, "{{a}}\n")
    await officecliTool.execute(
      { action: "create", filePath: outB, content: "held" },
      { ...mockContext, sessionID: "other-session" }
    )
    const result = await officecliTool.execute(
      {
        action: "generate",
        templatePath: templateFile,
        filePaths: JSON.stringify([outA, outB]),
        dataArray: JSON.stringify([{ a: "1" }, { a: "2" }]),
      },
      mockContext
    )
    expect(result.output).toContain("error: lock on /tmp/officecli-gen-b.txt held by session other-session")
    const list = await officecliTool.execute({ action: "list" }, mockContext)
    expect(JSON.parse(list.output as string)).toHaveLength(1)
    expect(JSON.parse(list.output as string)[0].filePath).toBe(outB)
  })
})
