import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

import { releaseLock, getLock, isLockStale } from "@/core/draft/lock";
import type { LockStatus } from "@/core/draft/lock";
import { readSidecar, deleteSidecar } from "@/core/draft/sidecar";
import type { Sidecar } from "@/core/draft/sidecar";
import { renderAnnotationsToImage } from "@/core/format/annotate";
import { writeDocxFromMarkdown } from "@/core/format/backends/docx";
import { writeOfficeFromMarkdown } from "@/core/format/backends/office";
import { writePdfFromMarkdown } from "@/core/format/backends/pdf";
import { writeXlsxFromMarkdown } from "@/core/format/backends/xlsx";
import { detectFormat } from "@/core/format/detect";
import { applyMetadataToFile } from "@/core/format/metadata";
import { applyWatermarkToFile } from "@/core/format/watermark";
import {
  getDraftsDir,
  getHistoryDir,
  getFilePathHash,
} from "@/core/storage/paths";
import {
  registerDraft,
  unregisterDraft,
  getRegisteredPath,
} from "@/core/storage/registry";

interface AcceptPoint {
  timestamp: number;
  snapshot: string;
  sessionID: string;
  sidecar: Sidecar | null;
}

export interface ActiveDraft {
  filePath: string;
  sessionID: string;
  ageSeconds: number;
  lockStatus: LockStatus | "none";
  orphaned: boolean;
}

export const getDraftPath = (
  filePathHash: string,
  sessionID: string,
  ext: string
): string => path.join(getDraftsDir(), filePathHash, `${sessionID}${ext}`);

export const draftExists = (
  filePathHash: string,
  sessionID: string
): boolean => {
  const draftDir = path.join(getDraftsDir(), filePathHash);
  if (!existsSync(draftDir)) {
    return false;
  }
  const files = readdirSync(draftDir);
  return files.some((f: string) => f.startsWith(sessionID));
};

export const createDraft = (
  absolutePath: string,
  sessionID: string,
  content: string
): void => {
  const filePathHash = getFilePathHash(absolutePath);
  const ext = path.extname(absolutePath);
  const draftPath = getDraftPath(filePathHash, sessionID, ext);
  mkdirSync(path.dirname(draftPath), { recursive: true });
  writeFileSync(draftPath, content);
  registerDraft(absolutePath);
};

const publishDraftContent = async (
  absolutePath: string,
  draftPath: string,
  draftBuf: Buffer,
  format: string,
  sidecar: Sidecar | null
): Promise<boolean> => {
  // Copy draft to real file (with conversion for binary formats)
  // ponytail: draft may be a real OOXML zip (seeded for comment/track) — detect PK and copy, else markdown→write
  const isZip =
    draftBuf.length >= 2 && draftBuf[0] === 0x50 && draftBuf[1] === 0x4b;
  if (format === "docx") {
    if (isZip) {
      copyFileSync(draftPath, absolutePath);
    } else {
      await writeDocxFromMarkdown(draftBuf.toString("utf-8"), absolutePath);
    }
  } else if (format === "pptx") {
    if (isZip) {
      copyFileSync(draftPath, absolutePath);
    } else {
      await writeOfficeFromMarkdown(draftBuf.toString("utf-8"), absolutePath);
    }
  } else if (format === "xlsx") {
    if (isZip) {
      copyFileSync(draftPath, absolutePath);
    } else {
      await writeXlsxFromMarkdown(draftBuf.toString("utf-8"), absolutePath);
    }
  } else if (format === "pdf") {
    // ponytail: pdf draft is markdown; if somehow binary PDF (%PDF) was seeded, copy
    const isPdf =
      draftBuf.length >= 4 && draftBuf.toString("utf-8", 0, 4) === "%PDF";
    if (isPdf || isZip) {
      copyFileSync(draftPath, absolutePath);
    } else {
      await writePdfFromMarkdown(draftBuf.toString("utf-8"), absolutePath);
    }
  } else if (format === "image") {
    if (sidecar?.annotations && sidecar.annotations.length > 0) {
      await renderAnnotationsToImage(absolutePath, sidecar.annotations);
    }
    // Without annotations the image draft holds OCR text, not image content:
    // the real file is left untouched rather than overwritten with markdown.
  } else {
    copyFileSync(draftPath, absolutePath);
  }
  return isZip;
};

const applySidecarMutations = async (
  absolutePath: string,
  filePathHash: string,
  sessionID: string,
  sidecar: Sidecar
): Promise<void> => {
  // Apply non-content mutations from the sidecar
  if (sidecar.metadata) {
    await applyMetadataToFile(absolutePath, sidecar.metadata);
  }
  if (sidecar.watermark) {
    await applyWatermarkToFile(absolutePath, sidecar.watermark);
  }
  deleteSidecar(filePathHash, sessionID);
};

