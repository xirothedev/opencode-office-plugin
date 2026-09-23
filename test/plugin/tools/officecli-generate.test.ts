import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

describe("officecli generate action", () => {
  const templateFile = "/tmp/officecli-template.md";
  const outA = "/tmp/officecli-gen-a.txt";
  const outB = "/tmp/officecli-gen-b.txt";
  setupHermeticDirs();
  cleanupTestFile(templateFile);
  cleanupTestFile(outA);
  cleanupTestFile(outB);

  it("creates one draft from a data object", async () => {
    await writeFile(templateFile, "Decision {{NUMBER}}\nDept: {{DEPT}}\n");
    const result = await runTool(officecliTool, {
      action: "generate",
      data: JSON.stringify({ DEPT: "Microbiology", NUMBER: 1 }),
      filePath: outA,
      templatePath: templateFile,
    });
    expect(result).toBe("Generated 1 drafts from /tmp/officecli-template.md");
    const read = await runTool(officecliTool, {
      action: "read",
      filePath: outA,
    });
    expect(read).toBe("Decision 1\nDept: Microbiology\n");
  });

  it("creates one locked draft per dataArray entry", async () => {
    await writeFile(templateFile, "{{DEPT}} decision {{NUMBER}}\n");
    const result = await runTool(officecliTool, {
      action: "generate",
      dataArray: JSON.stringify([
        { DEPT: "Microbiology", NUMBER: 1 },
        { DEPT: "Radiology", NUMBER: 2 },
      ]),
      filePaths: JSON.stringify([outA, outB]),
      templatePath: templateFile,
    });
    expect(result).toBe("Generated 2 drafts from /tmp/officecli-template.md");
    const readA = await runTool(officecliTool, {
      action: "read",
      filePath: outA,
    });
    const readB = await runTool(officecliTool, {
      action: "read",
      filePath: outB,
    });
    expect(readA).toBe("Microbiology decision 1\n");
    expect(readB).toBe("Radiology decision 2\n");
  });

  it("generated drafts accept normally", async () => {
    await writeFile(templateFile, "{{DEPT}}\n");
    await runTool(officecliTool, {
      action: "generate",
      data: JSON.stringify({ DEPT: "Cardiology" }),
      filePath: outA,
      templatePath: templateFile,
    });
    const accepted = await runTool(officecliTool, {
      action: "accept",
      filePath: outA,
    });
    expect(accepted).toContain("Accepted");
    expect(existsSync(outA)).toBe(true);
  });

  it("errors listing missing keys and creates no drafts", async () => {
    await writeFile(templateFile, "{{DEPT}} and {{NUMBER}}\n");
    await expect(
      runTool(officecliTool, {
        action: "generate",
        data: JSON.stringify({ DEPT: "X" }),
        filePath: outA,
        templatePath: templateFile,
      })
    ).rejects.toThrow(/missing template keys: NUMBER/u);
    const list = await runTool(officecliTool, { action: "list" });
    expect(JSON.parse(list)).toEqual([]);
  });

  it("errors on invalid data JSON", async () => {
    await writeFile(templateFile, "{{a}}\n");
    await expect(
      runTool(officecliTool, {
        action: "generate",
        data: "{not json",
        filePath: outA,
        templatePath: templateFile,
      })
    ).rejects.toThrow(/invalid data JSON/u);
  });

  it("errors when dataArray and filePaths lengths differ", async () => {
    await writeFile(templateFile, "{{a}}\n");
    await expect(
      runTool(officecliTool, {
        action: "generate",
        dataArray: JSON.stringify([{ a: "1" }, { a: "2" }]),
        filePaths: JSON.stringify([outA]),
        templatePath: templateFile,
      })
    ).rejects.toThrow(
      /dataArray and filePaths must be arrays of equal length/u
    );
  });

  it("errors when the template file does not exist", async () => {
    await expect(
      runTool(officecliTool, {
        action: "generate",
        data: JSON.stringify({}),
        filePath: outA,
        templatePath: "/tmp/does-not-exist.md",
      })
    ).rejects.toThrow(/template not found/u);
  });

  it("accepts extra keys in the data", async () => {
    await writeFile(templateFile, "{{a}}\n");
    const result = await runTool(officecliTool, {
      action: "generate",
      data: JSON.stringify({ a: "1", unused: "2" }),
      filePath: outA,
      templatePath: templateFile,
    });
    expect(result).toContain("Generated 1 drafts");
  });

  it("rejects a data value that is neither string nor number", async () => {
    await writeFile(templateFile, "{{a}}\n");
    await expect(
      runTool(officecliTool, {
        action: "generate",
        data: JSON.stringify({ a: true }),
        filePath: outA,
        templatePath: templateFile,
      })
    ).rejects.toThrow(
      /data must be a JSON object with string or number values/u
    );
  });

  it("aborts with no partial drafts when another session holds the lock", async () => {
    await writeFile(templateFile, "{{a}}\n");
    await runTool(
      officecliTool,
      { action: "create", content: "held", filePath: outB },
      {
        sessionID: "other-session",
      }
    );
    await expect(
      runTool(officecliTool, {
        action: "generate",
        dataArray: JSON.stringify([{ a: "1" }, { a: "2" }]),
        filePaths: JSON.stringify([outA, outB]),
        templatePath: templateFile,
      })
    ).rejects.toThrow(
      /lock on \/tmp\/officecli-gen-b\.txt held by session other-session/u
    );
    const list = await runTool(officecliTool, { action: "list" });
    expect(JSON.parse(list)).toHaveLength(1);
    expect(JSON.parse(list)[0].filePath).toBe(outB);
  });
});
