import { getDraftsDir, getHistoryDir, getFilePathHash } from "../storage/paths.js"
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, copyFileSync, readdirSync } from "fs"
import { join, dirname, extname } from "path"
import { releaseLock } from "./lock.js"
import { detectFormat } from "../format/detect.js"
import { writeOfficeFromMarkdown } from "../format/backends/office.js"

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
  const files = readdirSync(draftDir)
  return files.some((f: string) => f.startsWith(sessionID))
}

export function createDraft(absolutePath: string, sessionID: string, content: string): void {
  const filePathHash = getFilePathHash(absolutePath)
  const ext = extname(absolutePath)
  const draftPath = getDraftPath(filePathHash, sessionID, ext)
  mkdirSync(dirname(draftPath), { recursive: true })
  writeFileSync(draftPath, content)
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
