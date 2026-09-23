import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";

import { getStaleThresholdMs } from "@/core/options";
import { getLocksDir } from "@/core/storage/paths";

export type LockStatus = "acquired" | "in-review" | "stale";

export interface Lock {
  sessionID: string;
  owner: string;
  touchedAt: number;
  status: LockStatus;
}

export const acquireLock = (
  filePathHash: string,
  sessionID: string,
  owner: string
): void => {
  const lockPath = path.join(getLocksDir(), `${filePathHash}.json`);
  const lock: Lock = {
    owner,
    sessionID,
    status: "acquired",
    touchedAt: Date.now(),
  };
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify(lock));
};

export const setLockStatus = (
  filePathHash: string,
  status: LockStatus
): void => {
  const lockPath = path.join(getLocksDir(), `${filePathHash}.json`);
  if (!existsSync(lockPath)) {
    return;
  }
  const data = readFileSync(lockPath, "utf-8");
  const lock = JSON.parse(data) as Lock;
  lock.status = status;
  lock.touchedAt = Date.now();
  writeFileSync(lockPath, JSON.stringify(lock));
};

export const releaseLock = (filePathHash: string): void => {
  const lockPath = path.join(getLocksDir(), `${filePathHash}.json`);
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
};

export const getLock = (filePathHash: string): Lock | null => {
  const lockPath = path.join(getLocksDir(), `${filePathHash}.json`);
  if (!existsSync(lockPath)) {
    return null;
  }
  const data = readFileSync(lockPath, "utf-8");
  return JSON.parse(data) as Lock;
};

export const isLockStale = (filePathHash: string): boolean => {
  const lock = getLock(filePathHash);
  if (!lock) {
    return false;
  }
  return Date.now() - lock.touchedAt > getStaleThresholdMs();
};

export const overrideLock = (
  filePathHash: string,
  sessionID: string,
  owner: string
): void => {
  acquireLock(filePathHash, sessionID, owner);
};
