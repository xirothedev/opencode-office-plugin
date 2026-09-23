import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  copyFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import JSZip from "jszip";

import {
  writeComment,
  readComments,
  applySlideSuggestion,
} from "@/core/format/ooxml/pptxcomments";

const FIXTURE = path.join(process.cwd(), "test/fixtures/sample.pptx");

describe("OOXML PPTX Comment Writer", () => {
  let testDir: string;
  let testPptxPath: string;

  beforeEach(() => {
    testDir = path.join(tmpdir(), `ooxml-pptx-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    testPptxPath = path.join(testDir, "test.pptx");
    copyFileSync(FIXTURE, testPptxPath);
  });

  afterEach(() => {
    if (existsSync(testPptxPath)) {
      unlinkSync(testPptxPath);
    }
  });

  it("writes single comment to PPTX", async () => {
    const comment = {
      author: "AI Agent",
      id: "comment-1",
      parentId: null,
      slide: 0,
      status: "open",
      text: "Add diagram to clarify",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      x: 100_000,
      y: 200_000,
    };

    await writeComment(testPptxPath, comment);

    const comments = await readComments(testPptxPath);
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("slide-0-cm-1");
    expect(comments[0].author).toBe("AI Agent");
    expect(comments[0].text).toBe("Add diagram to clarify");
    expect(comments[0].slide).toBe(0);
    expect(comments[0].x).toBe(100_000);
    expect(comments[0].y).toBe(200_000);
    expect(comments[0].status).toBe("open");
  });

  it("supports multiple comments from different authors", async () => {
    await writeComment(testPptxPath, {
      author: "AI Agent",
      id: "c1",
      parentId: null,
      slide: 0,
      status: "open",
      text: "First comment",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      x: 100_000,
      y: 100_000,
    });
    await writeComment(testPptxPath, {
      author: "Reviewer",
      id: "c2",
      parentId: null,
      slide: 0,
      status: "open",
      text: "Second comment",
      timestamp: new Date("2026-08-12T11:00:00Z"),
      x: 200_000,
      y: 200_000,
    });

    const comments = await readComments(testPptxPath);
    expect(comments).toHaveLength(2);
    expect(comments[0].author).toBe("AI Agent");
    expect(comments[1].author).toBe("Reviewer");
    expect(comments[0].text).toBe("First comment");
    expect(comments[1].text).toBe("Second comment");
  });

  it("returns empty list when presentation has no comments", async () => {
    const comments = await readComments(testPptxPath);
    expect(comments).toEqual([]);
  });

  it("assigns per-author comment indexes", async () => {
    await writeComment(testPptxPath, {
      author: "AI Agent",
      id: "c1",
      parentId: null,
      slide: 0,
      status: "open",
      text: "First",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      x: 100_000,
      y: 100_000,
    });
    await writeComment(testPptxPath, {
      author: "Reviewer",
      id: "c2",
      parentId: null,
      slide: 0,
      status: "open",
      text: "Second",
      timestamp: new Date("2026-08-12T11:00:00Z"),
      x: 200_000,
      y: 200_000,
    });
    await writeComment(testPptxPath, {
      author: "AI Agent",
      id: "c3",
      parentId: null,
      slide: 0,
      status: "open",
      text: "Third",
      timestamp: new Date("2026-08-12T11:30:00Z"),
      x: 300_000,
      y: 300_000,
    });

    const zip = await JSZip.loadAsync(readFileSync(testPptxPath));
    const commentXmlFile = zip.file("ppt/comments/comment1.xml");
    if (!commentXmlFile) {
      throw new Error("missing ppt/comments/comment1.xml in fixture");
    }
    const cmXml = await commentXmlFile.async("string");
    const indexes = [
      ...cmXml.matchAll(/authorId="(?<authorId>\d+)"[^>]*idx="(?<idx>\d+)"/gu),
    ].map((m) => ({
      authorId: m.groups?.authorId,
      idx: m.groups?.idx,
    }));
    expect(indexes).toEqual([
      { authorId: "0", idx: "1" },
      { authorId: "1", idx: "1" },
      { authorId: "0", idx: "2" },
    ]);
    const authorsXmlFile = zip.file("ppt/commentAuthors.xml");
    if (!authorsXmlFile) {
      throw new Error("missing ppt/commentAuthors.xml in fixture");
    }
    const authorsXml = await authorsXmlFile.async("string");
    expect(authorsXml).toContain('id="0" name="AI Agent"');
    expect(authorsXml).toContain('lastIdx="2"');
  });

  it("writes text suggestion and reads it back", async () => {
    await writeComment(testPptxPath, {
      author: "AI Agent",
      id: "s1",
      parentId: null,
      slide: 0,
      status: "open",
      suggestedText: "Revised slide heading",
      targetText: "Hello from slide 1",
      text: "Original note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      x: 100_000,
      y: 100_000,
    });

    const comments = await readComments(testPptxPath);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe(
      "Suggested text: Revised slide heading\nTarget text: Hello from slide 1"
    );
    expect(comments[0].suggestedText).toBe("Revised slide heading");
    expect(comments[0].targetText).toBe("Hello from slide 1");
  });

  it("approve replaces first text box and removes the comment", async () => {
    await writeComment(testPptxPath, {
      author: "AI Agent",
      id: "s1",
      parentId: null,
      slide: 0,
      status: "open",
      suggestedText: "Approved slide text",
      text: "Original note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      x: 100_000,
      y: 100_000,
    });

    const result = await applySlideSuggestion(testPptxPath, "slide-0-cm-1");
    expect(result).toBe("applied");

    expect(await readComments(testPptxPath)).toHaveLength(0);
    const zip = await JSZip.loadAsync(readFileSync(testPptxPath));
    const slideFile = zip.file("ppt/slides/slide1.xml");
    if (!slideFile) {
      throw new Error("missing ppt/slides/slide1.xml in fixture");
    }
    const slide = await slideFile.async("string");
    expect(slide).toContain("Approved slide text");
    expect(slide).not.toContain("Hello from slide 1");
  });

  it("approve rejects plain comments and unknown ids", async () => {
    await writeComment(testPptxPath, {
      author: "AI Agent",
      id: "c1",
      parentId: null,
      slide: 0,
      status: "open",
      text: "Just a note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      x: 100_000,
      y: 100_000,
    });

    expect(await applySlideSuggestion(testPptxPath, "slide-0-cm-1")).toBe(
      "no-suggestion"
    );
    expect(await applySlideSuggestion(testPptxPath, "slide-5-cm-9")).toBe(
      "not-found"
    );
  });

  it("approve targets the text box matching targetText", async () => {
    const zip = await JSZip.loadAsync(readFileSync(testPptxPath));
    const slideXmlFile = zip.file("ppt/slides/slide1.xml");
    if (!slideXmlFile) {
      throw new Error("missing ppt/slides/slide1.xml in fixture");
    }
    const slideXml = await slideXmlFile.async("string");
    const extraShape =
      '<p:sp><p:nvSpPr><p:cNvPr id="99" name="Sidebar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
      "<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Sidebar note</a:t></a:r></a:p></p:txBody></p:sp>";
    zip.file(
      "ppt/slides/slide1.xml",
      slideXml.replace("</p:spTree>", `${extraShape}</p:spTree>`)
    );
    writeFileSync(
      testPptxPath,
      await zip.generateAsync({ type: "uint8array" })
    );

    await writeComment(testPptxPath, {
      author: "AI Agent",
      id: "s1",
      parentId: null,
      slide: 0,
      status: "open",
      suggestedText: "Revised sidebar",
      targetText: "sidebar note",
      text: "Original note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      x: 100_000,
      y: 100_000,
    });

    const result = await applySlideSuggestion(testPptxPath, "slide-0-cm-1");
    expect(result).toBe("applied");

    expect(await readComments(testPptxPath)).toHaveLength(0);
    const updated = await JSZip.loadAsync(readFileSync(testPptxPath));
    const updatedSlideFile = updated.file("ppt/slides/slide1.xml");
    if (!updatedSlideFile) {
      throw new Error("missing ppt/slides/slide1.xml in fixture");
    }
    const slide = await updatedSlideFile.async("string");
    expect(slide).toContain("Revised sidebar");
    expect(slide).toContain("Hello from slide 1");
  });

  it("approve fails with candidates when targetText matches no box", async () => {
    await writeComment(testPptxPath, {
      author: "AI Agent",
      id: "s1",
      parentId: null,
      slide: 0,
      status: "open",
      suggestedText: "Revised text",
      targetText: "text that exists nowhere",
      text: "Original note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      x: 100_000,
      y: 100_000,
    });

    await expect(
      applySlideSuggestion(testPptxPath, "slide-0-cm-1")
    ).rejects.toThrow(/No text box on slide matches target.*Text boxes:/su);
  });

  it("round-trips comment status", async () => {
    await writeComment(testPptxPath, {
      author: "AI Agent",
      id: "cm-1",
      parentId: null,
      slide: 0,
      status: "denied",
      text: "Needs a diagram",
      timestamp: new Date("2026-08-12T10:30:00Z"),
      x: 100_000,
      y: 200_000,
    });
    const comments = await readComments(testPptxPath);
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("slide-0-cm-1");
    expect(comments[0].status).toBe("denied");
    const zip = await JSZip.loadAsync(readFileSync(testPptxPath));
    const statusXmlFile = zip.file("ppt/comments/comment1.xml");
    if (!statusXmlFile) {
      throw new Error("missing ppt/comments/comment1.xml in fixture");
    }
    const xml = await statusXmlFile.async("string");
    expect(xml).toContain('oo:status="denied"');
    expect(xml).toContain('xmlns:oo="http://opencode.ai/openoffice-plugin"');
  });
});
