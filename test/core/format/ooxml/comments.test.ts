import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  writeFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Document, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";

import {
  writeComment,
  readComments,
  applyCommentSuggestion,
  updateComment,
  deleteComment,
  setCommentStatus,
} from "@/core/format/ooxml/comments";

describe("OOXML Comment Writer", () => {
  let testDir: string;
  let testDocPath: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `ooxml-test-${Date.now()}`);
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

  it("writes single comment to DOCX", async () => {
    const comment = {
      author: "AI Agent",
      id: "comment-1",
      parentId: null,
      rangeEnd: { offset: 11, paragraph: 0 },
      rangeStart: { offset: 6, paragraph: 0 },
      status: "open",
      text: "This needs review",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    };

    await writeComment(testDocPath, comment);

    const comments = await readComments(testDocPath);
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("comment-1");
    expect(comments[0].author).toBe("AI Agent");
    expect(comments[0].text).toBe("This needs review");
    expect(comments[0].status).toBe("open");
  });

  it("writes suggestion comment and reads it back", async () => {
    const comment = {
      author: "AI Agent",
      id: "comment-s1",
      parentId: null,
      rangeEnd: { offset: 5, paragraph: 0 },
      rangeStart: { offset: 0, paragraph: 0 },
      status: "open",
      suggestedText: "Revised clause text",
      text: "Original note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    };

    await writeComment(testDocPath, comment);

    const comments = await readComments(testDocPath);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("Suggested text: Revised clause text");
    expect(comments[0].suggestedText).toBe("Revised clause text");
  });

  it("approve applies suggestion text to the paragraph and removes the comment", async () => {
    await writeComment(testDocPath, {
      author: "AI Agent",
      id: "comment-s1",
      parentId: null,
      rangeEnd: { offset: 5, paragraph: 0 },
      rangeStart: { offset: 0, paragraph: 0 },
      status: "open",
      suggestedText: "Approved wording",
      text: "Original note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });

    const result = await applyCommentSuggestion(testDocPath, "comment-s1");
    expect(result).toBe("applied");

    const comments = await readComments(testDocPath);
    expect(comments).toHaveLength(0);
    const zip = await JSZip.loadAsync(readFileSync(testDocPath));
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) {
      throw new Error("missing word/document.xml in fixture");
    }
    const docXml = await docXmlFile.async("string");
    expect(docXml).toContain("Approved wording");
    expect(docXml).not.toContain("commentRangeStart");
  });

  it("approve rejects comments without a suggestion", async () => {
    await writeComment(testDocPath, {
      author: "AI Agent",
      id: "comment-1",
      parentId: null,
      rangeEnd: { offset: 11, paragraph: 0 },
      rangeStart: { offset: 6, paragraph: 0 },
      status: "open",
      text: "This needs review",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });

    const result = await applyCommentSuggestion(testDocPath, "comment-1");
    expect(result).toBe("no-suggestion");
  });

  it("approve returns not-found for unknown comment id", async () => {
    const result = await applyCommentSuggestion(testDocPath, "missing-1");
    expect(result).toBe("not-found");
  });

  it("round-trips comment status (resolved/denied) through write and read", async () => {
    await writeComment(testDocPath, {
      author: "AI Agent",
      id: "comment-r",
      parentId: null,
      rangeEnd: { offset: 5, paragraph: 0 },
      rangeStart: { offset: 0, paragraph: 0 },
      status: "resolved",
      text: "Resolved note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });
    await writeComment(testDocPath, {
      author: "AI Agent",
      id: "comment-d",
      parentId: null,
      rangeEnd: { offset: 5, paragraph: 0 },
      rangeStart: { offset: 0, paragraph: 0 },
      status: "denied",
      text: "Denied note",
      timestamp: new Date("2026-08-12T10:31:00Z"),
    });

    const comments = await readComments(testDocPath);
    expect(comments).toHaveLength(2);
    const byId = Object.fromEntries(comments.map((c) => [c.id, c]));
    expect(byId["comment-r"].status).toBe("resolved");
    expect(byId["comment-d"].status).toBe("denied");

    const zip = await JSZip.loadAsync(readFileSync(testDocPath));
    const statusXmlFile = zip.file("word/comments.xml");
    if (!statusXmlFile) {
      throw new Error("missing word/comments.xml in fixture");
    }
    const xml = await statusXmlFile.async("string");
    expect(xml).toContain('w:done="1"');
    expect(xml).toContain('oo:status="denied"');
    expect(xml).toContain('xmlns:oo="http://opencode.ai/openoffice-plugin"');
  });

  it("updateComment rewrites the text and suggestion without touching status", async () => {
    await writeComment(testDocPath, {
      author: "AI Agent",
      id: "comment-1",
      parentId: null,
      rangeEnd: { offset: 5, paragraph: 0 },
      rangeStart: { offset: 0, paragraph: 0 },
      status: "open",
      suggestedText: "Original suggestion",
      text: "Original note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });
    await setCommentStatus(testDocPath, "comment-1", "resolved");

    expect(
      await updateComment(testDocPath, "comment-1", { text: "Edited note" })
    ).toBe("updated");
    let comments = await readComments(testDocPath);
    expect(comments[0].text).toBe("Edited note");
    expect(comments[0].suggestedText).toBeNull();
    expect(comments[0].status).toBe("resolved");
    expect(comments[0].author).toBe("AI Agent");

    expect(
      await updateComment(testDocPath, "comment-1", {
        suggestedText: "New suggestion",
      })
    ).toBe("updated");
    comments = await readComments(testDocPath);
    expect(comments[0].suggestedText).toBe("New suggestion");
    expect(comments[0].status).toBe("resolved");

    expect(await updateComment(testDocPath, "nope", { text: "x" })).toBe(
      "not-found"
    );
  });

  it("deleteComment removes the comment and its range markers", async () => {
    await writeComment(testDocPath, {
      author: "AI Agent",
      id: "comment-1",
      parentId: null,
      rangeEnd: { offset: 11, paragraph: 0 },
      rangeStart: { offset: 6, paragraph: 0 },
      status: "open",
      text: "This needs review",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });

    expect(await deleteComment(testDocPath, "comment-1")).toBe("deleted");
    expect(await readComments(testDocPath)).toHaveLength(0);
    const zip = await JSZip.loadAsync(readFileSync(testDocPath));
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) {
      throw new Error("missing word/document.xml in fixture");
    }
    const docXml = await docXmlFile.async("string");
    expect(docXml).not.toContain("commentRangeStart");
    expect(docXml).not.toContain("commentReference");
    expect(await deleteComment(testDocPath, "comment-1")).toBe("not-found");
  });

  it("setCommentStatus transitions open -> resolved -> denied -> open", async () => {
    await writeComment(testDocPath, {
      author: "AI Agent",
      id: "comment-1",
      parentId: null,
      rangeEnd: { offset: 5, paragraph: 0 },
      rangeStart: { offset: 0, paragraph: 0 },
      status: "open",
      text: "Status test",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });

    expect(await setCommentStatus(testDocPath, "comment-1", "resolved")).toBe(
      "ok"
    );
    const resolvedComments = await readComments(testDocPath);
    expect(resolvedComments[0].status).toBe("resolved");

    expect(await setCommentStatus(testDocPath, "comment-1", "denied")).toBe(
      "ok"
    );
    let zip = await JSZip.loadAsync(readFileSync(testDocPath));
    const deniedCommentsFile = zip.file("word/comments.xml");
    if (!deniedCommentsFile) {
      throw new Error("missing word/comments.xml in fixture");
    }
    let xml = await deniedCommentsFile.async("string");
    const deniedComments = await readComments(testDocPath);
    expect(deniedComments[0].status).toBe("denied");
    expect(xml).toContain('oo:status="denied"');
    expect(xml).not.toContain('w:done="1"');

    expect(await setCommentStatus(testDocPath, "comment-1", "open")).toBe("ok");
    zip = await JSZip.loadAsync(readFileSync(testDocPath));
    const openCommentsFile = zip.file("word/comments.xml");
    if (!openCommentsFile) {
      throw new Error("missing word/comments.xml in fixture");
    }
    xml = await openCommentsFile.async("string");
    const openComments = await readComments(testDocPath);
    expect(openComments[0].status).toBe("open");
    expect(xml).not.toContain("oo:status");
    expect(xml).not.toContain("w:done");

    expect(await setCommentStatus(testDocPath, "nope", "resolved")).toBe(
      "not-found"
    );
  });
});
