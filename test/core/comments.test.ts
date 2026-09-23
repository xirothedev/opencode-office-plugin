import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { copyFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Comments from "@/core/comments";

const FIXTURES = {
  ".docx": path.join(process.cwd(), "test/fixtures/sample.docx"),
  ".pptx": path.join(process.cwd(), "test/fixtures/sample.pptx"),
  ".xlsx": path.join(process.cwd(), "test/fixtures/sample.xlsx"),
};

const baseInput = (ext: string) => {
  const common = { author: "Tester", id: "c1", text: "hello <b>x</b>" };
  if (ext === ".docx") {
    return {
      ...common,
      rangeEndOffset: 5,
      rangeEndParagraph: 0,
      rangeStartOffset: 0,
      rangeStartParagraph: 0,
    };
  }
  if (ext === ".xlsx") {
    return { ...common, cellRef: "B2" };
  }
  return { ...common, slide: 0 };
};

describe("Comment intake module", () => {
  let testDir: string;

  const fixture = (ext: string) => {
    const p = path.join(testDir, `copy${ext}`);
    copyFileSync(FIXTURES[ext], p);
    return p;
  };

  beforeEach(() => {
    testDir = path.join(
      tmpdir(),
      `comments-intake-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { force: true, recursive: true });
  });

  for (const ext of Object.keys(FIXTURES)) {
    it(`routes add → list → update → remove for ${ext}`, async () => {
      const file = fixture(ext);
      await Comments.add(file, baseInput(ext));
      const comments = await Comments.list(file);
      expect(comments).toHaveLength(1);
      expect(comments[0].text).toBe("hello <b>x</b>");
      const preview = await Comments.preview(file);
      expect(preview[0].anchor).toBeTruthy();

      const storedId = comments[0].id;
      expect(await Comments.update(file, storedId, { text: "edited" })).toBe(
        "updated"
      );
      const listed = await Comments.list(file);
      expect(listed[0].text).toBe("edited");
      expect(await Comments.remove(file, storedId)).toBe("deleted");
      expect(await Comments.list(file)).toHaveLength(0);
    });
  }

  it("runs the full lifecycle on DOCX (the format with string ids)", async () => {
    const file = fixture(".docx");
    await Comments.add(file, baseInput(".docx"));
    expect(await Comments.setStatus(file, "c1", "resolved")).toBe("ok");
    const afterResolve = await Comments.list(file);
    expect(afterResolve[0].status).toBe("resolved");
    expect(await Comments.applySuggestion(file, "c1")).toBe("no-suggestion");
    expect(await Comments.applySuggestion(file, "nope")).toBe("not-found");
  });

  it("refuses to approve a denied suggestion, on every format", async () => {
    await Promise.all(
      Object.keys(FIXTURES).map(async (ext) => {
        const file = fixture(ext);
        await Comments.add(file, {
          ...baseInput(ext),
          suggestedText: "SHOULD-NOT-APPLY",
        });
        const [{ id }] = await Comments.list(file);
        expect(await Comments.setStatus(file, id, "denied")).toBe("ok");
        expect(await Comments.applySuggestion(file, id)).toBe("denied");
        const after = await Comments.list(file);
        expect(after).toHaveLength(1);
        expect(after[0].status).toBe("denied");
      })
    );
  });

  it("strips XML-illegal control characters at the seam", async () => {
    const file = fixture(".xlsx");
    await Comments.add(file, {
      author: "a",
      cellRef: "B2",
      id: "c1",
      text: "a\u0003b",
    });
    const sanitized = await Comments.list(file);
    expect(sanitized[0].text).toBe("ab");
  });

  it("rejects unsupported formats with the exact noun message", async () => {
    const txt = path.join(testDir, "notes.txt");
    expect(() => Comments.requireFormat(txt, "comments")).toThrow(
      "comments only supported for DOCX, XLSX and PPTX files"
    );
    await expect(
      Comments.add(txt, { author: "a", id: "c", text: "t" })
    ).rejects.toThrow("comments only supported for DOCX, XLSX and PPTX files");
  });

  it("requires per-format params", () => {
    const docx = path.join(testDir, "a.docx");
    expect(() =>
      Comments.validate(docx, { author: "a", id: "c", text: "t" })
    ).toThrow(
      "comment on DOCX requires rangeStartParagraph, rangeStartOffset, rangeEndParagraph, rangeEndOffset"
    );
    const xlsx = path.join(testDir, "a.xlsx");
    expect(() =>
      Comments.validate(xlsx, { author: "a", id: "c", text: "t" })
    ).toThrow('comment on XLSX requires cellRef (e.g. "B4")');
  });

  it("preview returns [] for non-Office extensions instead of throwing", async () => {
    const txt = path.join(testDir, "p.txt");
    expect(await Comments.preview(txt)).toEqual([]);
  });
});
