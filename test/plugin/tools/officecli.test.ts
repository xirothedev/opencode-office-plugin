import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync, writeFileSync } from "node:fs";

import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

describe("officecli tool", () => {
  const testFile = "/tmp/officecli-test.txt";
  setupHermeticDirs();
  cleanupTestFile(testFile);

  it("create action creates draft", async () => {
    const result = await runTool(officecliTool, {
      action: "create",
      content: "test content",
      filePath: testFile,
    });
    expect(result).toContain("Draft created");
  });

  it("accept action writes real file", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "draft content",
      filePath: testFile,
    });
    const result = await runTool(officecliTool, {
      action: "accept",
      filePath: testFile,
    });
    expect(result).toContain("Accepted");
    expect(existsSync(testFile)).toBe(true);
    const content = readFileSync(testFile, "utf-8");
    expect(content).toBe("draft content");
  });

  it("create on a pre-existing document signals suggest-first", async () => {
    writeFileSync(testFile, "existing user content");
    const result = await runTool(officecliTool, {
      action: "create",
      content: "rewrite",
      filePath: testFile,
    });
    expect(result).toContain("pre-existing document");
    await runTool(officecliTool, { action: "undo", filePath: testFile });
  });

  it("rejects empty content", async () => {
    await expect(
      runTool(officecliTool, {
        action: "create",
        content: "",
        filePath: testFile,
      })
    ).rejects.toThrow(/length of at least 1/u);
    await expect(
      runTool(officecliTool, { action: "create", filePath: testFile })
    ).rejects.toThrow();
  });
});
