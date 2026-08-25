import { describe, it, expect } from "vitest"
import { Tool } from "@opencode-ai/schema/tool"
import { officecliTool, officecliInvokes, runOfficecliInvoke } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness"
import { getFilePathHash } from "@/core/storage/paths"
import { getDraftPath } from "@/core/draft/manager"
import { copyFileSync, readFileSync } from "fs"
import { join } from "path"

const DOCX_FILE = "/tmp/office-invoke.docx"
const MD_FILE = "/tmp/office-invoke.md"
const SESSION = "test-session"
const DOCX_FIXTURE = join(process.cwd(), "test/fixtures/sample.docx")

function parseList(result: string): Array<Record<string, unknown>> {
  return JSON.parse(result.slice(result.indexOf("\n") + 1)) as Array<Record<string, unknown>>
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
    await runTool(officecliTool, { action: "create", filePath: DOCX_FILE, content: "stub" })
    copyFileSync(DOCX_FIXTURE, getDraftPath(getFilePathHash(DOCX_FILE), SESSION, ".docx"))

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

    const [comment] = parseList(await runTool(officecliTool, { action: "list-comments", filePath: DOCX_FILE }))
    expect(comment.id).toBe("c-invoke")
    expect(comment.status).toBe("open")
  })

  it("office.preview renders the active draft", async () => {
    await runTool(officecliTool, { action: "create", filePath: MD_FILE, content: "# Title" })

    const out = await runOfficecliInvoke("office.preview", { filename: MD_FILE })
    expect(out).toContain("Preview rendered to")
  })

  it("office.edit.save writes draft content", async () => {
    await runTool(officecliTool, { action: "create", filePath: MD_FILE, content: "before" })

    await runOfficecliInvoke("office.edit.save", { filePath: MD_FILE, content: "after" })
    expect(readFileSync(getDraftPath(getFilePathHash(MD_FILE), SESSION, ".md"), "utf-8")).toBe("after")
  })

  it("office.accept writes the draft to the real file", async () => {
    await runTool(officecliTool, { action: "create", filePath: MD_FILE, content: "accepted" })

    await runOfficecliInvoke("office.accept", { filePath: MD_FILE })
    expect(readFileSync(MD_FILE, "utf-8")).toBe("accepted")
  })

  it("rejects unknown invoke names", async () => {
    await expect(runOfficecliInvoke("office.bogus", { filePath: MD_FILE })).rejects.toBeInstanceOf(Tool.Error)
  })

  it("rejects invokes without filePath", async () => {
    await expect(runOfficecliInvoke("office.preview", {})).rejects.toThrow("requires filePath")
  })
})
