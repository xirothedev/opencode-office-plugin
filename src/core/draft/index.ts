// Draft lifecycle module: the only Draft surface the plugin layer may import.
// Owns hashing, locks, Registry registration, Sidecars, snapshots, and the
// draft-file IO. Callers state intent + session identity; the hash/lock
// preamble lives exactly once, here.
import { dirname, extname, join, resolve } from "path"
import { writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs"
import { getDraftsDir, getFilePathHash } from "@/core/storage/paths"
import { registerDraft } from "@/core/storage/registry"
import * as lock from "./lock"
import {
  createDraft,
  acceptDraft,
  undoDraft,
  draftExists,
  getHistory,
  getSnapshot,
  getSnapshotSidecar,
  listActiveDrafts,
  getDraftSessions,
  type ActiveDraft,
} from "./manager"
import { readSidecar, writeSidecar, type Sidecar } from "./sidecar"

export type { ActiveDraft, Sidecar }
export type {
  WatermarkConfig,
  WatermarkPosition,
  AnnotationOp,
  AnnotationRect,
  AnnotationPosition,
} from "./sidecar"

export class DraftError extends Error {}

export function hashOf(filePath: string): string {
  return getFilePathHash(filePath)
}

export function draftPath(filePath: string, sessionID: string): string {
  return join(getDraftsDir(), getFilePathHash(filePath), `${sessionID}${extname(filePath)}`)
}

export function exists(filePath: string, sessionID: string): boolean {
  return draftExists(getFilePathHash(filePath), sessionID)
}

export function draftSessions(filePath: string): string[] {
  return getDraftSessions(getFilePathHash(filePath))
}

export function mostRecentDraftSession(filePath: string): string | undefined {
  const dir = join(getDraftsDir(), getFilePathHash(filePath))
  if (!existsSync(dir)) return undefined
  const entries = readdirSync(dir).map((file) => {
    const e = extname(file)
    return { session: e ? file.slice(0, -e.length) : file, mtime: statSync(join(dir, file)).mtimeMs }
  })
  return entries.reduce((a, b) => (b.mtime >= a.mtime ? b : a)).session
}

export function requireOwned(filePath: string, sessionID: string, message: string): void {
  const l = lock.getLock(getFilePathHash(filePath))
  if (!l || l.sessionID !== sessionID) {
    throw new DraftError(message)
  }
}

export function requireDraftExists(filePath: string, sessionID: string, message = "draft not found"): void {
  if (!exists(filePath, sessionID)) {
    throw new DraftError(message)
  }
}

export function assertNoForeignLock(filePath: string, sessionID: string, allowStale: boolean, label = filePath): void {
  const hash = getFilePathHash(filePath)
  const l = lock.getLock(hash)
  if (l && l.sessionID !== sessionID && (!allowStale || !lock.isLockStale(hash))) {
    throw new DraftError(`lock on ${label} held by session ${l.sessionID}`)
  }
}

export function create(filePath: string, sessionID: string, owner: string, content: string): void {
  lock.acquireLock(getFilePathHash(filePath), sessionID, owner)
  createDraft(filePath, sessionID, content)
}

export function write(filePath: string, sessionID: string, content: string | Buffer): void {
  writeFileSync(draftPath(filePath, sessionID), content)
}

export function cloneIntoDraft(filePath: string, sessionID: string, owner: string, buffer: Buffer): void {
  const hash = getFilePathHash(filePath)
  lock.acquireLock(hash, sessionID, owner)
  const target = join(getDraftsDir(), hash, `${sessionID}${extname(filePath)}`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, buffer)
  registerDraft(filePath)
}

export async function accept(filePath: string, sessionID: string, timestamp?: number): Promise<void> {
  await acceptDraft(filePath, sessionID, timestamp)
}

export function undo(filePath: string, sessionID: string): void {
  undoDraft(filePath, sessionID)
  lock.releaseLock(getFilePathHash(filePath))
}

export function revert(filePath: string, sessionID: string, owner: string, timestamp: number): void {
  const hash = getFilePathHash(filePath)
  const snapshot = getSnapshot(hash, timestamp)
  if (!snapshot) {
    throw new DraftError("snapshot not found for timestamp")
  }
  lock.acquireLock(hash, sessionID, owner)
  createDraft(filePath, sessionID, snapshot)
  const sidecar = getSnapshotSidecar(hash, timestamp)
  if (sidecar) {
    writeSidecar(hash, sessionID, sidecar)
  }
}

export function history(filePath: string): Array<{ timestamp: number; sessionID: string }> {
  return getHistory(getFilePathHash(filePath)).map((ap) => ({ timestamp: ap.timestamp, sessionID: ap.sessionID }))
}

export function listDrafts(filterPath?: string): ActiveDraft[] {
  if (!filterPath) return listActiveDrafts()
  return listActiveDrafts().filter(
    (d) => d.filePath === filterPath || resolve(d.filePath) === resolve(filterPath),
  )
}

export function status(filePath: string): { sessionID: string; owner: string; status: lock.LockStatus; stale: boolean; touchedAt: number } | null {
  const hash = getFilePathHash(filePath)
  const l = lock.getLock(hash)
  if (!l) return null
  return { sessionID: l.sessionID, owner: l.owner, status: l.status, stale: lock.isLockStale(hash), touchedAt: l.touchedAt }
}

export function lockSession(filePath: string): string | null {
  return lock.getLock(getFilePathHash(filePath))?.sessionID ?? null
}

export function forceRelease(filePath: string, sessionID: string, owner: string): void {
  const hash = getFilePathHash(filePath)
  if (!lock.getLock(hash)) {
    throw new DraftError(`no lock on ${filePath} to force release`)
  }
  if (!lock.isLockStale(hash)) {
    throw new DraftError(`lock on ${filePath} is not stale; force release allowed only on stale locks`)
  }
  lock.overrideLock(hash, sessionID, owner)
}

export function readSidecarFor(filePath: string, sessionID: string): Sidecar | null {
  return readSidecar(getFilePathHash(filePath), sessionID)
}

export function writeSidecarFor(filePath: string, sessionID: string, sidecar: Sidecar): void {
  writeSidecar(getFilePathHash(filePath), sessionID, sidecar)
}
