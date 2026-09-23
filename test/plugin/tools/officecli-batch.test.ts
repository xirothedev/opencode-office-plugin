import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getLocksDir, getFilePathHash } from "@/core/storage/paths";
import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

describe("officecli batch create/accept", () => {
  const fileA = "/tmp/officecli-batch-a.txt";
  const fileB = "/tmp/officecli-batch-b.txt";
  const fileC = "/tmp/officecli-batch-c.txt";
  setupHermeticDirs();
  cleanupTestFile(fileA);
  cleanupTestFile(fileB);
  cleanupTestFile(fileC);

  it("create with filePaths creates a draft for every path with the same content", async () => {
    const result = await runTool(officecliTool, {
      action: "create",
      content: "shared content",
      filePaths: JSON.stringify([fileA, fileB]),
    });
    expect(result).toContain("2 drafts");
    const readA = await runTool(officecliTool, {
      action: "read",
      filePath: fileA,
    });
    const readB = await runTool(officecliTool, {
      action: "read",
      filePath: fileB,
    });
    expect(readA).toBe("shared content");
    expect(readB).toBe("shared content");
  });

  it("create with filePaths aborts with no partial drafts when another session holds a lock", async () => {
    await runTool(
      officecliTool,
      { action: "create", content: "held", filePath: fileB },
      {
        sessionID: "other-session",
      }
    );
    await expect(
      runTool(officecliTool, {
        action: "create",
        content: "shared content",
        filePaths: JSON.stringify([fileA, fileB]),
      })
    ).rejects.toThrow(
      /lock on \/tmp\/officecli-batch-b\.txt held by session other-session/u
    );
    const list = await runTool(officecliTool, { action: "list" });
    const drafts = JSON.parse(list);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].filePath).toBe(fileB);
  });

  it("create with invalid filePaths JSON errors", async () => {
    await expect(
      runTool(officecliTool, {
        action: "create",
        content: "x",
        filePaths: "{not json",
      })
    ).rejects.toThrow(/invalid filePaths JSON/u);
  });

  it("create with a non-array filePaths errors", async () => {
    await expect(
      runTool(officecliTool, {
        action: "create",
        content: "x",
        filePaths: JSON.stringify("x"),
      })
    ).rejects.toThrow(/filePaths must be a non-empty array of strings/u);
  });

  it("accept with filePaths accepts all drafts", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "batch content",
      filePaths: JSON.stringify([fileA, fileB]),
    });
    const result = await runTool(officecliTool, {
      action: "accept",
      filePaths: JSON.stringify([fileA, fileB]),
    });
    expect(result).toContain("2 drafts");
    expect(readFileSync(fileA, "utf-8")).toBe("batch content");
    expect(readFileSync(fileB, "utf-8")).toBe("batch content");
  });

  it("accept with filePaths aborts with no partial accepts when one path has no draft", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "content",
      filePath: fileA,
    });
    await expect(
      runTool(officecliTool, {
        action: "accept",
        filePaths: JSON.stringify([fileA, fileB]),
      })
    ).rejects.toThrow(
      /no active draft to accept for \/tmp\/officecli-batch-b\.txt/u
    );
    expect(existsSync(fileA)).toBe(false);
    expect(existsSync(fileB)).toBe(false);
    const list = await runTool(officecliTool, { action: "list" });
    expect(JSON.parse(list)).toHaveLength(1);
  });

  it("create with empty filePaths array errors", async () => {
    await expect(
      runTool(officecliTool, {
        action: "create",
        content: "x",
        filePaths: "[]",
      })
    ).rejects.toThrow(/filePaths must be a non-empty array of strings/u);
  });

  it("accept with empty filePaths array errors", async () => {
    await expect(
      runTool(officecliTool, { action: "accept", filePaths: "[]" })
    ).rejects.toThrow(/filePaths must be a non-empty array of strings/u);
  });

  it("create with filePaths acquires over a stale foreign lock", async () => {
    const lockPath = path.join(getLocksDir(), `${getFilePathHash(fileB)}.json`);
    writeFileSync(
      lockPath,
      JSON.stringify({
        owner: "other-agent",
        sessionID: "other-session",
        status: "acquired",
        touchedAt: Date.now() - 25 * 60 * 60 * 1000,
      })
    );
    const result = await runTool(officecliTool, {
      action: "create",
      content: "shared content",
      filePaths: JSON.stringify([fileA, fileB]),
    });
    expect(result).toContain("2 drafts");
    const lockStatus = await runTool(officecliTool, {
      action: "lock-status",
      filePath: fileB,
    });
    expect(JSON.parse(lockStatus).sessionID).toBe("test-session");
  });

  it("accept with invalid filePaths JSON errors", async () => {
    await expect(
      runTool(officecliTool, { action: "accept", filePaths: "{not json" })
    ).rejects.toThrow(/invalid filePaths JSON/u);
  });
});
