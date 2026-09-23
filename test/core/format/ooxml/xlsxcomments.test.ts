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
  applyCellSuggestion,
} from "@/core/format/ooxml/xlsxcomments";

const FIXTURE = path.join(process.cwd(), "test/fixtures/sample.xlsx");

describe("OOXML XLSX Comment Writer", () => {
  let testDir: string;
  let testXlsxPath: string;

  beforeEach(() => {
    testDir = path.join(tmpdir(), `ooxml-xlsx-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    testXlsxPath = path.join(testDir, "test.xlsx");
    copyFileSync(FIXTURE, testXlsxPath);
  });

  afterEach(() => {
    if (existsSync(testXlsxPath)) {
      unlinkSync(testXlsxPath);
    }
  });

  it("writes single comment to XLSX", async () => {
    const comment = {
      author: "AI Agent",
      cellRef: "B2",
      id: "comment-1",
      parentId: null,
      status: "open",
      text: "This needs review",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    };

    await writeComment(testXlsxPath, comment);

    const comments = await readComments(testXlsxPath);
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("B2-0");
    expect(comments[0].author).toBe("AI Agent");
    expect(comments[0].text).toBe("This needs review");
    expect(comments[0].cellRef).toBe("B2");
    expect(comments[0].status).toBe("open");
  });

  it("supports multiple comments from different authors", async () => {
    await writeComment(testXlsxPath, {
      author: "AI Agent",
      cellRef: "B2",
      id: "c1",
      parentId: null,
      status: "open",
      text: "Check amount",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });
    await writeComment(testXlsxPath, {
      author: "Reviewer",
      cellRef: "B3",
      id: "c2",
      parentId: null,
      status: "open",
      text: "Confirmed",
      timestamp: new Date("2026-08-12T11:00:00Z"),
    });

    const comments = await readComments(testXlsxPath);
    expect(comments).toHaveLength(2);
    expect(comments[0].author).toBe("AI Agent");
    expect(comments[0].cellRef).toBe("B2");
    expect(comments[1].author).toBe("Reviewer");
    expect(comments[1].cellRef).toBe("B3");
  });

  it("appends to existing comments instead of overwriting", async () => {
    await writeComment(testXlsxPath, {
      author: "AI Agent",
      cellRef: "A1",
      id: "c1",
      parentId: null,
      status: "open",
      text: "First",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });
    await writeComment(testXlsxPath, {
      author: "AI Agent",
      cellRef: "C1",
      id: "c2",
      parentId: null,
      status: "open",
      text: "Second",
      timestamp: new Date("2026-08-12T10:31:00Z"),
    });

    const comments = await readComments(testXlsxPath);
    expect(comments).toHaveLength(2);
    expect(comments.map((c) => c.text)).toEqual(["First", "Second"]);
  });

  it("reads comment text from rich text runs (Excel/openpyxl style)", async () => {
    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath));
    const rich = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>AI Agent</author></authors><commentList><comment ref="B2" authorId="0"><text><r><rPr><b/><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t xml:space="preserve">This needs review</t></r></text></comment><comment ref="B3" authorId="0"><text><r><rPr><sz val="10"/></rPr><t xml:space="preserve">First part</t></r><r><t>second part</t></r></text></comment></commentList></comments>`;
    zip.file("xl/comments1.xml", rich);
    writeFileSync(
      testXlsxPath,
      await zip.generateAsync({ type: "uint8array" })
    );

    const comments = await readComments(testXlsxPath);
    expect(comments).toHaveLength(2);
    expect(comments[0].text).toBe("This needs review");
    expect(comments[1].text).toBe("First partsecond part");
  });

  it("uses unique VML shape ids and z-indexes for multiple comments", async () => {
    const base = {
      author: "AI Agent",
      parentId: null,
      status: "open",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    };
    await writeComment(testXlsxPath, {
      ...base,
      cellRef: "A1",
      id: "c1",
      text: "First",
    });
    await writeComment(testXlsxPath, {
      ...base,
      cellRef: "C1",
      id: "c2",
      text: "Second",
    });

    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath));
    const vmlFile = zip.file("xl/drawings/vmlDrawing1.vml");
    if (!vmlFile) {
      throw new Error("missing xl/drawings/vmlDrawing1.vml in fixture");
    }
    const vml = await vmlFile.async("string");
    const shapeIds = [...vml.matchAll(/id="_x0000_s(?<shapeId>\d+)"/gu)].map(
      (m) => m.groups?.shapeId
    );
    const zIndexes = [...vml.matchAll(/z-index:(?<zIndex>\d+)/gu)].map(
      (m) => m.groups?.zIndex
    );
    expect(new Set(shapeIds).size).toBe(2);
    expect(new Set(zIndexes).size).toBe(2);
  });

  it("does not duplicate sheet relationships across writes", async () => {
    const base = {
      author: "AI Agent",
      parentId: null,
      status: "open",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    };
    await writeComment(testXlsxPath, {
      ...base,
      cellRef: "A1",
      id: "c1",
      text: "First",
    });
    await writeComment(testXlsxPath, {
      ...base,
      cellRef: "C1",
      id: "c2",
      text: "Second",
    });

    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath));
    const relsFile = zip.file("xl/worksheets/_rels/sheet1.xml.rels");
    if (!relsFile) {
      throw new Error("missing xl/worksheets/_rels/sheet1.xml.rels in fixture");
    }
    const rels = await relsFile.async("string");
    const commentRels = (rels.match(/relationships\/comments/gu) || []).length;
    const vmlRels = (rels.match(/relationships\/vmlDrawing/gu) || []).length;
    expect(commentRels).toBe(1);
    expect(vmlRels).toBe(1);
  });

  it("writes value suggestion and reads it back", async () => {
    await writeComment(testXlsxPath, {
      author: "AI Agent",
      cellRef: "B2",
      id: "s1",
      parentId: null,
      status: "open",
      suggestedText: "42",
      text: "Original note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });

    const comments = await readComments(testXlsxPath);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("Suggested value: 42");
    expect(comments[0].suggestedText).toBe("42");
  });

  it("approve writes numeric value into the cell and removes comment and note shape", async () => {
    await writeComment(testXlsxPath, {
      author: "AI Agent",
      cellRef: "B2",
      id: "s1",
      parentId: null,
      status: "open",
      suggestedText: "42",
      text: "Original note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });

    const result = await applyCellSuggestion(testXlsxPath, "B2-0");
    expect(result).toBe("applied");

    expect(await readComments(testXlsxPath)).toHaveLength(0);
    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath));
    const sheetFile = zip.file("xl/worksheets/sheet1.xml");
    if (!sheetFile) {
      throw new Error("missing xl/worksheets/sheet1.xml in fixture");
    }
    const sheet = await sheetFile.async("string");
    expect(sheet).toMatch(/<c r="B2">\s*<v>42<\/v>\s*<\/c>/u);
    const approvedVmlFile = zip.file("xl/drawings/vmlDrawing1.vml");
    if (!approvedVmlFile) {
      throw new Error("missing xl/drawings/vmlDrawing1.vml in fixture");
    }
    const vml = await approvedVmlFile.async("string");
    expect(vml).not.toContain("<v:shape");
  });

  it("approve writes string value as inline string into a new cell", async () => {
    await writeComment(testXlsxPath, {
      author: "AI Agent",
      cellRef: "D1",
      id: "s2",
      parentId: null,
      status: "open",
      suggestedText: "Pending approval",
      text: "Original note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });

    const result = await applyCellSuggestion(testXlsxPath, "D1-0");
    expect(result).toBe("applied");

    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath));
    const sheetFile = zip.file("xl/worksheets/sheet1.xml");
    if (!sheetFile) {
      throw new Error("missing xl/worksheets/sheet1.xml in fixture");
    }
    const sheet = await sheetFile.async("string");
    expect(sheet).toMatch(
      /<c r="D1" t="inlineStr">\s*<is>\s*<t>Pending approval<\/t>\s*<\/is>\s*<\/c>/u
    );
  });

  it("approve rejects plain comments and unknown ids", async () => {
    await writeComment(testXlsxPath, {
      author: "AI Agent",
      cellRef: "B2",
      id: "c1",
      parentId: null,
      status: "open",
      text: "Just a note",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });

    expect(await applyCellSuggestion(testXlsxPath, "B2-0")).toBe(
      "no-suggestion"
    );
    expect(await applyCellSuggestion(testXlsxPath, "Z9-9")).toBe("not-found");
  });

  it("round-trips comment status", async () => {
    await writeComment(testXlsxPath, {
      author: "AI Agent",
      cellRef: "B2",
      id: "s1",
      parentId: null,
      status: "denied",
      text: "Denied value",
      timestamp: new Date("2026-08-12T10:30:00Z"),
    });
    const comments = await readComments(testXlsxPath);
    expect(comments[0].status).toBe("denied");
    const zip = await JSZip.loadAsync(readFileSync(testXlsxPath));
    const statusXmlFile = zip.file("xl/comments1.xml");
    if (!statusXmlFile) {
      throw new Error("missing xl/comments1.xml in fixture");
    }
    const xml = await statusXmlFile.async("string");
    expect(xml).toContain('oo:status="denied"');
    expect(xml).toContain('xmlns:oo="http://opencode.ai/openoffice-plugin"');
  });
});
