import { describe, it, expect } from "bun:test";
import { writeFileSync } from "node:fs";

import { editTool } from "@/plugin/tools/edit";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

describe("edit tool", () => {
  const testFile = "/tmp/edit-test.txt";
  const binaryFile = "/tmp/edit-test.docx";
  setupHermeticDirs();
  cleanupTestFile(testFile);
  cleanupTestFile(binaryFile);

  it("denies binary files", async () => {
    writeFileSync(binaryFile, "binary content");
    await expect(
      runTool(editTool, {
        filePath: binaryFile,
        newString: "new",
        oldString: "old",
      })
    ).rejects.toThrow(/use officecli tool for office\/PDF files/u);
  });

  it("edits text files via draft", async () => {
    writeFileSync(testFile, "hello world");
    const result = await runTool(editTool, {
      filePath: testFile,
      newString: "opencode",
      oldString: "world",
    });
    expect(result).toContain("applied to draft");
  });
});
