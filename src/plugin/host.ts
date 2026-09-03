// Host invoke surface: the structured contract the app UI drives, separate from the
// agent-facing officecli tool. Returns objects (office.preview) or action strings;
// never Tool.Context — the session is resolved from the lock when not provided.
import { Effect, Schema } from "effect"
import { existsSync, readFileSync } from "fs"
import { basename, extname } from "path"
import * as Draft from "@/core/draft"
import * as Comments from "@/core/comments"
import { fail } from "@/plugin/tools/boundary"
import { officecliInput, officecliTool, type OfficeCliInput } from "@/plugin/tools/officecli"

// ponytail: host-facing invoke names mirror officecli actions so the app drives the same code path as the agent tool
export const officecliInvokes: Record<string, OfficeCliInput["action"]> = {
  "office.preview": "preview",
  "office.edit.save": "edit",
  "office.accept": "accept",
  "office.comment.create": "comment",
  "office.comment.edit": "edit-comment",
  "office.comment.delete": "delete-comment",
  "office.comment.resolve": "resolve-comment",
  "office.comment.deny": "deny-comment",
  "office.comment.approve": "approve",
}

// ponytail: data URLs above 20 MB would bloat the invoke payload; host falls back to the built-in preview
const officePreviewFileCapBytes = 20 * 1024 * 1024

const officePreviewMimes: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export async function runOfficecliInvoke(name: string, input: unknown): Promise<unknown> {
  if (name === "office.preview") return officePreview(input)
  const action = officecliInvokes[name]
  if (!action) fail(`unknown invoke ${name}`)
  const params: Record<string, unknown> =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const filePath = strParam(params.filePath) ?? strParam(params.filename)
  if (!filePath) fail(`${name} requires filePath`)
  const args = decodeInvokeArgs(name, { ...params, action, filePath })
  const sessionID = strParam(params.sessionID) ?? Draft.lockSession(filePath) ?? "openoffice-invoke"
  const context = {
    sessionID,
    agent: "openoffice-invoke",
    messageID: "openoffice-invoke",
    id: "openoffice-invoke",
    progress: () => Effect.void,
  } as never
  const result = await Effect.runPromise(officecliTool.execute(args, context))
  return result.output as string
}

function decodeInvokeArgs(name: string, value: Record<string, unknown>): OfficeCliInput {
  try {
    return Schema.decodeUnknownSync(officecliInput)(value)
  } catch (error) {
    fail(`invalid ${name} params: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function strParam(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

async function officePreview(input: unknown): Promise<unknown> {
  const params: Record<string, unknown> =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const filePath = strParam(params.filePath) ?? strParam(params.filename)
  if (!filePath) fail("office.preview requires filePath")
  const ext = extname(filePath).toLowerCase()
  const sessions = Draft.draftSessions(filePath)
  const managed = sessions.length > 0 || (officePreviewMimes[ext] !== undefined && existsSync(filePath))
  if (!managed) return { managed: false }
  // ponytail: draft selection prefers the requesting session, else the most recent draft by mtime
  const wanted = strParam(params.sessionID)
  const draftSession = wanted !== undefined && sessions.includes(wanted) ? wanted : Draft.mostRecentDraftSession(filePath)
  const target = draftSession ? Draft.draftPath(filePath, draftSession) : filePath
  const lock = Draft.status(filePath)
  const result: Record<string, unknown> = {
    managed: true,
    source: draftSession ? "draft" : "file",
    filename: basename(filePath),
    contentType: "markdown",
    comments: await Comments.preview(target),
  }
  if (draftSession) {
    // extraction failure (corrupt zip, pandoc missing): omit content — the host
    // falls back to its built-in preview; raw zip bytes would render as garbage
    try {
      result.content = await Draft.draftMarkdown(filePath, draftSession)
    } catch {
      // no content key
    }
  } else {
    result.fileUrl = officePreviewFileUrl(filePath, ext)
  }
  if (lock) {
    result.lock = { sessionID: lock.sessionID, owner: lock.owner, stale: lock.stale }
  }
  return result
}

function officePreviewFileUrl(filePath: string, ext: string): string | undefined {
  const data = readFileSync(filePath)
  if (data.length > officePreviewFileCapBytes) return undefined
  return `data:${officePreviewMimes[ext]};base64,${data.toString("base64")}`
}
