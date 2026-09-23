import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";

import {
  acquireLock,
  releaseLock,
  getLock,
  isLockStale,
  overrideLock,
} from "@/core/draft/lock";
import { getLocksDir, getFilePathHash } from "@/core/storage/paths";

describe("lock", () => {
  const testFile = "/test/file.docx";
  const testHash = getFilePathHash(testFile);
  const sessionA = "session-a";
  const sessionB = "session-b";

  beforeEach(async () => {
    await mkdir(getLocksDir(), { recursive: true });
  });

  afterEach(async () => {
    await rm(getLocksDir(), { force: true, recursive: true });
  });

  it("acquires lock", () => {
    acquireLock(testHash, sessionA, "agent-a");
    const lock = getLock(testHash);
    expect(lock).toBeDefined();
    expect(lock?.sessionID).toBe(sessionA);
  });

  it("lock records owner at acquire", () => {
    acquireLock(testHash, sessionA, "agent-a");
    const lock = getLock(testHash);
    expect(lock).toBeDefined();
    expect(lock?.owner).toBe("agent-a");
  });

  it("lock has touchedAt timestamp", () => {
    acquireLock(testHash, sessionA, "agent-a");
    const lock = getLock(testHash);
    expect(lock).toBeDefined();
    expect(lock?.touchedAt).toBeTypeOf("number");
    expect(lock?.touchedAt).toBeLessThan(Date.now() + 1000);
  });

  it("releases lock", () => {
    acquireLock(testHash, sessionA, "agent-a");
    releaseLock(testHash);
    const lock = getLock(testHash);
    expect(lock).toBeNull();
  });

  it("getLock returns null if no lock", () => {
    const lock = getLock(testHash);
    expect(lock).toBeNull();
  });

  it("isLockStale returns false for fresh lock", () => {
    acquireLock(testHash, sessionA, "agent-a");
    expect(isLockStale(testHash)).toBe(false);
  });

  it("overrideLock replaces lock with new session", () => {
    acquireLock(testHash, sessionA, "agent-a");
    overrideLock(testHash, sessionB, "agent-b");
    const lock = getLock(testHash);
    expect(lock).toBeDefined();
    expect(lock?.sessionID).toBe(sessionB);
    expect(lock?.owner).toBe("agent-b");
  });
});
