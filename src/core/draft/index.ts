import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "node:fs";
// Draft lifecycle module: the only Draft surface the plugin layer may import.
// Owns hashing, locks, Registry registration, Sidecars, snapshots, and the
// draft-file IO. Callers state intent + session identity; the hash/lock
// preamble lives exactly once, here.
import nodePath from "node:path";

import { readMetadata } from "@/core/format/metadata";
import type { FileMetadata } from "@/core/format/metadata";
import { readRealFileAsMarkdown } from "@/core/format/read";
import { getDraftsDir, getFilePathHash } from "@/core/storage/paths";
import { registerDraft } from "@/core/storage/registry";
import type { TemplateData } from "@/core/template/generate";
import { substituteOoxml } from "@/core/template/substitute-ooxml";

import * as lock from "./lock";
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
} from "./manager";
import type { ActiveDraft } from "./manager";
import { readSidecar, writeSidecar } from "./sidecar";
import type { Sidecar, WatermarkConfig, AnnotationOp } from "./sidecar";

export { type ActiveDraft } from "./manager";

export type {
  WatermarkConfig,
  WatermarkPosition,
  AnnotationOp,
  AnnotationRect,
  AnnotationPosition,
} from "./sidecar";

export class DraftError extends Error {
  name = "DraftError";
}

export const hashOf = (filePath: string): string => getFilePathHash(filePath);

export const draftPath = (filePath: string, sessionID: string): string =>
  nodePath.join(
    getDraftsDir(),
    getFilePathHash(filePath),
    `${sessionID}${nodePath.extname(filePath)}`
  );

export const exists = (filePath: string, sessionID: string): boolean =>
  draftExists(getFilePathHash(filePath), sessionID);

export const draftSessions = (filePath: string): string[] =>
  getDraftSessions(getFilePathHash(filePath));

export const mostRecentDraftSession = (
  filePath: string
): string | undefined => {
  const dir = nodePath.join(getDraftsDir(), getFilePathHash(filePath));
  if (!existsSync(dir)) {
    return undefined;
  }
  const entries = readdirSync(dir).map((file) => {
    const e = nodePath.extname(file);
    return {
      mtime: statSync(nodePath.join(dir, file)).mtimeMs,
      session: e ? file.slice(0, -e.length) : file,
    };
  });
  if (entries.length === 0) {
    return undefined;
  }
  let [latest] = entries;
  for (const entry of entries.slice(1)) {
    if (entry.mtime >= latest.mtime) {
      latest = entry;
    }
  }
  return latest.session;
};

export const requireOwned = (
  filePath: string,
  sessionID: string,
  message: string
): void => {
  const l = lock.getLock(getFilePathHash(filePath));
  if (!l || l.sessionID !== sessionID) {
    throw new DraftError(message);
  }
};

export const requireDraftExists = (
  filePath: string,
  sessionID: string,
  message = "draft not found"
): void => {
  if (!exists(filePath, sessionID)) {
    throw new DraftError(message);
  }
};

export const assertNoForeignLock = (
  filePath: string,
  sessionID: string,
  allowStale: boolean,
  label = filePath
): void => {
  const hash = getFilePathHash(filePath);
  const l = lock.getLock(hash);
  if (
    l &&
    l.sessionID !== sessionID &&
    (!allowStale || !lock.isLockStale(hash))
  ) {
    throw new DraftError(`lock on ${label} held by session ${l.sessionID}`);
  }
};

export const create = (
  filePath: string,
  sessionID: string,
  owner: string,
  content: string
): void => {
  lock.acquireLock(getFilePathHash(filePath), sessionID, owner);
  createDraft(filePath, sessionID, content);
};

export const write = (
  filePath: string,
  sessionID: string,
  content: string | Uint8Array
): void => {
  writeFileSync(draftPath(filePath, sessionID), content);
};

// ponytail: comment/track drafts hold real OOXML — sniff PK, extract text, never dump zip bytes
export const draftMarkdown = (
  filePath: string,
  sessionID: string
): Promise<string> => {
  const path = draftPath(filePath, sessionID);
  const buf = readFileSync(path);
  const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    return readRealFileAsMarkdown(path);
  }
  return Promise.resolve(buf.toString("utf-8"));
};

export const cloneIntoDraft = (
  filePath: string,
  sessionID: string,
  owner: string,
  buffer: Uint8Array
): void => {
  const hash = getFilePathHash(filePath);
  lock.acquireLock(hash, sessionID, owner);
  const target = nodePath.join(
    getDraftsDir(),
    hash,
    `${sessionID}${nodePath.extname(filePath)}`
  );
  mkdirSync(nodePath.dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  registerDraft(filePath);
};

export const accept = async (
  filePath: string,
  sessionID: string,
  timestamp?: number
): Promise<void> => {
  await acceptDraft(filePath, sessionID, timestamp);
};

// L3 Fidelity substitute: run-preserving {{placeholder}} replace on a Draft ZIP.
export const substituteInDraft = async (
  filePath: string,
  sessionID: string,
  data: TemplateData
): Promise<{ replaced: number; format: string }> => {
  const path = draftPath(filePath, sessionID);
  const buf = readFileSync(path);
  const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isZip) {
    throw new DraftError(
      "substitute only supported on OOXML drafts (clone first for L3)"
    );
  }
  const { buffer, replaced, format } = await substituteOoxml(buf, data);
  writeFileSync(path, buffer);
  return { format, replaced };
};

