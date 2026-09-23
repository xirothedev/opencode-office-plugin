import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Document, Packer, Paragraph, TextRun } from "docx";

import {
  writeTrackChange,
  readTrackChanges,
} from "@/core/format/ooxml/trackchanges";

describe("OOXML Track Changes Writer", () => {
  let testDir: string;
  let testDocPath: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `ooxml-tc-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    testDocPath = path.join(testDir, "test.docx");

    // Create test DOCX with initial content
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [new TextRun("Hello world. This is a test document.")],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    writeFileSync(testDocPath, buffer);
  });

  afterEach(() => {
    if (existsSync(testDocPath)) {
      unlinkSync(testDocPath);
    }
  });

  it("writes insertion track change to DOCX", async () => {
    const trackChange = {
      author: "AI Agent",
      id: "tc-1",
      offset: 12,
      paragraph: 0,
      text: " inserted text",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      type: "insertion" as const,
    };

    await writeTrackChange(testDocPath, trackChange);

    const changes = await readTrackChanges(testDocPath);
    expect(changes).toHaveLength(1);
    expect(changes[0].id).toBe("tc-1");
    expect(changes[0].type).toBe("insertion");
    expect(changes[0].author).toBe("AI Agent");
    expect(changes[0].text).toBe(" inserted text");
  });

  it("writes deletion track change to DOCX", async () => {
    const trackChange = {
      author: "Reviewer",
      id: "tc-2",
      offset: 27,
      paragraph: 0,
      text: "test document",
      timestamp: new Date("2026-08-12T11:00:00Z"),
      type: "deletion" as const,
    };

    await writeTrackChange(testDocPath, trackChange);

    const changes = await readTrackChanges(testDocPath);
    expect(changes).toHaveLength(1);
    expect(changes[0].id).toBe("tc-2");
    expect(changes[0].type).toBe("deletion");
    expect(changes[0].author).toBe("Reviewer");
    expect(changes[0].text).toBe("test document");
  });
});
