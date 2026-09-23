import { describe, it, expect } from "bun:test";
import { copyFileSync, readFileSync, utimesSync } from "node:fs";
import path from "node:path";

import { Tool } from "@opencode/schema/tool";

import { getDraftPath } from "@/core/draft/manager";
import { writeComment } from "@/core/format/ooxml/comments";
import { getFilePathHash } from "@/core/storage/paths";
import { officecliInvokes, runOfficecliInvoke } from "@/plugin/host";
import { officecliTool } from "@/plugin/tools/officecli";

import {
  runTool,
  setupHermeticDirs,
  cleanupTestFile,
  mockContext,
} from "./harness";

const DOCX_FILE = "/tmp/office-invoke.docx";
const MD_FILE = "/tmp/office-invoke.md";
const SESSION = "test-session";
const DOCX_FIXTURE = path.join(process.cwd(), "test/fixtures/sample.docx");

interface PreviewComment {
  id: string;
  author: string;
  text: string;
  status: "open" | "resolved" | "denied";
  suggestedText?: string;
  anchor?: string;
  createdAt: number;
}

interface PreviewResult {
  managed: boolean;
  source?: "draft" | "file";
  filename?: string;
  contentType?: string;
  content?: string;
  fileUrl?: string;
  comments?: PreviewComment[];
  lock?: { sessionID: string; owner: string; stale: boolean };
}

const parseList = (result: string): Record<string, unknown>[] =>
  JSON.parse(result.slice(result.indexOf("\n") + 1)) as Record<
    string,
    unknown
  >[];

