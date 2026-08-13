import { getDraftsDir, getHistoryDir, getFilePathHash } from "../storage/paths.js"
import { registerDraft, unregisterDraft, getRegisteredPath } from "../storage/registry.js"
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, copyFileSync, readdirSync, statSync } from "fs"
import { join, dirname, extname } from "path"
import { releaseLock, getLock, isLockStale, type LockStatus } from "./lock.js"
import { detectFormat } from "../format/detect.js"
import { writeOfficeFromMarkdown } from "../format/backends/office.js"
import { writePdfFromMarkdown } from "../format/backends/pdf.js"

interface AcceptPoint {
  timestamp: number
  snapshot: string
  sessionID: string
}

export interface ActiveDraft {
  filePath: string
  sessionID: string
  ageSeconds: number
  lockStatus: LockStatus | "none"
  orphaned: boolean
}

export function getDraftPath(filePathHash: string, sessionID: string, ext: string): string {
  return join(getDraftsDir(), filePathHash, `${sessionID}${ext}`)
}

export function draftExists(filePathHash: string, sessionID: string): boolean {
  const draftDir = join(getDraftsDir(), filePathHash)
  if (!existsSync(draftDir)) return false
  const files = readdirSync(draftDir)
  return files.some((f: string) => f.startsWith(sessionID))
}

export function createDraft(absolutePath: string, sessionID: string, content: string): void {
  const filePathHash = getFilePathHash(absolutePath)
  const ext = extname(absolutePath)
  const draftPath = getDraftPath(filePathHash, sessionID, ext)
  mkdirSync(dirname(draftPath), { recursive: true })
  writeFileSync(draftPath, content)
  registerDraft(absolutePath)
}

export async function acceptDraft(absolutePath: string, sessionID: string, timestamp?: number): Promise<void> {
  const filePathHash = getFilePathHash(absolutePath)
  const ext = extname(absolutePath)
  const draftPath = getDraftPath(filePathHash, sessionID, ext)
  const format = detectFormat(absolutePath)

  // Copy draft to real file (with conversion for binary formats)
  if (format === "docx" || format === "xlsx" || format === "pptx") {
    const markdown = readFileSync(draftPath, "utf-8")
    await writeOfficeFromMarkdown(markdown, absolutePath)
  } else if (format === "pdf") {
    const markdown = readFileSync(draftPath, "utf-8")
    await writePdfFromMarkdown(markdown, absolutePath)
  } else {
    copyFileSync(draftPath, absolutePath)
  }

  // Record accept-point
  const snapshot = readFileSync(draftPath, "utf-8")
  const acceptPoint: AcceptPoint = {
    timestamp: timestamp ?? Date.now(),
    snapshot,
    sessionID,
  }
  const historyPath = join(getHistoryDir(), `${filePathHash}.json`)
  let history: AcceptPoint[] = []
  if (existsSync(historyPath)) {
    history = JSON.parse(readFileSync(historyPath, "utf-8"))
  }
  history.push(acceptPoint)
  writeFileSync(historyPath, JSON.stringify(history))

  // Clean up draft
  unlinkSync(draftPath)
  unregisterDraft(filePathHash)

  // Release lock
  releaseLock(filePathHash)
}

export function undoDraft(absolutePath: string, sessionID: string): void {
  const filePathHash = getFilePathHash(absolutePath)
  const ext = extname(absolutePath)
  const draftPath = getDraftPath(filePathHash, sessionID, ext)

  // Delete draft
  if (existsSync(draftPath)) {
    unlinkSync(draftPath)
  }
  unregisterDraft(filePathHash)
}

export function listActiveDrafts(): ActiveDraft[] {
  const draftsDir = getDraftsDir()
  if (!existsSync(draftsDir)) {
    return []
  }
  const result: ActiveDraft[] = []
  for (const filePathHash of readdirSync(draftsDir)) {
    const hashDir = join(draftsDir, filePathHash)
    const lock = getLock(filePathHash)
    const stale = isLockStale(filePathHash)
    for (const file of readdirSync(hashDir)) {
      const ext = extname(file)
      const sessionID = ext ? file.slice(0, -ext.length) : file
      const ageBase = lock ? lock.touchedAt : statSync(join(hashDir, file)).mtimeMs
      const ageSeconds = Math.max(0, Math.round((Date.now() - ageBase) / 1000))
      let lockStatus: LockStatus | "none"
      let orphaned = false
      if (!lock || lock.sessionID !== sessionID) {
        lockStatus = "none"
        orphaned = true
      } else if (stale) {
        lockStatus = "stale"
        orphaned = true
      } else {
        lockStatus = lock.status
      }
      result.push({
        filePath: getRegisteredPath(filePathHash) ?? "unknown",
        sessionID,
        ageSeconds,
        lockStatus,
        orphaned,
      })
    }
  }
  return result
}

export function getDraftSessions(filePathHash: string): string[] {
  const hashDir = join(getDraftsDir(), filePathHash)
  if (!existsSync(hashDir)) {
    return []
  }
  return readdirSync(hashDir).map((f) => {
    const ext = extname(f)
    return ext ? f.slice(0, -ext.length) : f
  })
}

export function getHistory(filePathHash: string): AcceptPoint[] {
  const historyPath = join(getHistoryDir(), `${filePathHash}.json`)
  if (!existsSync(historyPath)) {
    return []
  }
  return JSON.parse(readFileSync(historyPath, "utf-8"))
}

export function getSnapshot(filePathHash: string, timestamp: number): string | null {
  const history = getHistory(filePathHash)
  const acceptPoint = history.find((ap) => ap.timestamp === timestamp)
  return acceptPoint ? acceptPoint.snapshot : null
}
