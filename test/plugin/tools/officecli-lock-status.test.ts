import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli.js"
import { getDraftsDir, getHistoryDir, getLocksDir, getFilePathHash } from "@/core/storage/paths.js"
import { mkdir, rm } from "fs/promises"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { join } from "path"

describe("officecli lock-status action", () => {
  const testFile = "/tmp/officecli-lock-status.txt"
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

  function writeStaleLock(sessionID: string, owner: string): void {
    const lockPath = join(getLocksDir(), `${getFilePathHash(testFile)}.json`)
    writeFileSync(
      lockPath,
      JSON.stringify({ sessionID, owner, touchedAt: Date.now() - 25 * 60 * 60 * 1000, status: "acquired" })
    )
  }

  it("returns lock details including owner and staleness", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "content" },
      mockContext
    )
    const result = await officecliTool.execute({ action: "lock-status", filePath: testFile }, mockContext)
    const lock = JSON.parse(result.output as string)
    expect(lock.sessionID).toBe("test-session")
    expect(lock.owner).toBe("test-agent")
    expect(lock.status).toBe("acquired")
    expect(lock.stale).toBe(false)
    expect(lock.touchedAt).toBeTypeOf("number")
  })

  it("reports no lock for an unlocked file", async () => {
    const result = await officecliTool.execute({ action: "lock-status", filePath: testFile }, mockContext)
    expect(result.output).toContain("no lock")
  })

  it("requires filePath", async () => {
    const result = await officecliTool.execute({ action: "lock-status" }, mockContext)
    expect(result.output).toContain("error")
  })

  it("force-release refuses when there is no lock", async () => {
    const result = await officecliTool.execute({ action: "force-release", filePath: testFile }, mockContext)
    expect(result.output).toContain("error")
  })

  it("force-release refuses a fresh foreign lock", async () => {
    await officecliTool.execute(
      { action: "create", filePath: testFile, content: "content" },
      { ...mockContext, sessionID: "other-session", agent: "other-agent" }
    )
    const result = await officecliTool.execute({ action: "force-release", filePath: testFile }, mockContext)
    expect(result.output).toContain("error")
    const lockPath = join(getLocksDir(), `${getFilePathHash(testFile)}.json`)
    expect(JSON.parse(readFileSync(lockPath, "utf-8")).sessionID).toBe("other-session")
  })

  it("force-release takes over a stale foreign lock", async () => {
    writeStaleLock("other-session", "other-agent")
    const result = await officecliTool.execute({ action: "force-release", filePath: testFile }, mockContext)
    expect(result.output).toContain("Force released")
    const lockPath = join(getLocksDir(), `${getFilePathHash(testFile)}.json`)
    const lock = JSON.parse(readFileSync(lockPath, "utf-8"))
    expect(lock.sessionID).toBe("test-session")
    expect(lock.owner).toBe("test-agent")
  })

  it("force-release requires filePath", async () => {
    const result = await officecliTool.execute({ action: "force-release" }, mockContext)
    expect(result.output).toContain("error")
  })
})
