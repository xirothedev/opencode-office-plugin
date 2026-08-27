import { describe, it, expect } from "vitest"
import { Tool } from "@opencode-ai/schema/tool"
import { officecliTool, officecliInvokes, runOfficecliInvoke } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile, mockContext } from "./harness"
import { getFilePathHash } from "@/core/storage/paths"
import { getDraftPath } from "@/core/draft/manager"
import { writeComment } from "@/core/format/ooxml/comments"
import { copyFileSync, readFileSync, utimesSync } from "fs"
import { join } from "path"

const DOCX_FILE = "/tmp/office-invoke.docx"
const MD_FILE = "/tmp/office-invoke.md"
const SESSION = "test-session"
const DOCX_FIXTURE = join(process.cwd(), "test/fixtures/sample.docx")

type PreviewComment = {
  id: string
  author: string
  text: string
  status: "open" | "resolved" | "denied"
  suggestedText?: string
  anchor?: string
  createdAt: number
}

type PreviewResult = {
  managed: boolean
  source?: "draft" | "file"
  filename?: string
  contentType?: string
  content?: string
  fileUrl?: string
  comments?: PreviewComment[]
  lock?: { sessionID: string; owner: string; stale: boolean }
}

function parseList(result: string): Array<Record<string, unknown>> {
  return JSON.parse(result.slice(result.indexOf("\n") + 1)) as Array<
    Record<string, unknown>
  >
}

