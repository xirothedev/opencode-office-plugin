import { Effect, Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import * as Draft from "@/core/draft"
import { buildWatermarkConfig, WATERMARK_EXTENSIONS } from "@/core/format/watermark"
import { writeFileSync, readFileSync, existsSync } from "fs"
import { extname, resolve, join, basename } from "path"
import { detectFormat } from "@/core/format/detect"
import { writeTrackChange, readTrackChanges, type TrackChange } from "@/core/format/ooxml/trackchanges"
import * as Comments from "@/core/comments"
import { diffTexts } from "@/core/draft/diff"
import { substituteTemplate } from "@/core/template/substitute"
import { assertTemplate, parseGenerateEntries, parseTemplateData, readCloneSource } from "@/core/template/generate"
import { parseRules, renderValidationReport } from "@/core/format/validate"
import { readLiveOrFileAsMarkdown, readRealFileAsMarkdown, type ReadOptions } from "@/core/format/read"
import { renderMarkdownFileToHtml } from "@/core/format/render"
import { writeDerivedFile, assertExportPaths } from "@/core/format/export"
import { readMetadata, METADATA_EXTENSIONS, parseMetadataProperties, type FileMetadata } from "@/core/format/metadata"
import { parseAnnotationOps, ANNOTATE_EXTENSIONS } from "@/core/format/annotate"
import { sanitizeMarkdown, sanitizeXmlText } from "@/core/format/sanitize"
import { fail, tryExecute } from "@/plugin/tools/boundary"
import { tmpdir } from "os"

const S = Schema

const createArgs = S.Struct({
  action: S.Literal("create"),
  filePath: S.optional(S.String),
  filePaths: S.optional(S.String),
  content: S.NonEmptyString,
})
const acceptArgs = S.Struct({
  action: S.Literal("accept"),
  filePath: S.optional(S.String),
  filePaths: S.optional(S.String),
  timestamp: S.optional(S.Number),
})
const undoArgs = S.Struct({ action: S.Literal("undo"), filePath: S.String })
const editArgs = S.Struct({ action: S.Literal("edit"), filePath: S.String, content: S.NonEmptyString })
const lockStatusArgs = S.Struct({ action: S.Literal("lock-status"), filePath: S.String })
const forceReleaseArgs = S.Struct({ action: S.Literal("force-release"), filePath: S.String })
const listArgs = S.Struct({ action: S.Literal("list"), filePath: S.optional(S.String) })
const diffArgs = S.Struct({ action: S.Literal("diff"), filePath: S.String })
const generateArgs = S.Struct({
  action: S.Literal("generate"),
  templatePath: S.String,
  filePath: S.optional(S.String),
  filePaths: S.optional(S.String),
  data: S.optional(S.String),
  dataArray: S.optional(S.String),
})
const historyArgs = S.Struct({ action: S.Literal("history"), filePath: S.String })
const revertArgs = S.Struct({ action: S.Literal("revert"), filePath: S.String, timestamp: S.Number })
const metadataArgs = S.Struct({ action: S.Literal("metadata"), filePath: S.String, properties: S.optional(S.String) })
const watermarkArgs = S.Struct({
  action: S.Literal("watermark"),
  filePath: S.String,
  text: S.String,
  position: S.optional(S.String),
  size: S.optional(S.Number),
  opacity: S.optional(S.Number),
})
const annotateArgs = S.Struct({ action: S.Literal("annotate"), filePath: S.String, annotations: S.String })
const exportArgs = S.Struct({ action: S.Literal("export"), filePath: S.String, targetPath: S.String })
const readArgs = S.Struct({
  action: S.Literal("read"),
  filePath: S.String,
  live: S.optional(S.Boolean),
  ocr: S.optional(S.Union([S.Boolean, S.Literal("hosted"), S.Literal("reject")])),
  apiKey: S.optional(S.String),
  apiUrl: S.optional(S.String),
})
const commentArgs = S.Struct({
  action: S.Literal("comment"),
  filePath: S.String,
  commentId: S.String,
  author: S.String,
  commentText: S.String,
  suggestedText: S.optional(S.String),
  targetText: S.optional(S.String),
  rangeStartParagraph: S.optional(S.Number),
  rangeStartOffset: S.optional(S.Number),
  rangeEndParagraph: S.optional(S.Number),
  rangeEndOffset: S.optional(S.Number),
  cellRef: S.optional(S.String),
  slide: S.optional(S.Number),
  x: S.optional(S.Number),
  y: S.optional(S.Number),
})
const approveArgs = S.Struct({ action: S.Literal("approve"), filePath: S.String, commentId: S.String })
const editCommentArgs = S.Struct({
  action: S.Literal("edit-comment"),
  filePath: S.String,
  commentId: S.String,
  text: S.optional(S.String),
  suggestedText: S.optional(S.String),
})
const deleteCommentArgs = S.Struct({ action: S.Literal("delete-comment"), filePath: S.String, commentId: S.String })
const resolveCommentArgs = S.Struct({ action: S.Literal("resolve-comment"), filePath: S.String, commentId: S.String })
const denyCommentArgs = S.Struct({ action: S.Literal("deny-comment"), filePath: S.String, commentId: S.String })
const trackChangeArgs = S.Struct({
  action: S.Union([S.Literal("track-insert"), S.Literal("track-delete")]),
  filePath: S.String,
  commentId: S.String,
  author: S.String,
  content: S.String,
  paragraph: S.Number,
  offset: S.Number,
})
const listCommentsArgs = S.Struct({ action: S.Literal("list-comments"), filePath: S.String })
const previewArgs = S.Struct({ action: S.Literal("preview"), filePath: S.String })
const cloneArgs = S.Struct({ action: S.Literal("clone"), filePath: S.String, targetPath: S.String })
const substituteArgs = S.Struct({ action: S.Literal("substitute"), filePath: S.String, data: S.String })
const verifyL3Args = S.Struct({ action: S.Literal("verify-l3"), filePath: S.String, referencePath: S.String })
const validateArgs = S.Struct({ action: S.Literal("validate"), filePath: S.String, rules: S.String })
const reviewArgs = S.Struct({ action: S.Literal("review"), filePath: S.String })

const officecliInput = S.Union([
  createArgs,
  acceptArgs,
  undoArgs,
  editArgs,
  lockStatusArgs,
  forceReleaseArgs,
  listArgs,
  diffArgs,
  generateArgs,
  historyArgs,
  revertArgs,
  metadataArgs,
  watermarkArgs,
  annotateArgs,
  exportArgs,
  readArgs,
  commentArgs,
  approveArgs,
  editCommentArgs,
  deleteCommentArgs,
  resolveCommentArgs,
  denyCommentArgs,
  trackChangeArgs,
  listCommentsArgs,
  previewArgs,
  validateArgs,
  reviewArgs,
  cloneArgs,
  substituteArgs,
  verifyL3Args,
])
type OfficeCliInput = Schema.Schema.Type<typeof officecliInput>

const officecliOutput = S.String

export const officecliTool: Tool.Info<typeof officecliInput, typeof officecliOutput> = {
  name: "officecli",
  description:
    "MAIN method for all Office and PDF files (.docx/.doc/.dotx/.xlsx/.xls/.xlsm/.pptx/.ppt/.pdf and images) — handle every read, create, edit, accept, undo, history, revert, comment, track-change, metadata, watermark, export through this tool. The native read/edit/write tools are blocked for these extensions and will error with 'use officecli'. Draft lifecycle: create/edit → accept (writes real file, snapshots version). Preview renders draft to HTML, validate checks draft against rules, lock-status/force-release manage stale locks (default 24h). Comments for DOCX/XLSX/PPTX, track changes for DOCX, suggestions via comment+suggestedText+approve (PPTX approve accepts optional targetText to pick the box). Comment lifecycle: open/resolved/denied via edit-comment/delete-comment/resolve-comment/deny-comment; list-comments/review surface status. L3 Fidelity: clone (copy Reference ZIP verbatim for 100% Format), substitute (run-preserving {{placeholder}} replace on Draft ZIP), verify-l3 (OOXML diff except text nodes).",
  input: officecliInput,
  output: officecliOutput,
  options: { codemode: false },
  execute: (input, context) =>
    tryExecute(async () => ({ output: await runAction(input, context) })),
}

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

// ponytail: office.preview resolves a structured object for the host UI instead of the
// agent-facing HTML-render string; every other invoke keeps returning the action's string
const officePreviewMimes: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

// ponytail: data URLs above 20 MB would bloat the invoke payload; host falls back to the built-in preview
const officePreviewFileCapBytes = 20 * 1024 * 1024

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
    // ponytail: zip draft can't be sent as markdown text — extract or fallback to fileUrl
    try {
      const buf = readFileSync(target)
      const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b
      result.content = isZip ? await readRealFileAsMarkdown(target) : buf.toString("utf-8")
    } catch {
      result.content = readFileSync(target, "utf-8")
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

async function runAction(input: OfficeCliInput, context: Tool.Context): Promise<string> {
  const sessionID = context.sessionID
  const owner = context.agent

  if (input.action === "create") {
    const { filePath, filePaths, content } = input
    if (!filePath && !filePaths) {
      fail("create requires filePath or filePaths")
    }
    const cleanContent = sanitizeMarkdown(content)
    const targets = parseFilePaths(filePaths)
    if (typeof targets === "string") {
      fail(targets)
    }
    if (filePath && targets.length === 0) {
      Draft.create(filePath, sessionID, owner, cleanContent)
      return `Draft created for ${filePath}`
    }
    const paths = targets.length > 0 ? targets : [filePath as string]
    for (const p of paths) {
      Draft.assertNoForeignLock(p, sessionID, true)
    }
    for (const p of paths) {
      Draft.create(p, sessionID, owner, cleanContent)
    }
    return `Created ${paths.length} drafts`
  }

  if (input.action === "accept") {
    const { filePath, filePaths, timestamp } = input
    if (!filePath && !filePaths) {
      fail("accept requires filePath or filePaths")
    }
    const targets = parseFilePaths(filePaths)
    if (typeof targets === "string") {
      fail(targets)
    }
    if (filePath && targets.length === 0) {
      Draft.requireOwned(filePath, sessionID, "no active draft to accept")
      Draft.requireDraftExists(filePath, sessionID, `draft not found for ${filePath}`)
      await Draft.accept(filePath, sessionID, timestamp)
      return `Accepted draft for ${filePath}`
    }
    const paths = targets.length > 0 ? targets : [filePath as string]
    for (const p of paths) {
      Draft.requireOwned(p, sessionID, `no active draft to accept for ${p}`)
      Draft.requireDraftExists(p, sessionID, `draft not found for ${p}`)
    }
    for (const p of paths) {
      await Draft.accept(p, sessionID, timestamp)
    }
    return `Accepted ${paths.length} drafts`
  }

  if (input.action === "undo") {
    Draft.requireOwned(input.filePath, sessionID, "no active draft to undo")
    Draft.undo(input.filePath, sessionID)
    return `Draft undone for ${input.filePath}`
  }

  if (input.action === "edit") {
    Draft.requireOwned(input.filePath, sessionID, "no active draft to edit")
    Draft.requireDraftExists(input.filePath, sessionID)
    Draft.write(input.filePath, sessionID, sanitizeMarkdown(input.content))
    return `Draft edited for ${input.filePath}`
  }

  if (input.action === "lock-status") {
    const lock = Draft.status(input.filePath)
    if (!lock) {
      return `no lock on ${input.filePath}`
    }
    return JSON.stringify({
      sessionID: lock.sessionID,
      owner: lock.owner,
      status: lock.status,
      stale: lock.stale,
      touchedAt: lock.touchedAt,
    })
  }

  if (input.action === "force-release") {
    Draft.forceRelease(input.filePath, sessionID, owner)
    return `Force released lock on ${input.filePath}`
  }

  if (input.action === "list") {
    return JSON.stringify(Draft.listDrafts(input.filePath), null, 2)
  }

  if (input.action === "diff") {
    if (!Draft.exists(input.filePath, sessionID)) {
      const sessions = Draft.draftSessions(input.filePath)
      if (sessions.length > 0) {
        fail(`no draft for this session; draft held by session ${sessions[0]}`)
      }
      fail("no active draft to diff")
    }
    if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    if (detectFormat(input.filePath) === "image") {
      fail("diff not supported for images")
    }
    const draftContent = await Draft.draftMarkdown(input.filePath, sessionID)
    const realContent = await readRealFileAsMarkdown(input.filePath)
    return diffTexts(realContent, draftContent)
  }

  if (input.action === "generate") {
    assertTemplate(input.templatePath)
    const entries = parseGenerateEntries(input)
    const template = await readRealFileAsMarkdown(input.templatePath)
    // Validate every entry before creating anything: a missing key or a held
    // lock must abort with no partial drafts
    const prepared: Array<{ filePath: string; content: string }> = []
    for (const entry of entries) {
      Draft.assertNoForeignLock(entry.filePath, sessionID, false)
      prepared.push({ filePath: entry.filePath, content: sanitizeMarkdown(substituteTemplate(template, entry.data)) })
    }
    for (const p of prepared) {
      Draft.create(p.filePath, sessionID, owner, p.content)
    }
    return `Generated ${prepared.length} drafts from ${input.templatePath}`
  }

  if (input.action === "history") {
    const history = Draft.history(input.filePath)
    return `${history.length} accept-points for ${input.filePath}\n${JSON.stringify(history)}`
  }

  if (input.action === "revert") {
    Draft.revert(input.filePath, sessionID, owner, input.timestamp)
    return `Reverted to snapshot for ${input.filePath}`
  }

  if (input.action === "metadata") {
    const ext = extname(input.filePath).toLowerCase()
    if (!METADATA_EXTENSIONS.includes(ext)) {
      fail("metadata only supported for DOCX, XLSX, PPTX and PDF files")
    }
    if (input.properties !== undefined) {
      requireDraftFor(input.filePath, sessionID)
      const sidecar = Draft.readSidecarFor(input.filePath, sessionID) ?? {}
      sidecar.metadata = parseMetadataProperties(input.properties)
      Draft.writeSidecarFor(input.filePath, sessionID, sidecar)
      return `Metadata set for ${input.filePath}`
    }
    if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    const real = await readMetadata(input.filePath)
    const sidecar = Draft.readSidecarFor(input.filePath, sessionID)
    const merged: FileMetadata = { ...real, ...(sidecar?.metadata) }
    return JSON.stringify(merged, null, 2)
  }

  if (input.action === "watermark") {
    const ext = extname(input.filePath).toLowerCase()
    if (!WATERMARK_EXTENSIONS.includes(ext)) {
      fail("watermark only supported for DOCX and PDF files")
    }
    requireDraftFor(input.filePath, sessionID)
    const sidecar = Draft.readSidecarFor(input.filePath, sessionID) ?? {}
    if (input.text === "") {
      delete sidecar.watermark
      Draft.writeSidecarFor(input.filePath, sessionID, sidecar)
      return `Watermark removed for ${input.filePath}`
    }
    sidecar.watermark = buildWatermarkConfig(ext, {
      text: input.text,
      position: input.position,
      size: input.size,
      opacity: input.opacity,
    })
    Draft.writeSidecarFor(input.filePath, sessionID, sidecar)
    return `Watermark set for ${input.filePath}: "${input.text}"`
  }

  if (input.action === "annotate") {
    const ext = extname(input.filePath).toLowerCase()
    if (!ANNOTATE_EXTENSIONS.includes(ext)) {
      fail("annotate only supported for PNG and JPG images")
    }
    requireDraftFor(input.filePath, sessionID)
    const ops = parseAnnotationOps(ext, input.annotations)
    const sidecar = Draft.readSidecarFor(input.filePath, sessionID) ?? {}
    if (ops === null) {
      delete sidecar.annotations
      Draft.writeSidecarFor(input.filePath, sessionID, sidecar)
      return `Annotations cleared for ${input.filePath}`
    }
    sidecar.annotations = [...(sidecar.annotations ?? []), ...ops]
    Draft.writeSidecarFor(input.filePath, sessionID, sidecar)
    return `Annotations added to draft for ${input.filePath}: ${ops.length}`
  }

  if (input.action === "export") {
    const hasDraft = Draft.exists(input.filePath, sessionID)
    if (!hasDraft && !existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    assertExportPaths(input.filePath, input.targetPath)
    const markdown = hasDraft
      ? await Draft.draftMarkdown(input.filePath, sessionID)
      : await readRealFileAsMarkdown(input.filePath)
    await writeDerivedFile(markdown, input.targetPath)
    return `Exported ${input.filePath} to ${input.targetPath}`
  }

  if (input.action === "read") {
    const readOpts =
      input.ocr !== undefined || input.apiKey !== undefined || input.apiUrl !== undefined
        ? { ocr: input.ocr as never, apiKey: input.apiKey, apiUrl: input.apiUrl }
        : undefined

    // Return draft if exists, else real file (live flag prefers Word app when on same machine)
    if (Draft.exists(input.filePath, sessionID)) {
      const draftPath = Draft.draftPath(input.filePath, sessionID)
      // ponytail: zip draft (comment/track) holds real OOXML — extract text, don't dump PK
      const buf = readFileSync(draftPath)
      const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b
      if (isZip) return await readWithOcrError(draftPath, readOpts)
      return buf.toString("utf-8")
    }
    if (input.live === true) {
      try {
        return await readLiveOrFileAsMarkdown(input.filePath, true, readOpts)
      } catch {
        // ponytail: live best-effort failed, fall through to file check
      }
    }
    if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    return await readWithOcrError(input.filePath, readOpts)
  }
  if (input.action === "comment") {
    Comments.requireFormat(input.filePath, "comments")
    const newComment = {
      id: input.commentId,
      author: input.author,
      text: input.commentText,
      suggestedText: input.suggestedText,
      targetText: input.targetText,
      rangeStartParagraph: input.rangeStartParagraph,
      rangeStartOffset: input.rangeStartOffset,
      rangeEndParagraph: input.rangeEndParagraph,
      rangeEndOffset: input.rangeEndOffset,
      cellRef: input.cellRef,
      slide: input.slide,
      x: input.x,
      y: input.y,
    }
    Comments.validate(input.filePath, newComment)
    Draft.requireOwned(input.filePath, sessionID, "no active draft to add comment")
    Draft.requireDraftExists(input.filePath, sessionID)
    const draftPath = Draft.draftPath(input.filePath, sessionID)
    await Comments.add(draftPath, newComment)
    return `Comment added to draft for ${input.filePath}`
  }

  if (input.action === "approve") {
    Comments.requireFormat(input.filePath, "suggestions")
    Draft.requireOwned(input.filePath, sessionID, "no active draft to approve")
    Draft.requireDraftExists(input.filePath, sessionID)
    const draftPath = Draft.draftPath(input.filePath, sessionID)
    const result = await Comments.applySuggestion(draftPath, input.commentId)
    if (result === "not-found") {
      fail(`comment ${input.commentId} not found`)
    }
    if (result === "no-suggestion") {
      fail(`comment ${input.commentId} has no suggestion to approve`)
    }
    return `Approved comment ${input.commentId} on ${input.filePath}: suggestion applied`
  }

  if (
    input.action === "edit-comment" ||
    input.action === "delete-comment" ||
    input.action === "resolve-comment" ||
    input.action === "deny-comment"
  ) {
    Comments.requireFormat(input.filePath, "comment lifecycle actions")
    Draft.requireOwned(input.filePath, sessionID, `no active draft to ${input.action.replace("-", " ")}`)
    Draft.requireDraftExists(input.filePath, sessionID)
    const draftPath = Draft.draftPath(input.filePath, sessionID)
    if (input.action === "edit-comment") {
      if (input.text === undefined && input.suggestedText === undefined) {
        fail("edit-comment requires text or suggestedText")
      }
      const result = await Comments.update(draftPath, input.commentId, {
        text: input.text,
        suggestedText: input.suggestedText,
      })
      if (result === "not-found") {
        fail(`comment ${input.commentId} not found`)
      }
      return `Comment ${input.commentId} updated on ${input.filePath}`
    }
    if (input.action === "delete-comment") {
      const result = await Comments.remove(draftPath, input.commentId)
      if (result === "not-found") {
        fail(`comment ${input.commentId} not found`)
      }
      return `Comment ${input.commentId} deleted from ${input.filePath}`
    }
    const status = input.action === "resolve-comment" ? "resolved" : "denied"
    const result = await Comments.setStatus(draftPath, input.commentId, status)
    if (result === "not-found") {
      fail(`comment ${input.commentId} not found`)
    }
    return `Comment ${input.commentId} marked ${status} on ${input.filePath}`
  }

  if (input.action === "track-insert" || input.action === "track-delete") {
    const ext = extname(input.filePath)
    if (ext !== ".docx") {
      fail("track changes not supported for XLSX/PPTX files (w:ins/w:del is Word-only OOXML); use comment action for review feedback")
    }
    Draft.requireOwned(input.filePath, sessionID, "no active draft to add track change")
    Draft.requireDraftExists(input.filePath, sessionID)
    const draftPath = Draft.draftPath(input.filePath, sessionID)
    const trackChange: TrackChange = {
      id: input.commentId,
      type: input.action === "track-insert" ? "insertion" : "deletion",
      author: sanitizeXmlText(input.author),
      timestamp: new Date(),
      text: sanitizeXmlText(input.content),
      paragraph: input.paragraph,
      offset: input.offset,
    }
    await writeTrackChange(draftPath, trackChange)
    return `Track change added to draft for ${input.filePath}`
  }

  if (input.action === "list-comments") {
    Comments.requireFormat(input.filePath, "comments")
    let targetPath = input.filePath
    if (Draft.exists(input.filePath, sessionID)) {
      targetPath = Draft.draftPath(input.filePath, sessionID)
    } else if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    const comments = await Comments.list(targetPath)
    return `${comments.length} comments\n${JSON.stringify(comments, null, 2)}`
  }

  if (input.action === "preview") {
    if (!Draft.exists(input.filePath, sessionID)) {
      fail("no active draft to preview")
    }
    const filePathHash = Draft.hashOf(input.filePath)
    const outputPath = join(tmpdir(), "openoffice-preview", `${filePathHash}.html`)
    try {
      const md = await Draft.draftMarkdown(input.filePath, sessionID)
      const tmpMd = join(tmpdir(), `openoffice-preview-${filePathHash}.md`)
      writeFileSync(tmpMd, md)
      await renderMarkdownFileToHtml(tmpMd, outputPath)
    } catch (error) {
      fail((error as Error).message)
    }
    return `Preview rendered to ${outputPath}`
  }

  if (input.action === "validate") {
    const rules = parseRules(input.rules)
    if (!Draft.exists(input.filePath, sessionID)) {
      fail("no active draft to validate")
    }
    const content = await Draft.draftMarkdown(input.filePath, sessionID)
    return renderValidationReport(input.filePath, content, rules)
  }

  if (input.action === "review") {
    const ext = Comments.requireFormat(input.filePath, "review")
    let targetPath = input.filePath
    if (Draft.exists(input.filePath, sessionID)) {
      targetPath = Draft.draftPath(input.filePath, sessionID)
    } else if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    const comments = await Comments.list(targetPath)
    if (ext === ".xlsx") {
      return `Review summary for ${input.filePath}:\n${comments.length} comments (XLSX has no track changes)\n\nComments:\n${JSON.stringify(comments, null, 2)}`
    }
    if (ext === ".pptx") {
      return `Review summary for ${input.filePath}:\n${comments.length} comments (PPTX has no track changes)\n\nComments:\n${JSON.stringify(comments, null, 2)}`
    }
    const trackChanges = await readTrackChanges(targetPath)
    return `Review summary for ${input.filePath}:\n${comments.length} comments, ${trackChanges.length} track changes\n\nComments:\n${JSON.stringify(comments, null, 2)}\n\nTrack Changes:\n${JSON.stringify(trackChanges, null, 2)}`
  }

  if (input.action === "clone") {
    const buf = readCloneSource(resolve(input.filePath), input.filePath)
    const targetPath = resolve(input.targetPath)
    if (targetPath === resolve(input.filePath)) fail("targetPath must differ from filePath")
    Draft.assertNoForeignLock(targetPath, sessionID, true, input.targetPath)
    Draft.cloneIntoDraft(targetPath, sessionID, owner, buf)
    return `Cloned ${input.filePath} to draft for ${input.targetPath} (L3 Format preserved)`
  }

  if (input.action === "substitute") {
    requireDraftFor(input.filePath, sessionID)
    const data = parseTemplateData(input.data)
    const { replaced, format } = await Draft.substituteInDraft(input.filePath, sessionID, data)
    return `Substituted ${replaced} placeholders in ${input.filePath} (${format}, run-preserving)`
  }

  if (input.action === "verify-l3") {
    const fileA = resolve(input.filePath)
    const fileB = resolve(input.referencePath)
    if (!existsSync(fileA)) fail(`file not found: ${input.filePath}`)
    if (!existsSync(fileB)) fail(`reference not found: ${input.referencePath}`)
    const { verifyL3 } = await import("@/core/format/verify-l3")
    const result = await verifyL3(fileA, fileB)
    return result.pass
      ? `L3 PASS: ${input.filePath} vs ${input.referencePath} — only text nodes differ (${result.textDiffs} diffs, ${result.checkedFiles} files checked)`
      : `L3 FAIL: ${input.filePath} vs ${input.referencePath} — Format differs\n${result.details}`
  }

  fail(`action ${input.action} not implemented`)
}

// The metadata/watermark/annotate/substitute preamble, in one call into Draft
function requireDraftFor(filePath: string, sessionID: string): void {
  Draft.requireOwned(filePath, sessionID, "no active draft")
  Draft.requireDraftExists(filePath, sessionID)
}

// needsOcr/hosted are the tool's agent-facing read contract (ADR: Hosted OCR);
// both the draft and the file branch of the read action share this mapping.
async function readWithOcrError(path: string, opts?: ReadOptions): Promise<string> {
  try {
    return await readRealFileAsMarkdown(path, opts)
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === "needsOcr") {
      const pages = (error as { pages?: number[] })?.pages ?? []
      const pageCount = (error as { pageCount?: number })?.pageCount ?? 0
      fail(
        JSON.stringify({
          code: "needsOcr",
          pages,
          pageCount,
          hint: "retry with ocr: \"hosted\" (or ocr: true) — sends document to Firecrawl Parse for OCR",
        }),
      )
    }
    if (code === "hosted") fail(`hosted OCR failed: ${(error as Error).message}`)
    throw error
  }
}

function parseFilePaths(filePaths: string | undefined): string[] | string {
  if (filePaths === undefined) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(filePaths)
  } catch {
    return "invalid filePaths JSON"
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((p) => typeof p === "string")) {
    return "filePaths must be a non-empty array of strings"
  }
  return parsed
}
