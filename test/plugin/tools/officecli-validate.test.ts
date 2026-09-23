import { describe, it, expect } from "bun:test";

import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

describe("officecli validate action", () => {
  const testFile = "/tmp/officecli-validate.txt";
  setupHermeticDirs();
  cleanupTestFile(testFile);

  it("reports pass for every rule that matches the draft", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Invoice 2024-015\nSigned by: Manager\n",
      filePath: testFile,
    });
    const result = await runTool(officecliTool, {
      action: "validate",
      filePath: testFile,
      rules: JSON.stringify([
        { pattern: "Invoice", type: "regex" },
        { pattern: "Signed by", type: "required" },
      ]),
    });
    expect(result).toContain("2 rules, 2 passed, 0 failed");
    expect(result).toContain('pass: regex "Invoice"');
    expect(result).toContain('pass: required "Signed by"');
  });

  it("reports failed rules individually without blocking", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "no signature here\n",
      filePath: testFile,
    });
    const result = await runTool(officecliTool, {
      action: "validate",
      filePath: testFile,
      rules: JSON.stringify([
        { pattern: "^DRAFT$", type: "regex" },
        { pattern: "Signature", type: "required" },
      ]),
    });
    expect(result).toContain("2 rules, 0 passed, 2 failed");
    expect(result).toContain('fail: regex "^DRAFT$"');
    expect(result).toContain('fail: required "Signature"');
  });

  it("errors when there is no draft", async () => {
    await expect(
      runTool(officecliTool, {
        action: "validate",
        filePath: testFile,
        rules: JSON.stringify([{ pattern: "x", type: "required" }]),
      })
    ).rejects.toThrow(/no active draft to validate/u);
  });

  it("errors on invalid rules JSON", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "content",
      filePath: testFile,
    });
    await expect(
      runTool(officecliTool, {
        action: "validate",
        filePath: testFile,
        rules: "{not json",
      })
    ).rejects.toThrow(/invalid rules JSON/u);
  });

  it("errors on a rule with an unknown type", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "content",
      filePath: testFile,
    });
    await expect(
      runTool(officecliTool, {
        action: "validate",
        filePath: testFile,
        rules: JSON.stringify([{ pattern: "x", type: "schema" }]),
      })
    ).rejects.toThrow(/rule 0 has unknown type schema/u);
  });

  it("errors on an invalid regex pattern", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "content",
      filePath: testFile,
    });
    await expect(
      runTool(officecliTool, {
        action: "validate",
        filePath: testFile,
        rules: JSON.stringify([{ pattern: "(", type: "regex" }]),
      })
    ).rejects.toThrow(/invalid regex pattern/u);
  });

  it("requires filePath and rules", async () => {
    await expect(
      runTool(officecliTool, { action: "validate", filePath: testFile })
    ).rejects.toThrow(/rules|filePath/u);
  });
});