export const undo = (filePath: string, sessionID: string): void => {
  undoDraft(filePath, sessionID);
  lock.releaseLock(getFilePathHash(filePath));
};

export const revert = (
  filePath: string,
  sessionID: string,
  owner: string,
  timestamp: number
): void => {
  const hash = getFilePathHash(filePath);
  const snapshot = getSnapshot(hash, timestamp);
  if (!snapshot) {
    throw new DraftError("snapshot not found for timestamp");
  }
  lock.acquireLock(hash, sessionID, owner);
  createDraft(filePath, sessionID, snapshot);
  const sidecar = getSnapshotSidecar(hash, timestamp);
  if (sidecar) {
    writeSidecar(hash, sessionID, sidecar);
  }
};

export const history = (
  filePath: string
): { timestamp: number; sessionID: string }[] =>
  getHistory(getFilePathHash(filePath)).map((ap) => ({
    sessionID: ap.sessionID,
    timestamp: ap.timestamp,
  }));

export const listDrafts = (filterPath?: string): ActiveDraft[] => {
  if (!filterPath) {
    return listActiveDrafts();
  }
  return listActiveDrafts().filter(
    (d) =>
      d.filePath === filterPath ||
      nodePath.resolve(d.filePath) === nodePath.resolve(filterPath)
  );
};

export const status = (
  filePath: string
): {
  sessionID: string;
  owner: string;
  status: lock.LockStatus;
  stale: boolean;
  touchedAt: number;
} | null => {
  const hash = getFilePathHash(filePath);
  const l = lock.getLock(hash);
  if (!l) {
    return null;
  }
  return {
    owner: l.owner,
    sessionID: l.sessionID,
    stale: lock.isLockStale(hash),
    status: l.status,
    touchedAt: l.touchedAt,
  };
};

export const lockSession = (filePath: string): string | null =>
  lock.getLock(getFilePathHash(filePath))?.sessionID ?? null;

export const forceRelease = (
  filePath: string,
  sessionID: string,
  owner: string
): void => {
  const hash = getFilePathHash(filePath);
  if (!lock.getLock(hash)) {
    throw new DraftError(`no lock on ${filePath} to force release`);
  }
  if (!lock.isLockStale(hash)) {
    throw new DraftError(
      `lock on ${filePath} is not stale; force release allowed only on stale locks`
    );
  }
  lock.overrideLock(hash, sessionID, owner);
};

const readSidecarFor = (filePath: string, sessionID: string): Sidecar | null =>
  readSidecar(getFilePathHash(filePath), sessionID);

const writeSidecarFor = (
  filePath: string,
  sessionID: string,
  sidecar: Sidecar
): void => {
  writeSidecar(getFilePathHash(filePath), sessionID, sidecar);
};

// Intent-level Sidecar mutations: replace/clear/append semantics live here,
// the raw read–mutate–write pair is private. null / empty clears the key.
export const setSidecarMetadata = (
  filePath: string,
  sessionID: string,
  metadata: FileMetadata | null
): void => {
  const sidecar = readSidecarFor(filePath, sessionID) ?? {};
  if (metadata) {
    sidecar.metadata = metadata;
  } else {
    delete sidecar.metadata;
  }
  writeSidecarFor(filePath, sessionID, sidecar);
};

export const setSidecarWatermark = (
  filePath: string,
  sessionID: string,
  config: WatermarkConfig | null
): void => {
  const sidecar = readSidecarFor(filePath, sessionID) ?? {};
  if (config) {
    sidecar.watermark = config;
  } else {
    delete sidecar.watermark;
  }
  writeSidecarFor(filePath, sessionID, sidecar);
};

export const appendSidecarAnnotations = (
  filePath: string,
  sessionID: string,
  ops: AnnotationOp[]
): void => {
  const sidecar = readSidecarFor(filePath, sessionID) ?? {};
  if (ops.length === 0) {
    delete sidecar.annotations;
  } else {
    sidecar.annotations = [...(sidecar.annotations ?? []), ...ops];
  }
  writeSidecarFor(filePath, sessionID, sidecar);
};

// Effective metadata = real file properties overridden by pending Sidecar metadata
export const effectiveMetadata = async (
  filePath: string,
  sessionID: string
): Promise<FileMetadata> => {
  const real = await readMetadata(filePath);
  return { ...real, ...readSidecarFor(filePath, sessionID)?.metadata };
};
