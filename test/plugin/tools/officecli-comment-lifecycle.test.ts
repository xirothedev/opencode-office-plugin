import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { officecliTool } from "@/plugin/tools/officecli";
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";
import { getFilePathHash } from "@/core/storage/paths";
import { getDraftPath } from "@/core/draft/manager";
import { copyFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const testFile = "/tmp/comment-lifecycle.docx";
const SESSION = "test-session";
const DOCX_FIXTURE = join(process.cwd(), "test/fixtures/sample.docx");

// computed lazily: the hermetic data dir is only configured in the describe body
function draftPath(): string {
  return getDraftPath(getFilePathHash(testFile), SESSION, ".docx");
}

function parseList(result: string): {
  count: number;
  comments: Array<Record<string, unknown>>;
} {
  const space = result.indexOf(" ");
  const count = Number(result.slice(0, space));
  const comments = JSON.parse(result.slice(result.indexOf("\n") + 1)) as Array<
    Record<string, unknown>
  >;
  return { count, comments };
}

async function seedDraftWithDocx(): Promise<void> {
  await runTool(officecliTool, {
    action: "create",
    filePath: testFile,
    content: "stub",
  });
  copyFileSync(DOCX_FIXTURE, draftPath());
}

async function addComment(
  commentId = "comment-1",
  text = "This clause needs review",
) {
  await runTool(officecliTool, {
    action: "comment",
    filePath: testFile,
    commentId,
    author: "AI Agent",
    commentText: text,
    rangeStartParagraph: 0,
    rangeStartOffset: 0,
    rangeEndParagraph: 0,
    rangeEndOffset: 10,
  });
}

async function listParsed(): Promise<{
  count: number;
  comments: Array<Record<string, unknown>>;
}> {
  return parseList(
    await runTool(officecliTool, {
      action: "list-comments",
      filePath: testFile,
    }),
  );
}

async function readDraftPart(part: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(draftPath()));
  return await zip.file(part)!.async("string");
}