describe("officecli host invokes", () => {
  setupHermeticDirs();
  cleanupTestFile(DOCX_FILE);
  cleanupTestFile(MD_FILE);

  it("registers one invoke per host-driven action", () => {
    expect(Object.keys(officecliInvokes).toSorted()).toEqual([
      "office.accept",
      "office.comment.approve",
      "office.comment.create",
      "office.comment.delete",
      "office.comment.deny",
      "office.comment.edit",
      "office.comment.resolve",
      "office.edit.save",
      "office.preview",
    ]);
  });

  it("office.comment.create writes a comment as the lock owner", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "stub",
      filePath: DOCX_FILE,
    });
    copyFileSync(
      DOCX_FIXTURE,
      getDraftPath(getFilePathHash(DOCX_FILE), SESSION, ".docx")
    );

    await runOfficecliInvoke("office.comment.create", {
      author: "Host UI",
      commentId: "c-invoke",
      commentText: "from host",
      filename: DOCX_FILE,
      rangeEndOffset: 5,
      rangeEndParagraph: 0,
      rangeStartOffset: 0,
      rangeStartParagraph: 0,
    });

    const [comment] = parseList(
      await runTool(officecliTool, {
        action: "list-comments",
        filePath: DOCX_FILE,
      })
    );
    expect(comment.id).toBe("c-invoke");
    expect(comment.status).toBe("open");
  });

  it("office.preview returns the managed draft with lock", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Title",
      filePath: MD_FILE,
    });

    const out = (await runOfficecliInvoke("office.preview", {
      filePath: MD_FILE,
      sessionID: SESSION,
    })) as PreviewResult;
    expect(out.managed).toBe(true);
    expect(out.source).toBe("draft");
    expect(out.filename).toBe("office-invoke.md");
    expect(out.contentType).toBe("markdown");
    expect(out.content).toBe("# Title");
    expect(out.fileUrl).toBeUndefined();
    expect(out.comments).toEqual([]);
    expect(out.lock).toEqual({
      owner: "test-agent",
      sessionID: SESSION,
      stale: false,
    });
  });

  it("office.preview prefers the requested session draft, else the most recent", async () => {
    const hash = getFilePathHash(MD_FILE);
    await runTool(officecliTool, {
      action: "create",
      content: "old draft",
      filePath: MD_FILE,
    });
    await runTool(
      officecliTool,
      { action: "create", content: "new draft", filePath: MD_FILE },
      {
        ...mockContext,
        agent: "other-agent",
        sessionID: "other-session",
      }
    );
    utimesSync(getDraftPath(hash, SESSION, ".md"), 1_000_000, 1_000_000);
    utimesSync(
      getDraftPath(hash, "other-session", ".md"),
      2_000_000,
      2_000_000
    );

    const fallback = (await runOfficecliInvoke("office.preview", {
      filePath: MD_FILE,
    })) as PreviewResult;
    expect(fallback.source).toBe("draft");
    expect(fallback.content).toBe("new draft");

    const pinned = (await runOfficecliInvoke("office.preview", {
      filePath: MD_FILE,
      sessionID: SESSION,
    })) as PreviewResult;
    expect(pinned.content).toBe("old draft");
  });

  it("office.preview shapes draft comments for office files", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "stub",
      filePath: DOCX_FILE,
    });
    copyFileSync(
      DOCX_FIXTURE,
      getDraftPath(getFilePathHash(DOCX_FILE), SESSION, ".docx")
    );
    await runOfficecliInvoke("office.comment.create", {
      author: "Host UI",
      commentId: "c-preview",
      commentText: "preview comment",
      filename: DOCX_FILE,
      rangeEndOffset: 5,
      rangeEndParagraph: 0,
      rangeStartOffset: 0,
      rangeStartParagraph: 0,
    });

    const out = (await runOfficecliInvoke("office.preview", {
      filePath: DOCX_FILE,
      sessionID: SESSION,
    })) as PreviewResult;
    expect(out.source).toBe("draft");
    expect(typeof out.content).toBe("string");
    const comment = out.comments?.find((c) => c.id === "c-preview");
    expect(comment).toMatchObject({
      anchor: "0:0",
      author: "Host UI",
      id: "c-preview",
      status: "open",
      text: "preview comment",
    });
    expect(typeof comment?.createdAt).toBe("number");
  });

  it("office.preview returns the managed file without a draft", async () => {
    copyFileSync(DOCX_FIXTURE, DOCX_FILE);
    await writeComment(DOCX_FILE, {
      author: "File Author",
      id: "c-file",
      parentId: null,
      rangeEnd: { offset: 4, paragraph: 0 },
      rangeStart: { offset: 0, paragraph: 0 },
      status: "resolved",
      suggestedText: "suggested",
      text: "from real file",
      timestamp: new Date(1_700_000_000_000),
    });

    const out = (await runOfficecliInvoke("office.preview", {
      filePath: DOCX_FILE,
    })) as PreviewResult;
    expect(out.managed).toBe(true);
    expect(out.source).toBe("file");
    expect(out.filename).toBe("office-invoke.docx");
    expect(out.content).toBeUndefined();
    expect(
      out.fileUrl?.startsWith(
        "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,"
      )
    ).toBe(true);
    const comment = out.comments?.find((c) => c.id === "c-file");
    expect(comment).toMatchObject({
      anchor: "0:0",
      author: "File Author",
      createdAt: 1_700_000_000_000,
      id: "c-file",
      status: "resolved",
      suggestedText: "suggested",
      // docx reader returns the stored text, which carries the suggestion prefix
      text: "Suggested text: suggested",
    });
    expect(out.lock).toBeUndefined();
  });

  it("office.preview resolves managed false for unknown paths", async () => {
    const out = (await runOfficecliInvoke("office.preview", {
      filePath: "/tmp/office-invoke-unknown.docx",
    })) as PreviewResult;
    expect(out).toEqual({ managed: false });
  });

  it("office.edit.save writes draft content and resolves a string", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "before",
      filePath: MD_FILE,
    });

    const out = await runOfficecliInvoke("office.edit.save", {
      content: "after",
      filePath: MD_FILE,
    });
    expect(typeof out).toBe("string");
    expect(
      readFileSync(
        getDraftPath(getFilePathHash(MD_FILE), SESSION, ".md"),
        "utf-8"
      )
    ).toBe("after");
  });

  it("office.accept writes the draft to the real file", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "accepted",
      filePath: MD_FILE,
    });

    await runOfficecliInvoke("office.accept", { filePath: MD_FILE });
    expect(readFileSync(MD_FILE, "utf-8")).toBe("accepted");
  });

  it("rejects unknown invoke names", async () => {
    await expect(
      runOfficecliInvoke("office.bogus", { filePath: MD_FILE })
    ).rejects.toBeInstanceOf(Tool.Error);
  });

  it("rejects invokes without filePath", async () => {
    await expect(runOfficecliInvoke("office.preview", {})).rejects.toThrow(
      "requires filePath"
    );
  });
});
