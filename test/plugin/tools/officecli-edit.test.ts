import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";

import { getDraftPath } from "@/core/draft/manager";
import { getFilePathHash } from "@/core/storage/paths";
import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs } from "./harness";

describe("officecli edit action", () => {
  const testFile = "/tmp/edit-test.docx";
  const testHash = getFilePathHash(testFile);
  setupHermeticDirs();

  it("edit updates draft content", async () => {
    // Create draft first
    await runTool(officecliTool, {
      action: "create",
      content: "initial content",
      filePath: testFile,
    });

    // Edit draft
    const result = await runTool(officecliTool, {
      action: "edit",
      content: "updated content",
      filePath: testFile,
    });
    expect(result).toContain("edited");

    // Verify draft updated
    const draftPath = getDraftPath(testHash, "test-session", ".docx");
    const draftContent = await readFile(draftPath, "utf-8");
    expect(draftContent).toBe("updated content");
  });

  it("edit requires active lock", async () => {
    // Try edit without creating draft first
    await expect(
      runTool(officecliTool, {
        action: "edit",
        content: "updated",
        filePath: testFile,
      })
    ).rejects.toThrow(/no active draft to edit/u);
  });
});