describe("officecli comment lifecycle actions", () => {
  setupHermeticDirs();
  cleanupTestFile(testFile);

  it("list-comments reports status open for new comments", async () => {
    await seedDraftWithDocx();
    await addComment();
    const parsed = await listParsed();
    expect(parsed.count).toBe(1);
    const [comment] = parsed.comments;
    expect(comment.id).toBe("comment-1");
    expect(comment.text).toBe("This clause needs review");
    expect(comment.status).toBe("open");
  });

  it("edit-comment updates the text and keeps status/author/anchor", async () => {
    await seedDraftWithDocx();
    await addComment();
    await runTool(officecliTool, {
      action: "resolve-comment",
      filePath: testFile,
      commentId: "comment-1",
    });
    await runTool(officecliTool, {
      action: "edit-comment",
      filePath: testFile,
      commentId: "comment-1",
      text: "Revised wording",
    });
    const parsed = await listParsed();
    const [comment] = parsed.comments;
    expect(comment.text).toBe("Revised wording");
    expect(comment.author).toBe("AI Agent");
    expect(comment.status).toBe("resolved");
  });

  it("edit-comment rewrites the suggested text and keeps the marker", async () => {
    await seedDraftWithDocx();
    await runTool(officecliTool, {
      action: "comment",
      filePath: testFile,
      commentId: "comment-1",
      author: "AI Agent",
      commentText: "Original note",
      suggestedText: "Original suggestion",
      rangeStartParagraph: 0,
      rangeStartOffset: 0,
      rangeEndParagraph: 0,
      rangeEndOffset: 10,
    });
    await runTool(officecliTool, {
      action: "edit-comment",
      filePath: testFile,
      commentId: "comment-1",
      suggestedText: "Updated suggestion",
    });
    const parsed = await listParsed();
    const [comment] = parsed.comments;
    expect(comment.text).toBe("Suggested text: Updated suggestion");
    expect(comment.suggestedText).toBe("Updated suggestion");
  });

  it("edit-comment without text or suggestedText fails", async () => {
    await seedDraftWithDocx();
    await addComment();
    await expect(
      runTool(officecliTool, {
        action: "edit-comment",
        filePath: testFile,
        commentId: "comment-1",
      }),
    ).rejects.toThrow(/edit-comment requires text or suggestedText/);
  });

  it("resolve-comment persists w:done on the DOCX comment", async () => {
    await seedDraftWithDocx();
    await addComment();
    const result = await runTool(officecliTool, {
      action: "resolve-comment",
      filePath: testFile,
      commentId: "comment-1",
    });
    expect(result).toContain("resolved");
    const xml = await readDraftPart("word/comments.xml");
    expect(xml).toContain('w:done="1"');
    expect(xml).not.toContain("oo:status");
    expect((await listParsed()).comments[0].status).toBe("resolved");
  });

  it("deny-comment persists the plugin-namespaced status attribute", async () => {
    await seedDraftWithDocx();
    await addComment();
    const result = await runTool(officecliTool, {
      action: "deny-comment",
      filePath: testFile,
      commentId: "comment-1",
    });
    expect(result).toContain("denied");
    const xml = await readDraftPart("word/comments.xml");
    expect(xml).toContain('xmlns:oo="http://opencode.ai/openoffice-plugin"');
    expect(xml).toContain('oo:status="denied"');
    expect(xml).not.toContain("w:done");
    expect((await listParsed()).comments[0].status).toBe("denied");
  });

  it("deny after resolve replaces w:done with the denied marker", async () => {
    await seedDraftWithDocx();
    await addComment();
    await runTool(officecliTool, {
      action: "resolve-comment",
      filePath: testFile,
      commentId: "comment-1",
    });
    await runTool(officecliTool, {
      action: "deny-comment",
      filePath: testFile,
      commentId: "comment-1",
    });
    const xml = await readDraftPart("word/comments.xml");
    expect(xml).toContain('oo:status="denied"');
    expect(xml).not.toContain("w:done");
    expect((await listParsed()).comments[0].status).toBe("denied");
  });

  it("delete-comment removes the comment and its range markers from the draft", async () => {
    await seedDraftWithDocx();
    await addComment();
    const result = await runTool(officecliTool, {
      action: "delete-comment",
      filePath: testFile,
      commentId: "comment-1",
    });
    expect(result).toContain("deleted");
    const parsed = await listParsed();
    expect(parsed.count).toBe(0);
    expect(parsed.comments).toEqual([]);
    const docXml = await readDraftPart("word/document.xml");
    expect(docXml).not.toContain("commentRangeStart");
    expect(docXml).not.toContain("commentReference");
  });

  it("lifecycle actions fail for unknown comment ids", async () => {
    await seedDraftWithDocx();
    await addComment();
    await expect(
      runTool(officecliTool, {
        action: "edit-comment",
        filePath: testFile,
        commentId: "nope",
        text: "x",
      }),
    ).rejects.toThrow(/comment nope not found/);
    await expect(
      runTool(officecliTool, {
        action: "delete-comment",
        filePath: testFile,
        commentId: "nope",
      }),
    ).rejects.toThrow(/comment nope not found/);
    await expect(
      runTool(officecliTool, {
        action: "resolve-comment",
        filePath: testFile,
        commentId: "nope",
      }),
    ).rejects.toThrow(/comment nope not found/);
    await expect(
      runTool(officecliTool, {
        action: "deny-comment",
        filePath: testFile,
        commentId: "nope",
      }),
    ).rejects.toThrow(/comment nope not found/);
  });

  it("lifecycle actions require an active draft", async () => {
    await expect(
      runTool(officecliTool, {
        action: "resolve-comment",
        filePath: testFile,
        commentId: "comment-1",
      }),
    ).rejects.toThrow(/no active draft/);
  });

  it("review includes the comment status", async () => {
    await seedDraftWithDocx();
    await addComment();
    await runTool(officecliTool, {
      action: "deny-comment",
      filePath: testFile,
      commentId: "comment-1",
    });
    const result = await runTool(officecliTool, {
      action: "review",
      filePath: testFile,
    });
    expect(result).toContain('"status": "denied"');
  });

  it("lifecycle actions reject unsupported formats", async () => {
    const mdFile = "/tmp/comment-lifecycle.md";
    writeFileSync(mdFile, "hello");
    try {
      await expect(
        runTool(officecliTool, {
          action: "delete-comment",
          filePath: mdFile,
          commentId: "c1",
        }),
      ).rejects.toThrow(/only supported for DOCX, XLSX and PPTX/);
    } finally {
      writeFileSync(mdFile, "");
    }
  });
});
