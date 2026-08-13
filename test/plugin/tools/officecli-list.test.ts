import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "../../../src/plugin/tools/officecli.ts"
import { editTool } from "../../../src/plugin/tools/edit.ts"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../../../src/core/storage/paths.ts"
import { mkdir, rm, writeFile } from "fs/promises"
import { readdirSync, existsSync, rmSync } from "fs"
import { join } from "path"

describe("officecli list action", () => {
  const testFileA = "/tmp/officecli-list-a.txt"
  const testFileB = "/tmp/officecli-list-b.txt"
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
    for (const f of [testFileA, testFileB]) {
      if (existsSync(f)) await rm(f)
    }
  })

  async function list(): Promise<unknown> {
    const result = await officecliTool.execute({ action: "list" }, mockContext)
    return JSON.parse(result.output as string)
  }

  it("returns one entry per active draft with path, session, age and lock status", async () => {
    await officecliTool.execute({ action: "create", filePath: testFileA, content: "a" }, mockContext)
    const drafts = await list()
    expect(drafts).toEqual([
      {
        filePath: testFileA,
        sessionID: "test-session",
        ageSeconds: expect.any(Number),
        lockStatus: "acquired",
        orphaned: false,
      },
    ])
  })

  it("returns an empty array when no drafts exist", async () => {
    expect(await list()).toEqual([])
  })

  it("shows drafts across multiple files", async () => {
    await officecliTool.execute({ action: "create", filePath: testFileA, content: "a" }, mockContext)
    await officecliTool.execute({ action: "create", filePath: testFileB, content: "b" }, mockContext)
    const drafts = await list()
    expect(drafts.map((d: any) => d.filePath).sort()).toEqual([testFileA, testFileB].sort())
  })

  it("marks a draft without a lock as orphaned", async () => {
    await officecliTool.execute({ action: "create", filePath: testFileA, content: "a" }, mockContext)
    const lockFiles = readdirSync(getLocksDir())
    for (const lockFile of lockFiles) {
      rmSync(join(getLocksDir(), lockFile))
    }
    const drafts = await list()
    expect(drafts).toEqual([
      {
        filePath: testFileA,
        sessionID: "test-session",
        ageSeconds: expect.any(Number),
        lockStatus: "none",
        orphaned: true,
      },
    ])
  })

  it("filters to one file when filePath is given", async () => {
    await officecliTool.execute({ action: "create", filePath: testFileA, content: "a" }, mockContext)
    await officecliTool.execute({ action: "create", filePath: testFileB, content: "b" }, mockContext)
    const result = await officecliTool.execute(
      { action: "list", filePath: testFileA },
      mockContext
    )
    const drafts = JSON.parse(result.output as string)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].filePath).toBe(testFileA)
  })

  it("removes the entry when the draft is accepted", async () => {
    await officecliTool.execute({ action: "create", filePath: testFileA, content: "a" }, mockContext)
    await officecliTool.execute({ action: "accept", filePath: testFileA }, mockContext)
    expect(await list()).toEqual([])
  })

  it("removes the entry when the draft is undone", async () => {
    await officecliTool.execute({ action: "create", filePath: testFileA, content: "a" }, mockContext)
    await officecliTool.execute({ action: "undo", filePath: testFileA }, mockContext)
    expect(await list()).toEqual([])
  })

  it("registers the path when the edit override lazily creates a draft", async () => {
    await writeFile(testFileA, "original content")
    const result = await editTool.execute(
      { filePath: testFileA, oldString: "original", newString: "changed" },
      mockContext
    )
    expect(result).toEqual({ output: expect.stringContaining("Edit applied") })
    const drafts = await list()
    expect(drafts).toHaveLength(1)
    expect(drafts[0].filePath).toBe(testFileA)
  })

  it("matches the filter across path forms via resolve", async () => {
    await officecliTool.execute(
      { action: "create", filePath: "./tmp/officecli-list-rel.txt", content: "a" },
      mockContext
    )
    const result = await officecliTool.execute(
      { action: "list", filePath: "tmp/officecli-list-rel.txt" },
      mockContext
    )
    const drafts = JSON.parse(result.output as string)
    expect(drafts).toHaveLength(1)
  })
})
