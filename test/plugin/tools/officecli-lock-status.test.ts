import { describe, it, expect } from "vitest"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { getLocksDir, getFilePathHash } from "@/core/storage/paths"
import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

describe("officecli lock-status action", () => {
  const testFile = "/tmp/officecli-lock-status.txt"
  setupHermeticDirs()
  cleanupTestFile(testFile)

  function writeStaleLock(sessionID: string, owner: string): void {
    const lockPath = join(getLocksDir(), `${getFilePathHash(testFile)}.json`)
    writeFileSync(
      lockPath,
      JSON.stringify({ sessionID, owner, touchedAt: Date.now() - 25 * 60 * 60 * 1000, status: "acquired" })
    )
  }

  it("returns lock details including owner and staleness", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "content" })
    const result = await runTool(officecliTool, { action: "lock-status", filePath: testFile })
    const lock = JSON.parse(result)
    expect(lock.sessionID).toBe("test-session")
    expect(lock.owner).toBe("test-agent")
    expect(lock.status).toBe("acquired")
    expect(lock.stale).toBe(false)
    expect(lock.touchedAt).toBeTypeOf("number")
  })

  it("reports no lock for an unlocked file", async () => {
    const result = await runTool(officecliTool, { action: "lock-status", filePath: testFile })
    expect(result).toContain("no lock")
  })

  it("requires filePath", async () => {
    await expect(runTool(officecliTool, { action: "lock-status" })).rejects.toThrow(/filePath/)
  })

  it("force-release refuses when there is no lock", async () => {
    await expect(runTool(officecliTool, { action: "force-release", filePath: testFile })).rejects.toThrow(
      /no lock on \/tmp\/officecli-lock-status\.txt to force release/
    )
  })

  it("force-release refuses a fresh foreign lock", async () => {
    await runTool(officecliTool, { action: "create", filePath: testFile, content: "content" }, {
      sessionID: "other-session",
      agent: "other-agent",
    })
    await expect(runTool(officecliTool, { action: "force-release", filePath: testFile })).rejects.toThrow(
      /lock on \/tmp\/officecli-lock-status\.txt is not stale/
    )
    const lockPath = join(getLocksDir(), `${getFilePathHash(testFile)}.json`)
    expect(JSON.parse(readFileSync(lockPath, "utf-8")).sessionID).toBe("other-session")
  })

  it("force-release takes over a stale foreign lock", async () => {
    writeStaleLock("other-session", "other-agent")
    const result = await runTool(officecliTool, { action: "force-release", filePath: testFile })
    expect(result).toContain("Force released")
    const lockPath = join(getLocksDir(), `${getFilePathHash(testFile)}.json`)
    const lock = JSON.parse(readFileSync(lockPath, "utf-8"))
    expect(lock.sessionID).toBe("test-session")
    expect(lock.owner).toBe("test-agent")
  })

  it("force-release requires filePath", async () => {
    await expect(runTool(officecliTool, { action: "force-release" })).rejects.toThrow(/filePath/)
  })
})
