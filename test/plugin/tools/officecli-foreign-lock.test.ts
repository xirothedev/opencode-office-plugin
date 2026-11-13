import { describe, it, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Tool } from "@opencode/schema/tool";

import { getDraftPath } from "@/core/draft/manager";
import {
  getFilePathHash,
  getHistoryDir,
  getLocksDir,
} from "@/core/storage/paths";
import { officecliTool } from "@/plugin/tools/officecli";

import { mockContext, runTool, setupHermeticDirs } from "./harness";

const mine = { ...mockContext, sessionID: "test-session" };
const stale = 48 * 60 * 60 * 1000;

const lockFile = (file: string): string =>
  path.join(getLocksDir(), `${getFilePathHash(file)}.json`);

const draftFile = (file: string): string =>
  getDraftPath(getFilePathHash(file), "test-session", ".docx");

const seedLock = (file: string, sessionID: string, ageMs: number): void => {
  mkdirSync(getLocksDir(), { recursive: true });
  writeFileSync(
    lockFile(file),
    JSON.stringify({
      owner: "agent",
      sessionID,
      status: "acquired",
      touchedAt: Date.now() - ageMs,
    })
  );
};

const seedHistory = (file: string): void => {
  mkdirSync(getHistoryDir(), { recursive: true });
  writeFileSync(
    path.join(getHistoryDir(), `${getFilePathHash(file)}.json`),
    JSON.stringify([
      {
        sessionID: "test-session",
        sidecar: null,
        snapshot: "v1",
        timestamp: 1000,
      },
    ])
  );
};

describe("officecli foreign lock", () => {
  setupHermeticDirs();

  it("create succeeds without a lock and takes it", async () => {
    const file = "/tmp/foreign-lock-fresh.docx";
    await runTool(
      officecliTool,
      { action: "create", content: "v1", filePath: file },
      mine
    );
    expect(existsSync(draftFile(file))).toBe(true);
    expect(JSON.parse(readFileSync(lockFile(file), "utf-8")).sessionID).toBe(
      "test-session"
    );
  });

  it("create rejects a stale foreign lock and leaves it alone", async () => {
    const file = "/tmp/foreign-lock-stale.docx";
    seedLock(file, "session-a", stale);
    const before = readFileSync(lockFile(file), "utf-8");
    await expect(
      runTool(
        officecliTool,
        { action: "create", content: "v1", filePath: file },
        mine
      )
    ).rejects.toBeInstanceOf(Tool.Error);
    expect(existsSync(draftFile(file))).toBe(false);
    expect(readFileSync(lockFile(file), "utf-8")).toBe(before);
  });

  it("batch create stops before any path when one is blocked", async () => {
    const open = "/tmp/foreign-lock-batch-open.docx";
    const blocked = "/tmp/foreign-lock-batch-blocked.docx";
    seedLock(blocked, "session-a", stale);
    await expect(
      runTool(
        officecliTool,
        {
          action: "create",
          content: "v1",
          filePaths: JSON.stringify([open, blocked]),
        },
        mine
      )
    ).rejects.toBeInstanceOf(Tool.Error);
    expect(existsSync(draftFile(open))).toBe(false);
    expect(existsSync(draftFile(blocked))).toBe(false);
  });

  it("revert picks up a snapshot without a lock", async () => {
    const file = "/tmp/foreign-lock-revert.docx";
    seedHistory(file);
    await runTool(
      officecliTool,
      { action: "revert", filePath: file, timestamp: 1000 },
      mine
    );
    expect(readFileSync(draftFile(file), "utf-8")).toBe("v1");
  });

  it("revert rejects a stale foreign lock", async () => {
    const file = "/tmp/foreign-lock-revert-stale.docx";
    seedHistory(file);
    seedLock(file, "session-a", stale);
    const before = readFileSync(lockFile(file), "utf-8");
    await expect(
      runTool(
        officecliTool,
        { action: "revert", filePath: file, timestamp: 1000 },
        mine
      )
    ).rejects.toBeInstanceOf(Tool.Error);
    expect(existsSync(draftFile(file))).toBe(false);
    expect(readFileSync(lockFile(file), "utf-8")).toBe(before);
  });
});
