import { getLocksDir } from "@/core/storage/paths"
import { getStaleThresholdMs } from "@/core/options"
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs"
import { dirname, join } from "path"

export type LockStatus = "acquired" | "in-review" | "stale"

export interface Lock {
  sessionID: string
  owner: string
  touchedAt: number
  status: LockStatus
}

export function acquireLock(filePathHash: string, sessionID: string, owner: string): void {
  const lockPath = join(getLocksDir(), `${filePathHash}.json`)
  const lock: Lock = { sessionID, owner, touchedAt: Date.now(), status: "acquired" }
  mkdirSync(dirname(lockPath), { recursive: true })
  writeFileSync(lockPath, JSON.stringify(lock))
}

export function setLockStatus(filePathHash: string, status: LockStatus): void {
  const lockPath = join(getLocksDir(), `${filePathHash}.json`)
  if (!existsSync(lockPath)) {
    return
  }
  const data = readFileSync(lockPath, "utf-8")
  const lock = JSON.parse(data) as Lock
  lock.status = status
  lock.touchedAt = Date.now()
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
  return Date.now() - lock.touchedAt > getStaleThresholdMs()
}

export function overrideLock(filePathHash: string, sessionID: string, owner: string): void {
  acquireLock(filePathHash, sessionID, owner)
}
