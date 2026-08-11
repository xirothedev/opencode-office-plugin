import { getLocksDir, getFilePathHash } from "../storage/paths.js"
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs"
import { join } from "path"

interface Lock {
  sessionID: string
  touchedAt: number
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

export function acquireLock(filePathHash: string, sessionID: string): void {
  const lockPath = join(getLocksDir(), `${filePathHash}.json`)
  const lock: Lock = { sessionID, touchedAt: Date.now() }
  writeFileSync(lockPath, JSON.stringify(lock))
}

export function releaseLock(filePathHash: string): void {
  const lockPath = join(getLocksDir(), `${filePathHash}.json`)
  if (existsSync(lockPath)) {
    unlinkSync(lockPath)
  }
}

export function getLock(filePathHash: string): Lock | null {
  const lockPath = join(getLocksDir(), `${filePathHash}.json`)
  if (!existsSync(lockPath)) {
    return null
  }
  const data = readFileSync(lockPath, "utf-8")
  return JSON.parse(data) as Lock
}

export function isLockStale(filePathHash: string): boolean {
  const lock = getLock(filePathHash)
  if (!lock) return false
  return Date.now() - lock.touchedAt > STALE_THRESHOLD_MS
}

export function overrideLock(filePathHash: string, sessionID: string): void {
  acquireLock(filePathHash, sessionID)
}
