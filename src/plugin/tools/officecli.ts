import { Effect, Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import * as Draft from "@/core/draft"
import type { WatermarkConfig, AnnotationOp } from "@/core/draft"
import { buildWatermarkConfig } from "@/core/format/watermark"
import { writeFileSync, readFileSync, existsSync } from "fs"
import { extname, resolve, join, basename } from "path"
import { detectFormat } from "@/core/format/detect"
import { writeTrackChange, readTrackChanges, type TrackChange } from "@/core/format/ooxml/trackchanges"
import * as Comments from "@/core/comments"
import { diffTexts } from "@/core/draft/diff"
import { substituteTemplate } from "@/core/template/substitute"
import { substituteOoxml } from "@/core/template/substitute-ooxml"
import { readLiveOrFileAsMarkdown, readRealFileAsMarkdown } from "@/core/format/read"
import { renderMarkdownFileToHtml } from "@/core/format/render"
import { writeDerivedFile, EXPORT_EXTENSIONS } from "@/core/format/export"
import { readMetadata, METADATA_EXTENSIONS, type FileMetadata } from "@/core/format/metadata"
import { normalizeStampText } from "@/core/format/annotate"
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
    if (!existsSync(input.templatePath)) {
      fail(`template not found: ${input.templatePath}`)
    }
    const templateFormat = detectFormat(input.templatePath)
    if (templateFormat !== "text" && templateFormat !== "docx" && templateFormat !== "xlsx" && templateFormat !== "pptx") {
      fail("template must be a text, docx, xlsx or pptx file")
    }
    const template = await readRealFileAsMarkdown(input.templatePath)
    const entries: Array<{ data: Record<string, string | number>; filePath: string }> = []
    if (input.data && input.filePath) {
      let parsed: unknown
      try {
        parsed = JSON.parse(input.data)
      } catch {
        fail("invalid data JSON")
      }
      if (!isDataObject(parsed)) {
        fail("data must be a JSON object with string or number values")
      }
      entries.push({ data: parsed, filePath: input.filePath })
    } else if (input.dataArray && input.filePaths) {
      let dataArray: unknown
      let filePaths: unknown
      try {
        dataArray = JSON.parse(input.dataArray)
      } catch {
        fail("invalid dataArray JSON")
      }
      try {
        filePaths = JSON.parse(input.filePaths)
      } catch {
        fail("invalid filePaths JSON")
      }
      if (
        !Array.isArray(dataArray) ||
        !Array.isArray(filePaths) ||
        dataArray.length !== filePaths.length
      ) {
        fail("dataArray and filePaths must be arrays of equal length")
      }
      for (let i = 0; i < dataArray.length; i++) {
        const d = dataArray[i]
        const p = filePaths[i]
        if (!isDataObject(d)) {
          fail(`dataArray entry ${i} must be a JSON object with string or number values`)
        }
        if (typeof p !== "string") {
          fail(`filePaths entry ${i} must be a string`)
        }
        entries.push({ data: d, filePath: p })
      }
    } else {
      fail("generate requires data + filePath or dataArray + filePaths")
    }
    // Validate every entry before creating anything: a missing key or a held
    // lock must abort with no partial drafts
    const prepared: Array<{ filePath: string; content: string }> = []
    for (const entry of entries) {
      Draft.assertNoForeignLock(entry.filePath, sessionID, false)
      try {
        prepared.push({ filePath: entry.filePath, content: sanitizeMarkdown(substituteTemplate(template, entry.data)) })
      } catch (error) {
        fail((error as Error).message)
      }
    }
    for (const p of prepared) {
      Draft.create(p.filePath, sessionID, owner, sanitizeMarkdown(p.content))
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
      const draftError = requireDraftFor(input.filePath, sessionID)
      if (draftError) {
        fail(draftError)
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(input.properties)
      } catch {
        fail("invalid properties JSON")
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        fail("properties must be a JSON object")
      }
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (key === "custom") {
          if (typeof value !== "object" || value === null || Array.isArray(value) ||
              !Object.values(value as Record<string, unknown>).every((v) => typeof v === "string")) {
            fail("custom must be an object with string values")
          }
        } else if (typeof value !== "string") {
          fail(`property "${key}" must be a string`)
        }
      }
      const sidecar = Draft.readSidecarFor(input.filePath, sessionID) ?? {}
      sidecar.metadata = parsed as FileMetadata
      Draft.writeSidecarFor(input.filePath, sessionID, sidecar)
      return `Metadata set for ${input.filePath}`
    }
    if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    let real: FileMetadata
    try {
      real = await readMetadata(input.filePath)
    } catch (error) {
      fail((error as Error).message)
    }
    const sidecar = Draft.readSidecarFor(input.filePath, sessionID)
    const merged: FileMetadata = { ...real, ...(sidecar?.metadata) }
    return JSON.stringify(merged, null, 2)
  }

  if (input.action === "watermark") {
    const ext = extname(input.filePath).toLowerCase()
    if (ext !== ".docx" && ext !== ".pdf") {
      fail("watermark only supported for DOCX and PDF files")
    }
    const draftError = requireDraftFor(input.filePath, sessionID)
    if (draftError) {
      fail(draftError)
    }
    const sidecar = Draft.readSidecarFor(input.filePath, sessionID) ?? {}
    if (input.text === "") {
      delete sidecar.watermark
      Draft.writeSidecarFor(input.filePath, sessionID, sidecar)
      return `Watermark removed for ${input.filePath}`
    }
    let config: WatermarkConfig
    try {
      config = buildWatermarkConfig(ext, { text: input.text, position: input.position, size: input.size, opacity: input.opacity })
    } catch (error) {
      fail((error as Error).message)
    }
    sidecar.watermark = config
    Draft.writeSidecarFor(input.filePath, sessionID, sidecar)
    return `Watermark set for ${input.filePath}: "${input.text}"`
  }

  if (input.action === "annotate") {
    const ext = extname(input.filePath).toLowerCase()
    if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
      fail("annotate only supported for PNG and JPG images")
    }
    const draftError = requireDraftFor(input.filePath, sessionID)
    if (draftError) {
      fail(draftError)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(input.annotations)
    } catch {
      fail("invalid annotations JSON")
    }
    if (!Array.isArray(parsed)) {
      fail("annotations must be an array")
    }
    if (parsed.length === 0) {
      const clearingSidecar = Draft.readSidecarFor(input.filePath, sessionID) ?? {}
      delete clearingSidecar.annotations
      Draft.writeSidecarFor(input.filePath, sessionID, clearingSidecar)
      return `Annotations cleared for ${input.filePath}`
    }
    const ops: AnnotationOp[] = []
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i] as { type?: unknown; text?: unknown; position?: unknown; rect?: unknown; size?: unknown }
      if (entry.type !== "note" && entry.type !== "highlight" && entry.type !== "stamp") {
        fail(`annotation ${i} has unknown type ${String(entry.type)}`)
      }
      if (entry.type === "note") {
        if (typeof entry.text !== "string" || entry.text === "" || !isFractionPoint(entry.position)) {
          fail(`note ${i} requires text and position {x, y} between 0 and 1`)
        }
        const op: AnnotationOp = { type: "note", text: entry.text, position: entry.position as AnnotationOp["position"] }
        if (typeof entry.size === "number") op.size = entry.size
        ops.push(op)
      } else if (entry.type === "highlight") {
        if (!isFractionRect(entry.rect)) {
          fail(`highlight ${i} requires rect {x, y, width, height} between 0 and 1`)
        }
        ops.push({ type: "highlight", rect: entry.rect as AnnotationOp["rect"] })
      } else {
        if (typeof entry.text !== "string" || !isFractionPoint(entry.position)) {
          fail(`stamp ${i} requires text and position {x, y} between 0 and 1`)
        }
        const stampText = normalizeStampText(entry.text)
        if (!stampText) {
          fail(`stamp ${i} text must be one of: DRAFT, APPROVED, CONFIDENTIAL`)
        }
        const op: AnnotationOp = { type: "stamp", text: stampText, position: entry.position as AnnotationOp["position"] }
        if (typeof entry.size === "number") op.size = entry.size
        ops.push(op)
      }
    }
    const sidecar = Draft.readSidecarFor(input.filePath, sessionID) ?? {}
    sidecar.annotations = [...(sidecar.annotations ?? []), ...ops]
    Draft.writeSidecarFor(input.filePath, sessionID, sidecar)
    return `Annotations added to draft for ${input.filePath}: ${ops.length}`
  }

  if (input.action === "export") {
    const hasDraft = Draft.exists(input.filePath, sessionID)
    if (!hasDraft && !existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    const sourceExt = extname(input.filePath).toLowerCase()
    if (!EXPORT_EXTENSIONS.includes(sourceExt)) {
      fail(`export source format not supported: ${sourceExt} (supported: pdf, docx, xlsx, pptx)`)
    }
    const targetExt = extname(input.targetPath).toLowerCase()
    if (!EXPORT_EXTENSIONS.includes(targetExt)) {
      fail(`export target format not supported: ${targetExt} (supported: pdf, docx, xlsx, pptx)`)
    }
    if (resolve(input.targetPath) === resolve(input.filePath)) {
      fail("targetPath must differ from filePath")
    }
    const markdown = hasDraft
      ? await Draft.draftMarkdown(input.filePath, sessionID)
      : await readRealFileAsMarkdown(input.filePath)
    try {
      await writeDerivedFile(markdown, input.targetPath)
    } catch (error) {
      fail((error as Error).message)
    }
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
      if (isZip) {
        try {
          return await readRealFileAsMarkdown(draftPath, readOpts)
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
    try {
      return await readRealFileAsMarkdown(input.filePath, readOpts)
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
    let parsed: unknown
    try {
      parsed = JSON.parse(input.rules)
    } catch {
      fail("invalid rules JSON")
    }
    if (!Array.isArray(parsed)) {
      fail("rules must be an array")
    }
    const rules: Array<{ type: "regex" | "required"; pattern: string }> = []
    for (let i = 0; i < parsed.length; i++) {
      const rule = parsed[i] as { type?: unknown; pattern?: unknown }
      if (rule.type !== "regex" && rule.type !== "required") {
        fail(`rule ${i} has unknown type ${String(rule.type)}`)
      }
      if (typeof rule.pattern !== "string") {
        fail(`rule ${i} must have a string pattern`)
      }
      rules.push({ type: rule.type, pattern: rule.pattern })
    }
    if (!Draft.exists(input.filePath, sessionID)) {
      fail("no active draft to validate")
    }
    const content = await Draft.draftMarkdown(input.filePath, sessionID)
    const results: Array<{ rule: (typeof rules)[number]; pass: boolean }> = []
    for (const rule of rules) {
      let pass: boolean
      if (rule.type === "regex") {
        try {
          pass = new RegExp(rule.pattern).test(content)
        } catch {
          fail(`invalid regex pattern "${rule.pattern}"`)
        }
      } else {
        pass = content.includes(rule.pattern)
      }
      results.push({ rule, pass })
    }
    const passed = results.filter((r) => r.pass).length
    const failed = results.length - passed
    const lines = results.map(
      (r) => `- ${r.pass ? "pass" : "fail"}: ${r.rule.type} "${r.rule.pattern}"`
    )
    return `Validation of ${input.filePath}: ${results.length} rules, ${passed} passed, ${failed} failed\n${lines.join("\n")}`
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
    const sourcePath = resolve(input.filePath)
    const targetPath = resolve(input.targetPath)
    if (!existsSync(sourcePath)) fail(`clone source not found: ${input.filePath}`)
    const srcFormat = detectFormat(sourcePath)
    if (srcFormat !== "docx" && srcFormat !== "xlsx" && srcFormat !== "pptx") {
      fail("clone only supported for DOCX, XLSX and PPTX files")
    }
    if (resolve(sourcePath) === resolve(targetPath)) fail("targetPath must differ from filePath")
    Draft.assertNoForeignLock(targetPath, sessionID, true, input.targetPath)
    // ponytail: binary copy preserves 100% Format — draft is real ZIP, accept will copy verbatim
    const buf = readFileSync(sourcePath)
    const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b
    if (!isZip) fail(`clone source is not a valid OOXML file: ${input.filePath}`)
    Draft.cloneIntoDraft(targetPath, sessionID, owner, buf)
    return `Cloned ${input.filePath} to draft for ${input.targetPath} (L3 Format preserved)`
  }

  if (input.action === "substitute") {
    const draftError = requireDraftFor(input.filePath, sessionID)
    if (draftError) fail(draftError)
    let parsed: unknown
    try {
      parsed = JSON.parse(input.data)
    } catch {
      fail("invalid data JSON")
    }
    if (!isDataObject(parsed)) fail("data must be a JSON object with string or number values")
    const draftPath = Draft.draftPath(input.filePath, sessionID)
    const buf = readFileSync(draftPath)
    const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b
    if (!isZip) fail("substitute only supported on OOXML drafts (clone first for L3)")
    try {
      const { buffer, replaced, format } = await substituteOoxml(buf, parsed)
      writeFileSync(draftPath, buffer)
      return `Substituted ${replaced} placeholders in ${input.filePath} (${format}, run-preserving)`
    } catch (error) {
      fail((error as Error).message)
    }
  }

  if (input.action === "verify-l3") {
    const fileA = resolve(input.filePath)
    const fileB = resolve(input.referencePath)
    if (!existsSync(fileA)) fail(`file not found: ${input.filePath}`)
    if (!existsSync(fileB)) fail(`reference not found: ${input.referencePath}`)
    const { verifyL3 } = await import("@/core/format/verify-l3")
    try {
      const result = await verifyL3(fileA, fileB)
      return result.pass
        ? `L3 PASS: ${input.filePath} vs ${input.referencePath} — only text nodes differ (${result.textDiffs} diffs, ${result.checkedFiles} files checked)`
        : `L3 FAIL: ${input.filePath} vs ${input.referencePath} — Format differs\n${result.details}`
    } catch (error) {
      fail((error as Error).message)
    }
  }

  fail(`action ${input.action} not implemented`)
}

function isDataObject(value: unknown): value is Record<string, string | number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every((v) => typeof v === "string" || typeof v === "number")
}

function isFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

// ponytail: metadata/watermark/annotate/substitute predate typed errors and map the error
// string themselves; one call into the Draft module keeps the preamble in one place
function requireDraftFor(filePath: string, sessionID: string): string | null {
  try {
    Draft.requireOwned(filePath, sessionID, "no active draft")
    Draft.requireDraftExists(filePath, sessionID)
    return null
  } catch (error) {
    return (error as Error).message
  }
}

function isFractionPoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const point = value as { x?: unknown; y?: unknown }
  return isFraction(point.x) && isFraction(point.y)
}

function isFractionRect(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const rect = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  return isFraction(rect.x) && isFraction(rect.y) && isFraction(rect.width) && isFraction(rect.height)
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
