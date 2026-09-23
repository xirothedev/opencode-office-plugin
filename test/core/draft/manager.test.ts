import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { acquireLock } from "@/core/draft/lock";
import {
  createDraft,
  acceptDraft,
  draftExists,
  getDraftPath,
} from "@/core/draft/manager";
import {
  getDraftsDir,
  getHistoryDir,
  getLocksDir,
  getFilePathHash,
} from "@/core/storage/paths";

describe("draft manager", () => {
  const testFile = "/tmp/test-real-file.txt";
  const testHash = getFilePathHash(testFile);
  const sessionA = "session-a";

  beforeEach(async () => {
    await mkdir(getDraftsDir(), { recursive: true });
    await mkdir(getHistoryDir(), { recursive: true });
    await mkdir(getLocksDir(), { recursive: true });
  });

  afterEach(async () => {
    await rm(getDraftsDir(), { force: true, recursive: true });
    await rm(getHistoryDir(), { force: true, recursive: true });
    await rm(getLocksDir(), { force: true, recursive: true });
  });

  it("createDraft creates draft file", () => {
    createDraft(testFile, sessionA, "test content");
    expect(draftExists(testHash, sessionA)).toBe(true);
  });

  it("draft file contains content", () => {
    createDraft(testFile, sessionA, "test content");
    const draftPath = getDraftPath(testHash, sessionA, ".txt");
    const content = readFileSync(draftPath, "utf-8");
    expect(content).toBe("test content");
  });

  it("acceptDraft writes real file", async () => {
    createDraft(testFile, sessionA, "draft content");
    acquireLock(testHash, sessionA);
    await acceptDraft(testFile, sessionA);
    expect(existsSync(testFile)).toBe(true);
    const content = readFileSync(testFile, "utf-8");
    expect(content).toBe("draft content");
  });

  it("acceptDraft records accept-point in history", async () => {
    createDraft(testFile, sessionA, "content");
    acquireLock(testHash, sessionA);
    await acceptDraft(testFile, sessionA);
    const historyPath = path.join(getHistoryDir(), `${testHash}.json`);
    expect(existsSync(historyPath)).toBe(true);
    const history = JSON.parse(readFileSync(historyPath, "utf-8"));
    expect(history).toHaveLength(1);
    expect(history[0].sessionID).toBe(sessionA);
    expect(history[0].snapshot).toBeDefined();
  });

  it("acceptDraft releases lock", async () => {
    createDraft(testFile, sessionA, "content");
    acquireLock(testHash, sessionA);
    await acceptDraft(testFile, sessionA);
    const lockPath = path.join(
      getDraftsDir(),
      "..",
      "locks",
      `${testHash}.json`
    );
    expect(existsSync(lockPath)).toBe(false);
  });
});
