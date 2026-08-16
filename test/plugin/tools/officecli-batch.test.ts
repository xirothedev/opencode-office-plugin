import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { getLocksDir, getFilePathHash } from "@/core/storage/paths"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { join } from "path"

describe("officecli batch create/accept", () => {
  const fileA = "/tmp/officecli-batch-a.txt"
  const fileB = "/tmp/officecli-batch-b.txt"
  const fileC = "/tmp/officecli-batch-c.txt"
  setupHermeticDirs()
  cleanupTestFile(fileA)
  cleanupTestFile(fileB)
  cleanupTestFile(fileC)

  it("create with filePaths creates a draft for every path with the same content", async () => {
    const result = await runTool(officecliTool, {
      action: "create",
      filePaths: JSON.stringify([fileA, fileB]),
      content: "shared content",
    })
    expect(result).toContain("2 drafts")
    const readA = await runTool(officecliTool, { action: "read", filePath: fileA })
    const readB = await runTool(officecliTool, { action: "read", filePath: fileB })
    expect(readA).toBe("shared content")
    expect(readB).toBe("shared content")
  })

  it("create with filePaths aborts with no partial drafts when another session holds a lock", async () => {
    await runTool(officecliTool, { action: "create", filePath: fileB, content: "held" }, {
      sessionID: "other-session",
    })
    await expect(
      runTool(officecliTool, {
        action: "create",
        filePaths: JSON.stringify([fileA, fileB]),
        content: "shared content",
      })
    ).rejects.toThrow(/lock on \/tmp\/officecli-batch-b\.txt held by session other-session/)
    const list = await runTool(officecliTool, { action: "list" })
    const drafts = JSON.parse(list)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].filePath).toBe(fileB)
  })

  it("create with invalid filePaths JSON errors", async () => {
    await expect(
      runTool(officecliTool, { action: "create", filePaths: "{not json", content: "x" })
    ).rejects.toThrow(/invalid filePaths JSON/)
  })

  it("create with a non-array filePaths errors", async () => {
    await expect(
      runTool(officecliTool, { action: "create", filePaths: JSON.stringify("x"), content: "x" })
    ).rejects.toThrow(/filePaths must be a non-empty array of strings/)
  })

  it("accept with filePaths accepts all drafts", async () => {
    await runTool(officecliTool, {
      action: "create",
      filePaths: JSON.stringify([fileA, fileB]),
      content: "batch content",
    })
    const result = await runTool(officecliTool, { action: "accept", filePaths: JSON.stringify([fileA, fileB]) })
    expect(result).toContain("2 drafts")
    expect(readFileSync(fileA, "utf-8")).toBe("batch content")
    expect(readFileSync(fileB, "utf-8")).toBe("batch content")
  })

  it("accept with filePaths aborts with no partial accepts when one path has no draft", async () => {
    await runTool(officecliTool, { action: "create", filePath: fileA, content: "content" })
    await expect(
      runTool(officecliTool, { action: "accept", filePaths: JSON.stringify([fileA, fileB]) })
    ).rejects.toThrow(/no active draft to accept for \/tmp\/officecli-batch-b\.txt/)
    expect(existsSync(fileA)).toBe(false)
    expect(existsSync(fileB)).toBe(false)
    const list = await runTool(officecliTool, { action: "list" })
    expect(JSON.parse(list)).toHaveLength(1)
  })

  it("create with empty filePaths array errors", async () => {
    await expect(
      runTool(officecliTool, { action: "create", filePaths: "[]", content: "x" })
    ).rejects.toThrow(/filePaths must be a non-empty array of strings/)
  })

  it("accept with empty filePaths array errors", async () => {
    await expect(runTool(officecliTool, { action: "accept", filePaths: "[]" })).rejects.toThrow(
      /filePaths must be a non-empty array of strings/
    )
  })

  it("create with filePaths acquires over a stale foreign lock", async () => {
    const lockPath = join(getLocksDir(), `${getFilePathHash(fileB)}.json`)
    writeFileSync(
      lockPath,
      JSON.stringify({
        sessionID: "other-session",
        owner: "other-agent",
        touchedAt: Date.now() - 25 * 60 * 60 * 1000,
        status: "acquired",
      })
    )
    const result = await runTool(officecliTool, {
      action: "create",
      filePaths: JSON.stringify([fileA, fileB]),
      content: "shared content",
    })
    expect(result).toContain("2 drafts")
    const lockStatus = await runTool(officecliTool, { action: "lock-status", filePath: fileB })
    expect(JSON.parse(lockStatus).sessionID).toBe("test-session")
  })

  it("accept with invalid filePaths JSON errors", async () => {
    await expect(runTool(officecliTool, { action: "accept", filePaths: "{not json" })).rejects.toThrow(
      /invalid filePaths JSON/
    )
  })
})
