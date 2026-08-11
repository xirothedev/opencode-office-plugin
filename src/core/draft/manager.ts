import { getDraftsDir, getHistoryDir, getFilePathHash } from "../storage/paths.js"
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, copyFileSync } from "fs"
import { join, dirname, extname } from "path"
import { releaseLock } from "./lock.js"

interface AcceptPoint {
  timestamp: number
  snapshot: string
  sessionID: string
}

export function getDraftPath(filePathHash: string, sessionID: string, ext: string): string {
  return join(getDraftsDir(), filePathHash, `${sessionID}${ext}`)
}

export function draftExists(filePathHash: string, sessionID: string): boolean {
  const draftDir = join(getDraftsDir(), filePathHash)
  if (!existsSync(draftDir)) return false
  const files = require("fs").readdirSync(draftDir)
  return files.some((f: string) => f.startsWith(sessionID))
}

export function createDraft(absolutePath: string, sessionID: string, content: string): void {
  const filePathHash = getFilePathHash(absolutePath)
  const ext = extname(absolutePath)
  const draftPath = getDraftPath(filePathHash, sessionID, ext)
  mkdirSync(dirname(draftPath), { recursive: true })
  writeFileSync(draftPath, content)
}

export function acceptDraft(absolutePath: string, sessionID: string): void {
  const filePathHash = getFilePathHash(absolutePath)
  const ext = extname(absolutePath)
  const draftPath = getDraftPath(filePathHash, sessionID, ext)

  // Copy draft to real file
  copyFileSync(draftPath, absolutePath)

  // Record accept-point
  const snapshot = readFileSync(draftPath, "utf-8")
  const acceptPoint: AcceptPoint = {
    timestamp: Date.now(),
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

  // Release lock
  releaseLock(filePathHash)
}
