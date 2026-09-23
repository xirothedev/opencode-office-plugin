import { describe, it, expect } from "bun:test";
import { readdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { getLocksDir } from "@/core/storage/paths";
import { editTool } from "@/plugin/tools/edit";
import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

const list = async (): Promise<unknown> => {
  const result = await runTool(officecliTool, { action: "list" });
  return JSON.parse(result);
};

describe("officecli list action", () => {
  const testFileA = "/tmp/officecli-list-a.txt";
  const testFileB = "/tmp/officecli-list-b.txt";
  setupHermeticDirs();
  cleanupTestFile(testFileA);
  cleanupTestFile(testFileB);

  it("returns one entry per active draft with path, session, age and lock status", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "a",
      filePath: testFileA,
    });
    const drafts = await list();
    expect(drafts).toEqual([
      {
        ageSeconds: expect.any(Number),
        filePath: testFileA,
        lockStatus: "acquired",
        orphaned: false,
        sessionID: "test-session",
      },
    ]);
  });

  it("returns an empty array when no drafts exist", async () => {
    expect(await list()).toEqual([]);
  });

  it("shows drafts across multiple files", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "a",
      filePath: testFileA,
    });
    await runTool(officecliTool, {
      action: "create",
      content: "b",
      filePath: testFileB,
    });
    const drafts = (await list()) as { filePath: string }[];
    expect(drafts.map((d) => d.filePath).toSorted()).toEqual(
      [testFileA, testFileB].toSorted()
    );
  });

  it("marks a draft without a lock as orphaned", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "a",
      filePath: testFileA,
    });
    const lockFiles = readdirSync(getLocksDir());
    for (const lockFile of lockFiles) {
      rmSync(path.join(getLocksDir(), lockFile));
    }
    const drafts = await list();
    expect(drafts).toEqual([
      {
        ageSeconds: expect.any(Number),
        filePath: testFileA,
        lockStatus: "none",
        orphaned: true,
        sessionID: "test-session",
      },
    ]);
  });

  it("filters to one file when filePath is given", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "a",
      filePath: testFileA,
    });
    await runTool(officecliTool, {
      action: "create",
      content: "b",
      filePath: testFileB,
    });
    const result = await runTool(officecliTool, {
      action: "list",
      filePath: testFileA,
    });
    const drafts = JSON.parse(result);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].filePath).toBe(testFileA);
  });

  it("removes the entry when the draft is accepted", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "a",
      filePath: testFileA,
    });
    await runTool(officecliTool, { action: "accept", filePath: testFileA });
    expect(await list()).toEqual([]);
  });

  it("removes the entry when the draft is undone", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "a",
      filePath: testFileA,
    });
    await runTool(officecliTool, { action: "undo", filePath: testFileA });
    expect(await list()).toEqual([]);
  });

  it("registers the path when the edit override lazily creates a draft", async () => {
    await writeFile(testFileA, "original content");
    const result = await runTool(editTool, {
      filePath: testFileA,
      newString: "changed",
      oldString: "original",
    });
    expect(result).toContain("Edit applied");
    const drafts = await list();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].filePath).toBe(testFileA);
  });

  it("matches the filter across path forms via resolve", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "a",
      filePath: "./tmp/officecli-list-rel.txt",
    });
    const result = await runTool(officecliTool, {
      action: "list",
      filePath: "tmp/officecli-list-rel.txt",
    });
    const drafts = JSON.parse(result);
    expect(drafts).toHaveLength(1);
  });
});
