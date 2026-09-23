import { describe, it, expect } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

describe("officecli diff action", () => {
  const testFile = "/tmp/officecli-diff.txt";
  setupHermeticDirs();
  cleanupTestFile(testFile);

  it("returns a unified diff between real file and draft", async () => {
    await writeFile(testFile, "line one\nline two\nline three\n");
    await runTool(officecliTool, {
      action: "create",
      content: "line one\nline two changed\nline three\n",
      filePath: testFile,
    });
    const result = await runTool(officecliTool, {
      action: "diff",
      filePath: testFile,
    });
    expect(result).toContain("-line two");
    expect(result).toContain("+line two changed");
  });

  it("reports no differences when draft equals the real file", async () => {
    await writeFile(testFile, "same content\n");
    await runTool(officecliTool, {
      action: "create",
      content: "same content\n",
      filePath: testFile,
    });
    const result = await runTool(officecliTool, {
      action: "diff",
      filePath: testFile,
    });
    expect(result).not.toContain("@@");
  });

  it("errors when no draft exists", async () => {
    await writeFile(testFile, "content\n");
    await expect(
      runTool(officecliTool, { action: "diff", filePath: testFile })
    ).rejects.toThrow(/no active draft to diff/u);
  });

  it("names the other session when a draft exists but not for this session", async () => {
    await writeFile(testFile, "content\n");
    await runTool(
      officecliTool,
      {
        action: "create",
        content: "other session's draft\n",
        filePath: testFile,
      },
      {
        sessionID: "other-session",
      }
    );
    await expect(
      runTool(officecliTool, { action: "diff", filePath: testFile })
    ).rejects.toThrow(
      /no draft for this session; draft held by session other-session/u
    );
  });

  it("errors when the real file does not exist", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "draft only\n",
      filePath: testFile,
    });
    await expect(
      runTool(officecliTool, { action: "diff", filePath: testFile })
    ).rejects.toThrow(/file not found/u);
  });

  it("diffs a docx draft against the extracted real file", async () => {
    const docxPath = path.resolve("test/fixtures/sample.docx");
    const result = await runTool(officecliTool, {
      action: "create",
      content: "Some draft content with changes.\n",
      filePath: docxPath,
    });
    expect(result).toContain("Draft created");
    const diff = await runTool(officecliTool, {
      action: "diff",
      filePath: docxPath,
    });
    expect(diff).toContain("+Some draft content with changes.");
  });
});
