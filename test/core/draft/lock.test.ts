import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { acquireLock, releaseLock, getLock, isLockStale, overrideLock } from "../../../src/core/draft/lock.js"
import { getLocksDir, getFilePathHash } from "../../../src/core/storage/paths.js"
import { mkdir, rm } from "fs/promises"

describe("lock", () => {
  const testFile = "/test/file.docx"
  const testHash = getFilePathHash(testFile)
  const sessionA = "session-a"
  const sessionB = "session-b"

  beforeEach(async () => {
    await mkdir(getLocksDir(), { recursive: true })
  })

  afterEach(async () => {
    await rm(getLocksDir(), { recursive: true, force: true })
  })

  it("acquires lock", () => {
    acquireLock(testHash, sessionA)
    const lock = getLock(testHash)
    expect(lock).toBeDefined()
    expect(lock!.sessionID).toBe(sessionA)
  })

  it("lock has touchedAt timestamp", () => {
    acquireLock(testHash, sessionA)
    const lock = getLock(testHash)
    expect(lock!.touchedAt).toBeTypeOf("number")
    expect(lock!.touchedAt).toBeLessThan(Date.now() + 1000)
  })

  it("releases lock", () => {
    acquireLock(testHash, sessionA)
    releaseLock(testHash)
    const lock = getLock(testHash)
    expect(lock).toBeNull()
  })

  it("getLock returns null if no lock", () => {
    const lock = getLock(testHash)
    expect(lock).toBeNull()
  })

  it("isLockStale returns false for fresh lock", () => {
    acquireLock(testHash, sessionA)
    expect(isLockStale(testHash)).toBe(false)
  })

  it("overrideLock replaces lock with new session", () => {
    acquireLock(testHash, sessionA)
    overrideLock(testHash, sessionB)
    const lock = getLock(testHash)
    expect(lock!.sessionID).toBe(sessionB)
  })
})