describe("officecli host invokes", () => {
  setupHermeticDirs()
  cleanupTestFile(DOCX_FILE)
  cleanupTestFile(MD_FILE)

  it("registers one invoke per host-driven action", () => {
    expect(Object.keys(officecliInvokes).sort()).toEqual([
      "office.accept",
      "office.comment.approve",
      "office.comment.create",
      "office.comment.delete",
      "office.comment.deny",
      "office.comment.edit",
      "office.comment.resolve",
      "office.edit.save",
      "office.preview",
    ])
  })

  it("office.comment.create writes a comment as the lock owner", async () => {
    await runTool(officecliTool, {
      action: "create",
      filePath: DOCX_FILE,
      content: "stub",
    })
    copyFileSync(
      DOCX_FIXTURE,
      getDraftPath(getFilePathHash(DOCX_FILE), SESSION, ".docx"),
    )

    await runOfficecliInvoke("office.comment.create", {
      filename: DOCX_FILE,
      commentId: "c-invoke",
      author: "Host UI",
      commentText: "from host",
      rangeStartParagraph: 0,
      rangeStartOffset: 0,
      rangeEndParagraph: 0,
      rangeEndOffset: 5,
    })

    const [comment] = parseList(
      await runTool(officecliTool, {
        action: "list-comments",
        filePath: DOCX_FILE,
      }),
    )
    expect(comment.id).toBe("c-invoke")
    expect(comment.status).toBe("open")
  })

  it("office.preview returns the managed draft with lock", async () => {
    await runTool(officecliTool, {
      action: "create",
      filePath: MD_FILE,
      content: "# Title",
    })

    const out = (await runOfficecliInvoke("office.preview", {
      filePath: MD_FILE,
      sessionID: SESSION,
    })) as PreviewResult
    expect(out.managed).toBe(true)
    expect(out.source).toBe("draft")
    expect(out.filename).toBe("office-invoke.md")
    expect(out.contentType).toBe("markdown")
    expect(out.content).toBe("# Title")
    expect(out.fileUrl).toBeUndefined()
    expect(out.comments).toEqual([])
    expect(out.lock).toEqual({
      sessionID: SESSION,
      owner: "test-agent",
      stale: false,
    })
  })

  it("office.preview prefers the requested session draft, else the most recent", async () => {
    const hash = getFilePathHash(MD_FILE)
    await runTool(officecliTool, {
      action: "create",
      filePath: MD_FILE,
      content: "old draft",
    })
    await runTool(
      officecliTool,
      { action: "create", filePath: MD_FILE, content: "new draft" },
      {
        ...mockContext,
        sessionID: "other-session",
        agent: "other-agent",
      },
    )
    utimesSync(getDraftPath(hash, SESSION, ".md"), 1_000_000, 1_000_000)
    utimesSync(
      getDraftPath(hash, "other-session", ".md"),
      2_000_000,
      2_000_000,
    )

    const fallback = (await runOfficecliInvoke("office.preview", {
      filePath: MD_FILE,
    })) as PreviewResult
    expect(fallback.source).toBe("draft")
    expect(fallback.content).toBe("new draft")

    const pinned = (await runOfficecliInvoke("office.preview", {
      filePath: MD_FILE,
      sessionID: SESSION,
    })) as PreviewResult
    expect(pinned.content).toBe("old draft")
  })

  it("office.preview shapes draft comments for office files", async () => {
    await runTool(officecliTool, {
      action: "create",
      filePath: DOCX_FILE,
      content: "stub",
    })
    copyFileSync(
      DOCX_FIXTURE,
      getDraftPath(getFilePathHash(DOCX_FILE), SESSION, ".docx"),
    )
    await runOfficecliInvoke("office.comment.create", {
      filename: DOCX_FILE,
      commentId: "c-preview",
      author: "Host UI",
      commentText: "preview comment",
      rangeStartParagraph: 0,
      rangeStartOffset: 0,
      rangeEndParagraph: 0,
      rangeEndOffset: 5,
    })

    const out = (await runOfficecliInvoke("office.preview", {
      filePath: DOCX_FILE,
      sessionID: SESSION,
    })) as PreviewResult
    expect(out.source).toBe("draft")
    expect(typeof out.content).toBe("string")
    const comment = out.comments?.find((c) => c.id === "c-preview")
    expect(comment).toMatchObject({
      id: "c-preview",
      author: "Host UI",
      text: "preview comment",
      status: "open",
      anchor: "0:0",
    })
    expect(typeof comment?.createdAt).toBe("number")
  })

  it("office.preview returns the managed file without a draft", async () => {
    copyFileSync(DOCX_FIXTURE, DOCX_FILE)
    await writeComment(DOCX_FILE, {
      id: "c-file",
      author: "File Author",
      text: "from real file",
      timestamp: new Date(1700000000000),
      rangeStart: { paragraph: 0, offset: 0 },
      rangeEnd: { paragraph: 0, offset: 4 },
      parentId: null,
      status: "resolved",
      suggestedText: "suggested",
    })

    const out = (await runOfficecliInvoke("office.preview", {
      filePath: DOCX_FILE,
    })) as PreviewResult
    expect(out.managed).toBe(true)
    expect(out.source).toBe("file")
    expect(out.filename).toBe("office-invoke.docx")
    expect(out.content).toBeUndefined()
    expect(
      out.fileUrl?.startsWith(
        "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,",
      ),
    ).toBe(true)
    const comment = out.comments?.find((c) => c.id === "c-file")
    expect(comment).toMatchObject({
      id: "c-file",
      author: "File Author",
      // docx reader returns the stored text, which carries the suggestion prefix
      text: "Suggested text: suggested",
      status: "resolved",
      suggestedText: "suggested",
      anchor: "0:0",
      createdAt: 1700000000000,
    })
    expect(out.lock).toBeUndefined()
  })

  it("office.preview resolves managed false for unknown paths", async () => {
    const out = (await runOfficecliInvoke("office.preview", {
      filePath: "/tmp/office-invoke-unknown.docx",
    })) as PreviewResult
    expect(out).toEqual({ managed: false })
  })

  it("office.edit.save writes draft content and resolves a string", async () => {
    await runTool(officecliTool, {
      action: "create",
      filePath: MD_FILE,
      content: "before",
    })

    const out = await runOfficecliInvoke("office.edit.save", {
      filePath: MD_FILE,
      content: "after",
    })
    expect(typeof out).toBe("string")
    expect(
      readFileSync(
        getDraftPath(getFilePathHash(MD_FILE), SESSION, ".md"),
        "utf-8",
      ),
    ).toBe("after")
  })

  it("office.accept writes the draft to the real file", async () => {
    await runTool(officecliTool, {
      action: "create",
      filePath: MD_FILE,
      content: "accepted",
    })

    await runOfficecliInvoke("office.accept", { filePath: MD_FILE })
    expect(readFileSync(MD_FILE, "utf-8")).toBe("accepted")
  })

  it("rejects unknown invoke names", async () => {
    await expect(
      runOfficecliInvoke("office.bogus", { filePath: MD_FILE }),
    ).rejects.toBeInstanceOf(Tool.Error)
  })

  it("rejects invokes without filePath", async () => {
    await expect(runOfficecliInvoke("office.preview", {})).rejects.toThrow(
      "requires filePath",
    )
  })
})
