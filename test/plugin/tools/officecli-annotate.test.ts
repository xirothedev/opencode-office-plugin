import { describe, it, expect, beforeEach } from "bun:test";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

const makeBaseImage = async (target: string): Promise<void> => {
  await sharp({
    create: {
      background: { b: 255, g: 255, r: 255 },
      channels: 3,
      height: 200,
      width: 200,
    },
  })
    .png()
    .toFile(target);
};

describe("officecli annotate", () => {
  const testFile = "/tmp/test-annotate.png";
  const baseImage = "/tmp/test-annotate-base.png";
  const docxFixture = path.join(process.cwd(), "test/fixtures/sample.docx");
  setupHermeticDirs();
  cleanupTestFile(testFile);
  cleanupTestFile(baseImage);

  beforeEach(async () => {
    await makeBaseImage(baseImage);
    await copyFile(baseImage, testFile);
  });

  it("annotate renders a stamp onto the accepted image", async () => {
    const before = await readFile(testFile);
    await runTool(officecliTool, {
      action: "create",
      content: "# Image draft\n\nOCR text",
      filePath: testFile,
    });
    const result = await runTool(officecliTool, {
      action: "annotate",
      annotations: JSON.stringify([
        { position: { x: 0.5, y: 0.5 }, text: "APPROVED", type: "stamp" },
      ]),
      filePath: testFile,
    });
    expect(result).toContain("Annotations added");
    const acceptResult = await runTool(officecliTool, {
      action: "accept",
      filePath: testFile,
    });
    expect(acceptResult).toContain("Accepted");
    const after = await readFile(testFile);
    expect(after.equals(before)).toBe(false);
    const meta = await sharp(testFile).metadata();
    expect(meta.format).toBe("png");
  });

  it("annotations accumulate until accept", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Image draft",
      filePath: testFile,
    });
    await runTool(officecliTool, {
      action: "annotate",
      annotations: JSON.stringify([
        { position: { x: 0.1, y: 0.1 }, text: "Check this", type: "note" },
      ]),
      filePath: testFile,
    });
    await runTool(officecliTool, {
      action: "annotate",
      annotations: JSON.stringify([
        { position: { x: 0.5, y: 0.5 }, text: "DRAFT", type: "stamp" },
      ]),
      filePath: testFile,
    });
    await runTool(officecliTool, { action: "accept", filePath: testFile });
    const both = await readFile(testFile);

    await copyFile(baseImage, testFile);
    await runTool(officecliTool, {
      action: "create",
      content: "# Image draft",
      filePath: testFile,
    });
    await runTool(officecliTool, {
      action: "annotate",
      annotations: JSON.stringify([
        { position: { x: 0.1, y: 0.1 }, text: "Check this", type: "note" },
      ]),
      filePath: testFile,
    });
    await runTool(officecliTool, { action: "accept", filePath: testFile });
    const noteOnly = await readFile(testFile);

    expect(both.equals(noteOnly)).toBe(false);
  });

  it("annotations are cleared with an empty array", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Image draft",
      filePath: testFile,
    });
    await runTool(officecliTool, {
      action: "annotate",
      annotations: JSON.stringify([
        { position: { x: 0.5, y: 0.5 }, text: "DRAFT", type: "stamp" },
      ]),
      filePath: testFile,
    });
    const clearResult = await runTool(officecliTool, {
      action: "annotate",
      annotations: "[]",
      filePath: testFile,
    });
    expect(clearResult).toContain("Annotations cleared");
    await runTool(officecliTool, { action: "accept", filePath: testFile });
    const after = await readFile(testFile);
    expect(after.equals(await readFile(baseImage))).toBe(true);
  });

  it("stamp text is restricted to the fixed palette", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Image draft",
      filePath: testFile,
    });
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        annotations: JSON.stringify([
          { position: { x: 0.5, y: 0.5 }, text: "BANANA", type: "stamp" },
        ]),
        filePath: testFile,
      })
    ).rejects.toThrow(
      /stamp 0 text must be one of: DRAFT, APPROVED, CONFIDENTIAL/u
    );
  });

  it("note requires text and position", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Image draft",
      filePath: testFile,
    });
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        annotations: JSON.stringify([
          { position: { x: 0.1, y: 0.1 }, type: "note" },
        ]),
        filePath: testFile,
      })
    ).rejects.toThrow(/note 0 requires text and position/u);
  });

  it("highlight requires a rect", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Image draft",
      filePath: testFile,
    });
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        annotations: JSON.stringify([{ type: "highlight" }]),
        filePath: testFile,
      })
    ).rejects.toThrow(/highlight 0 requires rect/u);
  });

  it("errors on invalid annotations JSON", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Image draft",
      filePath: testFile,
    });
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        annotations: "not json",
        filePath: testFile,
      })
    ).rejects.toThrow(/invalid annotations JSON/u);
  });

  it("errors without a draft", async () => {
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        annotations: JSON.stringify([
          { position: { x: 0.5, y: 0.5 }, text: "DRAFT", type: "stamp" },
        ]),
        filePath: testFile,
      })
    ).rejects.toThrow(/no active draft/u);
  });

  it("errors on non-image files", async () => {
    await expect(
      runTool(officecliTool, {
        action: "annotate",
        annotations: JSON.stringify([
          { position: { x: 0.5, y: 0.5 }, text: "DRAFT", type: "stamp" },
        ]),
        filePath: docxFixture,
      })
    ).rejects.toThrow(/annotate only supported for PNG and JPG images/u);
  });
});
