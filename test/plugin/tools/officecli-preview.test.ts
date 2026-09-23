import { describe, it, expect, beforeEach, mock } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";

import { getFilePathHash } from "@/core/storage/paths";
import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

// ponytail: mock the owned spawn seam, never node:child_process (sharp imports spawnSync from it)
const pandocCalls: string[] = [];

mock.module("@/core/format/exec", () => ({
  runCommand: mock((cmd: string) => {
    pandocCalls.push(cmd);
    if (process.env.MOCK_PANDOC_FAIL === "1") {
      throw new Error("spawn pandoc ENOENT");
    }
  }),
}));

describe("officecli preview action", () => {
  const testFile = "/tmp/officecli-preview.txt";
  const previewDir = path.join(tmpdir(), "openoffice-preview");
  const previewPath = path.join(
    previewDir,
    `${getFilePathHash(testFile)}.html`
  );
  setupHermeticDirs();
  cleanupTestFile(testFile);
  cleanupTestFile(previewPath);

  beforeEach(() => {
    delete process.env.MOCK_PANDOC_FAIL;
    pandocCalls.length = 0;
  });

  const pandocCommands = (): string[] => [...pandocCalls];

  it("renders the draft to an HTML file via pandoc and returns its path", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Report\n\nHello.\n",
      filePath: testFile,
    });
    const result = await runTool(officecliTool, {
      action: "preview",
      filePath: testFile,
    });
    expect(result).toContain(previewPath);
    const commands = pandocCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('pandoc "');
    expect(commands[0]).toContain(`-o "${previewPath}"`);
  });

  it("errors when there is no draft", async () => {
    await expect(
      runTool(officecliTool, { action: "preview", filePath: testFile })
    ).rejects.toThrow(/no active draft to preview/u);
  });

  it("returns an error string when pandoc fails", async () => {
    process.env.MOCK_PANDOC_FAIL = "1";
    await runTool(officecliTool, {
      action: "create",
      content: "content",
      filePath: testFile,
    });
    await expect(
      runTool(officecliTool, { action: "preview", filePath: testFile })
    ).rejects.toThrow(/pandoc preview failed/u);
  });

  it("requires filePath", async () => {
    await expect(
      runTool(officecliTool, { action: "preview" })
    ).rejects.toThrow();
  });
});
