import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "../../../src/plugin/tools/officecli"
import { getDraftsDir, getHistoryDir, getLocksDir, getFilePathHash } from "../../../src/core/storage/paths"
import { mkdir, rm } from "fs/promises"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { join } from "path"

describe("officecli batch create/accept", () => {
  const fileA = "/tmp/officecli-batch-a.txt"
  const fileB = "/tmp/officecli-batch-b.txt"
  const fileC = "/tmp/officecli-batch-c.txt"
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
    for (const f of [fileA, fileB, fileC]) {
      if (existsSync(f)) await rm(f)
    }
  })

  it("create with filePaths creates a draft for every path with the same content", async () => {
    const result = await officecliTool.execute(
      {
        action: "create",
        filePaths: JSON.stringify([fileA, fileB]),
        content: "shared content",
      },
      mockContext
    )
    expect(result).toEqual({ output: expect.stringContaining("2 drafts") })
    const readA = await officecliTool.execute({ action: "read", filePath: fileA }, mockContext)
    const readB = await officecliTool.execute({ action: "read", filePath: fileB }, mockContext)
    expect(readA.output).toBe("shared content")
    expect(readB.output).toBe("shared content")
  })

  it("create with filePaths aborts with no partial drafts when another session holds a lock", async () => {
    await officecliTool.execute(
      { action: "create", filePath: fileB, content: "held" },
      { ...mockContext, sessionID: "other-session" }
    )
    const result = await officecliTool.execute(
      {
        action: "create",
        filePaths: JSON.stringify([fileA, fileB]),
        content: "shared content",
      },
      mockContext
    )
    expect(result.output).toContain("error: lock on /tmp/officecli-batch-b.txt held by session other-session")
    const list = await officecliTool.execute({ action: "list" }, mockContext)
    const drafts = JSON.parse(list.output as string)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].filePath).toBe(fileB)
  })

  it("create with invalid filePaths JSON errors", async () => {
    const result = await officecliTool.execute(
      { action: "create", filePaths: "{not json", content: "x" },
      mockContext
    )
    expect(result.output).toContain("error: invalid filePaths JSON")
  })

  it("create with a non-array filePaths errors", async () => {
    const result = await officecliTool.execute(
      { action: "create", filePaths: JSON.stringify("x"), content: "x" },
      mockContext
    )
    expect(result.output).toContain("error: filePaths must be a non-empty array of strings")
  })

  it("accept with filePaths accepts all drafts", async () => {
    await officecliTool.execute(
      {
        action: "create",
        filePaths: JSON.stringify([fileA, fileB]),
        content: "batch content",
      },
      mockContext
    )
    const result = await officecliTool.execute(
      { action: "accept", filePaths: JSON.stringify([fileA, fileB]) },
      mockContext
    )
    expect(result).toEqual({ output: expect.stringContaining("2 drafts") })
    expect(readFileSync(fileA, "utf-8")).toBe("batch content")
    expect(readFileSync(fileB, "utf-8")).toBe("batch content")
  })

  it("accept with filePaths aborts with no partial accepts when one path has no draft", async () => {
    await officecliTool.execute({ action: "create", filePath: fileA, content: "content" }, mockContext)
    const result = await officecliTool.execute(
      { action: "accept", filePaths: JSON.stringify([fileA, fileB]) },
      mockContext
    )
    expect(result.output).toContain("error")
    expect(existsSync(fileA)).toBe(false)
    expect(existsSync(fileB)).toBe(false)
    const list = await officecliTool.execute({ action: "list" }, mockContext)
    expect(JSON.parse(list.output as string)).toHaveLength(1)
  })

  it("create with empty filePaths array errors", async () => {
    const result = await officecliTool.execute(
      { action: "create", filePaths: "[]", content: "x" },
      mockContext
    )
    expect(result.output).toContain("error: filePaths must be a non-empty array of strings")
  })

  it("accept with empty filePaths array errors", async () => {
    const result = await officecliTool.execute({ action: "accept", filePaths: "[]" }, mockContext)
    expect(result.output).toContain("error: filePaths must be a non-empty array of strings")
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
    const result = await officecliTool.execute(
      {
        action: "create",
        filePaths: JSON.stringify([fileA, fileB]),
        content: "shared content",
      },
      mockContext
    )
    expect(result).toEqual({ output: expect.stringContaining("2 drafts") })
    const lockStatus = await officecliTool.execute({ action: "lock-status", filePath: fileB }, mockContext)
    expect(JSON.parse(lockStatus.output as string).sessionID).toBe("test-session")
  })

  it("accept with invalid filePaths JSON errors", async () => {
    const result = await officecliTool.execute(
      { action: "accept", filePaths: "{not json" },
      mockContext
    )
    expect(result.output).toContain("error: invalid filePaths JSON")
  })
})
