import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { editTool } from "@/plugin/tools/edit"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { writeFile } from "fs/promises"
import { readdirSync, rmSync } from "fs"
import { join } from "path"
import { getLocksDir } from "@/core/storage/paths"

describe("officecli list action", () => {
  const testFileA = "/tmp/officecli-list-a.txt"
  const testFileB = "/tmp/officecli-list-b.txt"
  setupHermeticDirs()
  cleanupTestFile(testFileA)
  cleanupTestFile(testFileB)

  async function list(): Promise<unknown> {
    const result = await runTool(officecliTool, { action: "list" })
    return JSON.parse(result)
  }

  it("returns one entry per active draft with path, session, age and lock status", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFileA, content: "a" })
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
    await runTool(officecliTool, { action: "create", filePath: testFileA, content: "a" })
    await runTool(officecliTool, { action: "create", filePath: testFileB, content: "b" })
    const drafts = await list()
    expect(drafts.map((d: any) => d.filePath).sort()).toEqual([testFileA, testFileB].sort())
  })

  it("marks a draft without a lock as orphaned", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFileA, content: "a" })
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
    await runTool(officecliTool, { action: "create", filePath: testFileA, content: "a" })
    await runTool(officecliTool, { action: "create", filePath: testFileB, content: "b" })
    const result = await runTool(officecliTool, { action: "list", filePath: testFileA })
    const drafts = JSON.parse(result)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].filePath).toBe(testFileA)
  })

  it("removes the entry when the draft is accepted", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFileA, content: "a" })
    await runTool(officecliTool, { action: "accept", filePath: testFileA })
    expect(await list()).toEqual([])
  })

  it("removes the entry when the draft is undone", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFileA, content: "a" })
    await runTool(officecliTool, { action: "undo", filePath: testFileA })
    expect(await list()).toEqual([])
  })

  it("registers the path when the edit override lazily creates a draft", async () => {
    await writeFile(testFileA, "original content")
    const result = await runTool(editTool, { filePath: testFileA, oldString: "original", newString: "changed" })
    expect(result).toContain("Edit applied")
    const drafts = await list()
    expect(drafts).toHaveLength(1)
    expect(drafts[0].filePath).toBe(testFileA)
  })

  it("matches the filter across path forms via resolve", async () => {
    await runTool(officecliTool, { action: "create", filePath: "./tmp/officecli-list-rel.txt", content: "a" })
    const result = await runTool(officecliTool, { action: "list", filePath: "tmp/officecli-list-rel.txt" })
    const drafts = JSON.parse(result)
    expect(drafts).toHaveLength(1)
  })
})
