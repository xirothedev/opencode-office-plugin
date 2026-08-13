import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createDraft, acceptDraft, draftExists, getDraftPath } from "../../../src/core/draft/manager.ts"
import { getDraftsDir, getHistoryDir, getLocksDir, getFilePathHash } from "../../../src/core/storage/paths.ts"
import { acquireLock } from "../../../src/core/draft/lock.ts"
import { mkdir, rm } from "fs/promises"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

describe("draft manager", () => {
  const testFile = "/tmp/test-real-file.txt"
  const testHash = getFilePathHash(testFile)
  const sessionA = "session-a"

  beforeEach(async () => {
    await mkdir(getDraftsDir(), { recursive: true })
    await mkdir(getHistoryDir(), { recursive: true })
    await mkdir(getLocksDir(), { recursive: true })
  })

  afterEach(async () => {
    await rm(getDraftsDir(), { recursive: true, force: true })
    await rm(getHistoryDir(), { recursive: true, force: true })
    await rm(getLocksDir(), { recursive: true, force: true })
  })

  it("createDraft creates draft file", () => {
    createDraft(testFile, sessionA, "test content")
    expect(draftExists(testHash, sessionA)).toBe(true)
  })

  it("draft file contains content", () => {
    createDraft(testFile, sessionA, "test content")
    const draftPath = getDraftPath(testHash, sessionA, ".txt")
    const content = readFileSync(draftPath, "utf-8")
    expect(content).toBe("test content")
  })

  it("acceptDraft writes real file", async () => {
    createDraft(testFile, sessionA, "draft content")
    acquireLock(testHash, sessionA)
    await acceptDraft(testFile, sessionA)
    expect(existsSync(testFile)).toBe(true)
    const content = readFileSync(testFile, "utf-8")
    expect(content).toBe("draft content")
  })

  it("acceptDraft records accept-point in history", async () => {
    createDraft(testFile, sessionA, "content")
    acquireLock(testHash, sessionA)
    await acceptDraft(testFile, sessionA)
    const historyPath = join(getHistoryDir(), `${testHash}.json`)
    expect(existsSync(historyPath)).toBe(true)
    const history = JSON.parse(readFileSync(historyPath, "utf-8"))
    expect(history).toHaveLength(1)
    expect(history[0].sessionID).toBe(sessionA)
    expect(history[0].snapshot).toBeDefined()
  })

  it("acceptDraft releases lock", async () => {
    createDraft(testFile, sessionA, "content")
    acquireLock(testHash, sessionA)
    await acceptDraft(testFile, sessionA)
    const lockPath = join(getDraftsDir(), "..", "locks", `${testHash}.json`)
    expect(existsSync(lockPath)).toBe(false)
  })
})
