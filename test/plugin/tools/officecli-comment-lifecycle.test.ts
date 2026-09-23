import { describe, it, expect } from "bun:test";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import JSZip from "jszip";

import { getDraftPath } from "@/core/draft/manager";
import { getFilePathHash } from "@/core/storage/paths";
import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

const testFile = "/tmp/comment-lifecycle.docx";
const SESSION = "test-session";
const DOCX_FIXTURE = path.join(process.cwd(), "test/fixtures/sample.docx");

// computed lazily: the hermetic data dir is only configured in the describe body
const draftPath = (): string =>
  getDraftPath(getFilePathHash(testFile), SESSION, ".docx");

const parseList = (
  result: string
): {
  count: number;
  comments: Record<string, unknown>[];
} => {
  const space = result.indexOf(" ");
  const count = Number(result.slice(0, space));
  const comments = JSON.parse(result.slice(result.indexOf("\n") + 1)) as Record<
    string,
    unknown
  >[];
  return { comments, count };
};

const seedDraftWithDocx = async (): Promise<void> => {
  await runTool(officecliTool, {
    action: "create",
    content: "stub",
    filePath: testFile,
  });
  copyFileSync(DOCX_FIXTURE, draftPath());
};

const addComment = async (
  commentId = "comment-1",
  text = "This clause needs review"
) => {
  await runTool(officecliTool, {
    action: "comment",
    author: "AI Agent",
    commentId,
    commentText: text,
    filePath: testFile,
    rangeEndOffset: 10,
    rangeEndParagraph: 0,
    rangeStartOffset: 0,
    rangeStartParagraph: 0,
  });
};

const listParsed = async (): Promise<{
  count: number;
  comments: Record<string, unknown>[];
}> =>
  parseList(
    await runTool(officecliTool, {
      action: "list-comments",
      filePath: testFile,
    })
  );

const readDraftPart = async (part: string): Promise<string> => {
  const zip = await JSZip.loadAsync(readFileSync(draftPath()));
  const partFile = zip.file(part);
  if (!partFile) {
    throw new Error(`missing ${part} in draft`);
  }
  return await partFile.async("string");
};

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
      commentId: "comment-1",
      filePath: testFile,
    });
    await runTool(officecliTool, {
      action: "edit-comment",
      commentId: "comment-1",
      filePath: testFile,
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
      author: "AI Agent",
      commentId: "comment-1",
      commentText: "Original note",
      filePath: testFile,
      rangeEndOffset: 10,
      rangeEndParagraph: 0,
      rangeStartOffset: 0,
      rangeStartParagraph: 0,
      suggestedText: "Original suggestion",
    });
    await runTool(officecliTool, {
      action: "edit-comment",
      commentId: "comment-1",
      filePath: testFile,
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
        commentId: "comment-1",
        filePath: testFile,
      })
    ).rejects.toThrow(/edit-comment requires text or suggestedText/u);
  });

  it("resolve-comment persists w:done on the DOCX comment", async () => {
    await seedDraftWithDocx();
    await addComment();
    const result = await runTool(officecliTool, {
      action: "resolve-comment",
      commentId: "comment-1",
      filePath: testFile,
    });
    expect(result).toContain("resolved");
    const xml = await readDraftPart("word/comments.xml");
    expect(xml).toContain('w:done="1"');
    expect(xml).not.toContain("oo:status");
    const resolvedList = await listParsed();
    expect(resolvedList.comments[0].status).toBe("resolved");
  });

  it("deny-comment persists the plugin-namespaced status attribute", async () => {
    await seedDraftWithDocx();
    await addComment();
    const result = await runTool(officecliTool, {
      action: "deny-comment",
      commentId: "comment-1",
      filePath: testFile,
    });
    expect(result).toContain("denied");
    const xml = await readDraftPart("word/comments.xml");
    expect(xml).toContain('xmlns:oo="http://opencode.ai/openoffice-plugin"');
    expect(xml).toContain('oo:status="denied"');
    expect(xml).not.toContain("w:done");
    const deniedList = await listParsed();
    expect(deniedList.comments[0].status).toBe("denied");
  });

  it("deny after resolve replaces w:done with the denied marker", async () => {
    await seedDraftWithDocx();
    await addComment();
    await runTool(officecliTool, {
      action: "resolve-comment",
      commentId: "comment-1",
      filePath: testFile,
    });
    await runTool(officecliTool, {
      action: "deny-comment",
      commentId: "comment-1",
      filePath: testFile,
    });
    const xml = await readDraftPart("word/comments.xml");
    expect(xml).toContain('oo:status="denied"');
    expect(xml).not.toContain("w:done");
    const deniedAfterResolve = await listParsed();
    expect(deniedAfterResolve.comments[0].status).toBe("denied");
  });

  it("delete-comment removes the comment and its range markers from the draft", async () => {
    await seedDraftWithDocx();
    await addComment();
    const result = await runTool(officecliTool, {
      action: "delete-comment",
      commentId: "comment-1",
      filePath: testFile,
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
        commentId: "nope",
        filePath: testFile,
        text: "x",
      })
    ).rejects.toThrow(/comment nope not found/u);
    await expect(
      runTool(officecliTool, {
        action: "delete-comment",
        commentId: "nope",
        filePath: testFile,
      })
    ).rejects.toThrow(/comment nope not found/u);
    await expect(
      runTool(officecliTool, {
        action: "resolve-comment",
        commentId: "nope",
        filePath: testFile,
      })
    ).rejects.toThrow(/comment nope not found/u);
    await expect(
      runTool(officecliTool, {
        action: "deny-comment",
        commentId: "nope",
        filePath: testFile,
      })
    ).rejects.toThrow(/comment nope not found/u);
  });

  it("lifecycle actions require an active draft", async () => {
    await expect(
      runTool(officecliTool, {
        action: "resolve-comment",
        commentId: "comment-1",
        filePath: testFile,
      })
    ).rejects.toThrow(/no active draft/u);
  });

  it("review includes the comment status", async () => {
    await seedDraftWithDocx();
    await addComment();
    await runTool(officecliTool, {
      action: "deny-comment",
      commentId: "comment-1",
      filePath: testFile,
    });
    const result = await runTool(officecliTool, {
      action: "review",
      filePath: testFile,
    });
    expect(result).toContain('"status": "denied"');
  });

  it("approve refuses a denied suggestion and leaves content untouched", async () => {
    await seedDraftWithDocx();
    await addComment("comment-1", "change needed");
    await runTool(officecliTool, {
      action: "edit-comment",
      commentId: "comment-1",
      filePath: testFile,
      suggestedText: "SHOULD-NOT-APPLY",
    });
    await runTool(officecliTool, {
      action: "deny-comment",
      commentId: "comment-1",
      filePath: testFile,
    });
    await expect(
      runTool(officecliTool, {
        action: "approve",
        commentId: "comment-1",
        filePath: testFile,
      })
    ).rejects.toThrow(/was denied/u);
    const result = await runTool(officecliTool, {
      action: "list-comments",
      filePath: testFile,
    });
    expect(JSON.parse(result.slice(result.indexOf("\n") + 1))[0].status).toBe(
      "denied"
    );
  });

  it("lifecycle actions reject unsupported formats", async () => {
    const mdFile = "/tmp/comment-lifecycle.md";
    writeFileSync(mdFile, "hello");
    try {
      await expect(
        runTool(officecliTool, {
          action: "delete-comment",
          commentId: "c1",
          filePath: mdFile,
        })
      ).rejects.toThrow(/only supported for DOCX, XLSX and PPTX/u);
    } finally {
      writeFileSync(mdFile, "");
    }
  });
});
