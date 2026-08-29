import { getDraftsDir, getHistoryDir, getFilePathHash } from "@/core/storage/paths"
import { registerDraft, unregisterDraft, getRegisteredPath } from "@/core/storage/registry"
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, copyFileSync, readdirSync, statSync } from "fs"
import { join, dirname, extname } from "path"
import { releaseLock, getLock, isLockStale, type LockStatus } from "@/core/draft/lock"
import { detectFormat } from "@/core/format/detect"
import { writeOfficeFromMarkdown } from "@/core/format/backends/office"
import { writePdfFromMarkdown } from "@/core/format/backends/pdf"
import { writeXlsxFromMarkdown } from "@/core/format/backends/xlsx"
import { writeDocxFromMarkdown } from "@/core/format/backends/docx"
import { readSidecar, deleteSidecar, type Sidecar } from "@/core/draft/sidecar"
import { applyMetadataToFile } from "@/core/format/metadata"
import { applyWatermarkToFile } from "@/core/format/watermark"
import { renderAnnotationsToImage } from "@/core/format/annotate"

interface AcceptPoint {
  timestamp: number
  snapshot: string
  sessionID: string
  sidecar: Sidecar | null
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
  const sidecar = readSidecar(filePathHash, sessionID)

  // ponytail: draft may be a real OOXML zip (seeded for comment/track) — detect PK and copy, else markdown→write
  const draftBuf = readFileSync(draftPath)
  const isZip = draftBuf.length >= 2 && draftBuf[0] === 0x50 && draftBuf[1] === 0x4b

  // Copy draft to real file (with conversion for binary formats)
  if (format === "docx") {
    if (isZip) copyFileSync(draftPath, absolutePath)
    else await writeDocxFromMarkdown(draftBuf.toString("utf-8"), absolutePath)
  } else if (format === "pptx") {
    if (isZip) copyFileSync(draftPath, absolutePath)
    else await writeOfficeFromMarkdown(draftBuf.toString("utf-8"), absolutePath)
  } else if (format === "xlsx") {
    if (isZip) copyFileSync(draftPath, absolutePath)
    else await writeXlsxFromMarkdown(draftBuf.toString("utf-8"), absolutePath)
  } else if (format === "pdf") {
    // ponytail: pdf draft is markdown; if somehow binary PDF (%PDF) was seeded, copy
    const isPdf = draftBuf.length >= 4 && draftBuf.toString("utf-8", 0, 4) === "%PDF"
    if (isPdf || isZip) copyFileSync(draftPath, absolutePath)
    else await writePdfFromMarkdown(draftBuf.toString("utf-8"), absolutePath)
  } else if (format === "image") {
    if (sidecar?.annotations && sidecar.annotations.length > 0) {
      await renderAnnotationsToImage(absolutePath, sidecar.annotations)
    }
    // Without annotations the image draft holds OCR text, not image content:
    // the real file is left untouched rather than overwritten with markdown.
  } else {
    copyFileSync(draftPath, absolutePath)
  }

  // Apply non-content mutations from the sidecar
  if (sidecar) {
    if (sidecar.metadata) {
      await applyMetadataToFile(absolutePath, sidecar.metadata)
    }
    if (sidecar.watermark) {
      await applyWatermarkToFile(absolutePath, sidecar.watermark)
    }
    deleteSidecar(filePathHash, sessionID)
  }

  // Record accept-point
  // ponytail: binary zip snapshot can't JSON-store as utf-8 (would be PK garbage) — keep placeholder; proper binary history if revert matters
  let snapshot: string
  try {
    snapshot = isZip ? `[binary ${ext} ${draftBuf.length} bytes]` : draftBuf.toString("utf-8")
  } catch {
    snapshot = `[binary ${ext}]`
  }
  const acceptPoint: AcceptPoint = {
    timestamp: timestamp ?? Date.now(),
    snapshot,
    sessionID,
    sidecar,
  }
  const historyPath = join(getHistoryDir(), `${filePathHash}.json`)
  let history: AcceptPoint[] = []
  if (existsSync(historyPath)) {
    history = JSON.parse(readFileSync(historyPath, "utf-8"))
  }
  history.push(acceptPoint)
  // ponytail: ensure history dir exists for fresh dataDir (cheap, fixes ENOENT on first accept)
  mkdirSync(getHistoryDir(), { recursive: true })
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
  deleteSidecar(filePathHash, sessionID)
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

export function getSnapshotSidecar(filePathHash: string, timestamp: number): Sidecar | null {
  const history = getHistory(filePathHash)
  const acceptPoint = history.find((ap) => ap.timestamp === timestamp)
  return acceptPoint ? acceptPoint.sidecar : null
}