const recordAcceptPoint = (
  filePathHash: string,
  sessionID: string,
  ext: string,
  draftBuf: Buffer,
  isZip: boolean,
  sidecar: Sidecar | null,
  timestamp?: number
): void => {
  // Record accept-point
  // ponytail: binary zip snapshot can't JSON-store as utf-8 (would be PK garbage) — keep placeholder; proper binary history if revert matters
  let snapshot: string;
  try {
    snapshot = isZip
      ? `[binary ${ext} ${draftBuf.length} bytes]`
      : draftBuf.toString("utf-8");
  } catch {
    snapshot = `[binary ${ext}]`;
  }
  const acceptPoint: AcceptPoint = {
    sessionID,
    sidecar,
    snapshot,
    timestamp: timestamp ?? Date.now(),
  };
  const historyPath = path.join(getHistoryDir(), `${filePathHash}.json`);
  let history: AcceptPoint[] = [];
  if (existsSync(historyPath)) {
    history = JSON.parse(readFileSync(historyPath, "utf-8"));
  }
  history.push(acceptPoint);
  // ponytail: ensure history dir exists for fresh dataDir (cheap, fixes ENOENT on first accept)
  mkdirSync(getHistoryDir(), { recursive: true });
  writeFileSync(historyPath, JSON.stringify(history));
};

export const acceptDraft = async (
  absolutePath: string,
  sessionID: string,
  timestamp?: number
): Promise<void> => {
  const filePathHash = getFilePathHash(absolutePath);
  const ext = path.extname(absolutePath);
  const draftPath = getDraftPath(filePathHash, sessionID, ext);
  const format = detectFormat(absolutePath);
  const sidecar = readSidecar(filePathHash, sessionID);

  const draftBuf = readFileSync(draftPath);
  const isZip = await publishDraftContent(
    absolutePath,
    draftPath,
    draftBuf,
    format,
    sidecar
  );

  if (sidecar) {
    await applySidecarMutations(absolutePath, filePathHash, sessionID, sidecar);
  }
  recordAcceptPoint(
    filePathHash,
    sessionID,
    ext,
    draftBuf,
    isZip,
    sidecar,
    timestamp
  );

  // Clean up draft
  unlinkSync(draftPath);
  unregisterDraft(filePathHash);

  // Release lock
  releaseLock(filePathHash);
};

export const undoDraft = (absolutePath: string, sessionID: string): void => {
  const filePathHash = getFilePathHash(absolutePath);
  const ext = path.extname(absolutePath);
  const draftPath = getDraftPath(filePathHash, sessionID, ext);

  // Delete draft
  if (existsSync(draftPath)) {
    unlinkSync(draftPath);
  }
  deleteSidecar(filePathHash, sessionID);
  unregisterDraft(filePathHash);
};

export const listActiveDrafts = (): ActiveDraft[] => {
  const draftsDir = getDraftsDir();
  if (!existsSync(draftsDir)) {
    return [];
  }
  const result: ActiveDraft[] = [];
  for (const filePathHash of readdirSync(draftsDir)) {
    const hashDir = path.join(draftsDir, filePathHash);
    const lock = getLock(filePathHash);
    const stale = isLockStale(filePathHash);
    for (const file of readdirSync(hashDir)) {
      const ext = path.extname(file);
      const sessionID = ext ? file.slice(0, -ext.length) : file;
      const ageBase = lock
        ? lock.touchedAt
        : statSync(path.join(hashDir, file)).mtimeMs;
      const ageSeconds = Math.max(0, Math.round((Date.now() - ageBase) / 1000));
      let lockStatus: LockStatus | "none";
      let orphaned = false;
      if (!lock || lock.sessionID !== sessionID) {
        lockStatus = "none";
        orphaned = true;
      } else if (stale) {
        lockStatus = "stale";
        orphaned = true;
      } else {
        lockStatus = lock.status;
      }
      result.push({
        ageSeconds,
        filePath: getRegisteredPath(filePathHash) ?? "unknown",
        lockStatus,
        orphaned,
        sessionID,
      });
    }
  }
  return result;
};

export const getDraftSessions = (filePathHash: string): string[] => {
  const hashDir = path.join(getDraftsDir(), filePathHash);
  if (!existsSync(hashDir)) {
    return [];
  }
  return readdirSync(hashDir).map((f) => {
    const ext = path.extname(f);
    return ext ? f.slice(0, -ext.length) : f;
  });
};

export const getHistory = (filePathHash: string): AcceptPoint[] => {
  const historyPath = path.join(getHistoryDir(), `${filePathHash}.json`);
  if (!existsSync(historyPath)) {
    return [];
  }
  return JSON.parse(readFileSync(historyPath, "utf-8"));
};

export const getSnapshot = (
  filePathHash: string,
  timestamp: number
): string | null => {
  const history = getHistory(filePathHash);
  const acceptPoint = history.find((ap) => ap.timestamp === timestamp);
  return acceptPoint ? acceptPoint.snapshot : null;
};

export const getSnapshotSidecar = (
  filePathHash: string,
  timestamp: number
): Sidecar | null => {
  const history = getHistory(filePathHash);
  const acceptPoint = history.find((ap) => ap.timestamp === timestamp);
  return acceptPoint ? acceptPoint.sidecar : null;
};
