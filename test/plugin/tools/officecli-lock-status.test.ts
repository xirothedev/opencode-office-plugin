import { describe, it, expect } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getLocksDir, getFilePathHash } from "@/core/storage/paths";
import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

describe("officecli lock-status action", () => {
  const testFile = "/tmp/officecli-lock-status.txt";
  setupHermeticDirs();
  cleanupTestFile(testFile);

  const writeStaleLock = (sessionID: string, owner: string): void => {
    const lockPath = path.join(
      getLocksDir(),
      `${getFilePathHash(testFile)}.json`
    );
    writeFileSync(
      lockPath,
      JSON.stringify({
        owner,
        sessionID,
        status: "acquired",
        touchedAt: Date.now() - 25 * 60 * 60 * 1000,
      })
    );
  };

  it("returns lock details including owner and staleness", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "content",
      filePath: testFile,
    });
    const result = await runTool(officecliTool, {
      action: "lock-status",
      filePath: testFile,
    });
    const lock = JSON.parse(result);
    expect(lock.sessionID).toBe("test-session");
    expect(lock.owner).toBe("test-agent");
    expect(lock.status).toBe("acquired");
    expect(lock.stale).toBe(false);
    expect(lock.touchedAt).toBeTypeOf("number");
  });

  it("reports no lock for an unlocked file", async () => {
    const result = await runTool(officecliTool, {
      action: "lock-status",
      filePath: testFile,
    });
    expect(result).toContain("no lock");
  });

  it("requires filePath", async () => {
    await expect(
      runTool(officecliTool, { action: "lock-status" })
    ).rejects.toThrow(/filePath/u);
  });

  it("force-release refuses when there is no lock", async () => {
    await expect(
      runTool(officecliTool, { action: "force-release", filePath: testFile })
    ).rejects.toThrow(
      /no lock on \/tmp\/officecli-lock-status\.txt to force release/u
    );
  });

  it("force-release refuses a fresh foreign lock", async () => {
    await runTool(
      officecliTool,
      { action: "create", content: "content", filePath: testFile },
      {
        agent: "other-agent",
        sessionID: "other-session",
      }
    );
    await expect(
      runTool(officecliTool, { action: "force-release", filePath: testFile })
    ).rejects.toThrow(
      /lock on \/tmp\/officecli-lock-status\.txt is not stale/u
    );
    const lockPath = path.join(
      getLocksDir(),
      `${getFilePathHash(testFile)}.json`
    );
    expect(JSON.parse(readFileSync(lockPath, "utf-8")).sessionID).toBe(
      "other-session"
    );
  });

  it("force-release takes over a stale foreign lock", async () => {
    writeStaleLock("other-session", "other-agent");
    const result = await runTool(officecliTool, {
      action: "force-release",
      filePath: testFile,
    });
    expect(result).toContain("Force released");
    const lockPath = path.join(
      getLocksDir(),
      `${getFilePathHash(testFile)}.json`
    );
    const lock = JSON.parse(readFileSync(lockPath, "utf-8"));
    expect(lock.sessionID).toBe("test-session");
    expect(lock.owner).toBe("test-agent");
  });

  it("force-release requires filePath", async () => {
    await expect(
      runTool(officecliTool, { action: "force-release" })
    ).rejects.toThrow(/filePath/u);
  });
});
