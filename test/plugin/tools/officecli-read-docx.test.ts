import { describe, it, expect } from "bun:test";
import { copyFile } from "node:fs/promises";
import path from "node:path";

import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

describe("officecli read DOCX", () => {
  const testFile = "/tmp/test-read.docx";
  const fixturePath = path.join(process.cwd(), "test/fixtures/sample.docx");
  setupHermeticDirs();
  cleanupTestFile(testFile);

  it("read DOCX returns markdown with extracted text", async () => {
    await copyFile(fixturePath, testFile);
    const result = await runTool(officecliTool, {
      action: "read",
      filePath: testFile,
    });
    expect(result).toContain("Hello DOCX");
  });
});
