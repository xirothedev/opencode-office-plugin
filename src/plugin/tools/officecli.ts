import { Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import { createDraft, acceptDraft, undoDraft, getHistory, getDraftPath, draftExists, getSnapshot, getSnapshotSidecar, listActiveDrafts, getDraftSessions } from "@/core/draft/manager"
import { acquireLock, getLock, releaseLock, isLockStale, overrideLock } from "@/core/draft/lock"
import { getFilePathHash } from "@/core/storage/paths"
import { writeFileSync, readFileSync, existsSync } from "fs"
import { extname, resolve, join } from "path"
import { detectFormat } from "@/core/format/detect"
import { writeComment, readComments, applyCommentSuggestion, type Comment } from "@/core/format/ooxml/comments"
import { writeTrackChange, readTrackChanges, type TrackChange } from "@/core/format/ooxml/trackchanges"
import { writeComment as writeXlsxComment, readComments as readXlsxComments, applyCellSuggestion, type XlsxComment } from "@/core/format/ooxml/xlsxcomments"
import { writeComment as writePptxComment, readComments as readPptxComments, applySlideSuggestion, type PptxComment } from "@/core/format/ooxml/pptxcomments"
import { diffTexts } from "@/core/draft/diff"
import { substituteTemplate } from "@/core/template/substitute"
import { readRealFileAsMarkdown } from "@/core/format/read"
import { renderMarkdownFileToHtml } from "@/core/format/render"
import { writeDerivedFile, EXPORT_EXTENSIONS } from "@/core/format/export"
import { readMetadata, METADATA_EXTENSIONS, type FileMetadata } from "@/core/format/metadata"
import { readSidecar, writeSidecar, type WatermarkConfig, type WatermarkPosition, type AnnotationOp } from "@/core/draft/sidecar"
import { normalizeStampText } from "@/core/format/annotate"
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
const readArgs = S.Struct({ action: S.Literal("read"), filePath: S.String })
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
  trackChangeArgs,
  listCommentsArgs,
  previewArgs,
  validateArgs,
  reviewArgs,
])
type OfficeCliInput = Schema.Schema.Type<typeof officecliInput>

const officecliOutput = S.String

export const officecliTool: Tool.Info<typeof officecliInput, typeof officecliOutput> = {
  name: "officecli",
  description:
    "Office document automation. Create, edit, read, accept, undo, revert documents with draft lifecycle. Preview renders a draft to HTML, validate checks draft content against rules, lock-status queries lock state, force-release takes over a stale lock. Supports comments for DOCX, XLSX, PPTX, track changes for DOCX, and content-changing suggestions (comment with suggestedText, applied by approve action; PPTX suggestions accept optional targetText, a snippet of the intended text box's current text, so approve edits that box instead of the first).",
  input: officecliInput,
  output: officecliOutput,
  options: { codemode: false },
  execute: (input, context) =>
    tryExecute(async () => ({ output: await runAction(input, context) })),
}

async function runAction(input: OfficeCliInput, context: Tool.Context): Promise<string> {
  const sessionID = context.sessionID
  const owner = context.agent

  if (input.action === "create") {
    const { filePath, filePaths, content } = input
    if (!filePath && !filePaths) {
      fail("create requires filePath or filePaths")
    }
    const targets = parseFilePaths(filePaths)
    if (typeof targets === "string") {
      fail(targets)
    }
    if (filePath && targets.length === 0) {
      const filePathHash = getFilePathHash(filePath)
      acquireLock(filePathHash, sessionID, owner)
      createDraft(filePath, sessionID, content)
      return `Draft created for ${filePath}`
    }
    const paths = targets.length > 0 ? targets : [filePath as string]
    for (const p of paths) {
      const filePathHash = getFilePathHash(p)
      const lock = getLock(filePathHash)
      if (lock && lock.sessionID !== sessionID && !isLockStale(filePathHash)) {
        fail(`lock on ${p} held by session ${lock.sessionID}`)
      }
    }
    for (const p of paths) {
      const filePathHash = getFilePathHash(p)
      acquireLock(filePathHash, sessionID, owner)
      createDraft(p, sessionID, content)
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
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock || lock.sessionID !== sessionID) {
        fail("no active draft to accept")
      }
      await acceptDraft(filePath, sessionID, timestamp)
      return `Accepted draft for ${filePath}`
    }
    const paths = targets.length > 0 ? targets : [filePath as string]
    for (const p of paths) {
      const filePathHash = getFilePathHash(p)
      const lock = getLock(filePathHash)
      if (!lock || lock.sessionID !== sessionID) {
        fail(`no active draft to accept for ${p}`)
      }
      if (!draftExists(filePathHash, sessionID)) {
        fail(`draft not found for ${p}`)
      }
    }
    for (const p of paths) {
      await acceptDraft(p, sessionID, timestamp)
    }
    return `Accepted ${paths.length} drafts`
  }

  if (input.action === "undo") {
    const filePathHash = getFilePathHash(input.filePath)
    const lock = getLock(filePathHash)
    if (!lock || lock.sessionID !== sessionID) {
      fail("no active draft to undo")
    }
    undoDraft(input.filePath, sessionID)
    releaseLock(filePathHash)
    return `Draft undone for ${input.filePath}`
  }

  if (input.action === "edit") {
    const filePathHash = getFilePathHash(input.filePath)
    const lock = getLock(filePathHash)
    if (!lock || lock.sessionID !== sessionID) {
      fail("no active draft to edit")
    }
    if (!draftExists(filePathHash, sessionID)) {
      fail("draft not found")
    }
    const ext = extname(input.filePath)
    const draftPath = getDraftPath(filePathHash, sessionID, ext)
    writeFileSync(draftPath, input.content)
    return `Draft edited for ${input.filePath}`
  }

  if (input.action === "lock-status") {
    const filePathHash = getFilePathHash(input.filePath)
    const lock = getLock(filePathHash)
    if (!lock) {
      return `no lock on ${input.filePath}`
    }
    return JSON.stringify({
      sessionID: lock.sessionID,
      owner: lock.owner,
      status: lock.status,
      stale: isLockStale(filePathHash),
      touchedAt: lock.touchedAt,
    })
  }

  if (input.action === "force-release") {
    const filePathHash = getFilePathHash(input.filePath)
    const lock = getLock(filePathHash)
    if (!lock) {
      fail(`no lock on ${input.filePath} to force release`)
    }
    if (!isLockStale(filePathHash)) {
      fail(`lock on ${input.filePath} is not stale; force release allowed only on stale locks`)
    }
    overrideLock(filePathHash, sessionID, owner)
    return `Force released lock on ${input.filePath}`
  }

  if (input.action === "list") {
    const drafts = input.filePath
      ? listActiveDrafts().filter(
          (d) => d.filePath === input.filePath || resolve(d.filePath) === resolve(input.filePath as string)
        )
      : listActiveDrafts()
    return JSON.stringify(drafts, null, 2)
  }

  if (input.action === "diff") {
    const filePathHash = getFilePathHash(input.filePath)
    if (!draftExists(filePathHash, sessionID)) {
      const sessions = getDraftSessions(filePathHash)
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
    const ext = extname(input.filePath)
    const draftPath = getDraftPath(filePathHash, sessionID, ext)
    const draftContent = readFileSync(draftPath, "utf-8")
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
      const filePathHash = getFilePathHash(entry.filePath)
      const lock = getLock(filePathHash)
      if (lock && lock.sessionID !== sessionID) {
        fail(`lock on ${entry.filePath} held by session ${lock.sessionID}`)
      }
      try {
        prepared.push({ filePath: entry.filePath, content: substituteTemplate(template, entry.data) })
      } catch (error) {
        fail((error as Error).message)
      }
    }
    for (const p of prepared) {
      const filePathHash = getFilePathHash(p.filePath)
      acquireLock(filePathHash, sessionID, owner)
      createDraft(p.filePath, sessionID, p.content)
    }
    return `Generated ${prepared.length} drafts from ${input.templatePath}`
  }

  if (input.action === "history") {
    const filePathHash = getFilePathHash(input.filePath)
    const history = getHistory(filePathHash)
    const metadata = history.map((ap) => ({
      timestamp: ap.timestamp,
      sessionID: ap.sessionID,
    }))
    return `${history.length} accept-points for ${input.filePath}\n${JSON.stringify(metadata)}`
  }

  if (input.action === "revert") {
    const filePathHash = getFilePathHash(input.filePath)
    const snapshot = getSnapshot(filePathHash, input.timestamp)
    if (!snapshot) {
      fail("snapshot not found for timestamp")
    }
    acquireLock(filePathHash, sessionID, owner)
    createDraft(input.filePath, sessionID, snapshot)
    const sidecar = getSnapshotSidecar(filePathHash, input.timestamp)
    if (sidecar) {
      writeSidecar(filePathHash, sessionID, sidecar)
    }
    return `Reverted to snapshot for ${input.filePath}`
  }

  if (input.action === "metadata") {
    const ext = extname(input.filePath).toLowerCase()
    if (!METADATA_EXTENSIONS.includes(ext)) {
      fail("metadata only supported for DOCX, XLSX, PPTX and PDF files")
    }
    const filePathHash = getFilePathHash(input.filePath)
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
      const sidecar = readSidecar(filePathHash, sessionID) ?? {}
      sidecar.metadata = parsed as FileMetadata
      writeSidecar(filePathHash, sessionID, sidecar)
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
    const sidecar = readSidecar(filePathHash, sessionID)
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
    const filePathHash = getFilePathHash(input.filePath)
    const sidecar = readSidecar(filePathHash, sessionID) ?? {}
    if (input.text === "") {
      delete sidecar.watermark
      writeSidecar(filePathHash, sessionID, sidecar)
      return `Watermark removed for ${input.filePath}`
    }
    const defaultPosition: WatermarkPosition = ext === ".docx" ? "top-center" : "diagonal-center"
    const position = (input.position as WatermarkPosition | undefined) ?? defaultPosition
    const validPositions: WatermarkPosition[] = ["diagonal-center", "top-center", "bottom-center"]
    if (!validPositions.includes(position)) {
      fail(`invalid position "${position}" (supported: diagonal-center, top-center, bottom-center)`)
    }
    if (ext === ".docx" && position === "diagonal-center") {
      fail("diagonal-center watermark not supported for DOCX (supported: top-center, bottom-center)")
    }
    if (ext === ".docx" && input.opacity !== undefined) {
      fail("opacity not supported for DOCX watermarks (supported: PDF only)")
    }
    const config: WatermarkConfig = { text: input.text, position }
    if (input.size !== undefined) config.size = input.size
    if (input.opacity !== undefined) config.opacity = input.opacity
    sidecar.watermark = config
    writeSidecar(filePathHash, sessionID, sidecar)
    return `Watermark set for ${input.filePath}: "${input.text}"`
  }

  if (input.action === "annotate") {
    const ext = extname(input.filePath).toLowerCase()
    if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
      fail("annotate only supported for PNG and JPG images")
    }
    const filePathHash = getFilePathHash(input.filePath)
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
      const clearingSidecar = readSidecar(filePathHash, sessionID) ?? {}
      delete clearingSidecar.annotations
      writeSidecar(filePathHash, sessionID, clearingSidecar)
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
    const sidecar = readSidecar(filePathHash, sessionID) ?? {}
    sidecar.annotations = [...(sidecar.annotations ?? []), ...ops]
    writeSidecar(filePathHash, sessionID, sidecar)
    return `Annotations added to draft for ${input.filePath}: ${ops.length}`
  }

  if (input.action === "export") {
    const filePathHash = getFilePathHash(input.filePath)
    const hasDraft = draftExists(filePathHash, sessionID)
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
      ? readFileSync(getDraftPath(filePathHash, sessionID, sourceExt), "utf-8")
      : await readRealFileAsMarkdown(input.filePath)
    try {
      await writeDerivedFile(markdown, input.targetPath)
    } catch (error) {
      fail((error as Error).message)
    }
    return `Exported ${input.filePath} to ${input.targetPath}`
  }

  if (input.action === "read") {
    const filePathHash = getFilePathHash(input.filePath)
    const ext = extname(input.filePath)

    // Return draft if exists, else real file
    if (draftExists(filePathHash, sessionID)) {
      const draftPath = getDraftPath(filePathHash, sessionID, ext)
      // Draft is always markdown, return as-is
      const content = readFileSync(draftPath, "utf-8")
      return content
    }
    if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    const content = await readRealFileAsMarkdown(input.filePath)
    return content
  }
  if (input.action === "comment") {
    const ext = extname(input.filePath)
    if (ext !== ".docx" && ext !== ".xlsx" && ext !== ".pptx") {
      fail("comments only supported for DOCX, XLSX and PPTX files")
    }
    if (ext === ".docx" && (input.rangeStartParagraph === undefined || input.rangeStartOffset === undefined || input.rangeEndParagraph === undefined || input.rangeEndOffset === undefined)) {
      fail("comment on DOCX requires rangeStartParagraph, rangeStartOffset, rangeEndParagraph, rangeEndOffset")
    }
    if (ext === ".xlsx" && !input.cellRef) {
      fail('comment on XLSX requires cellRef (e.g. "B4")')
    }
    const filePathHash = getFilePathHash(input.filePath)
    const lock = getLock(filePathHash)
    if (!lock || lock.sessionID !== sessionID) {
      fail("no active draft to add comment")
    }
    const draftPath = getDraftPath(filePathHash, sessionID, ext)
    if (!draftExists(filePathHash, sessionID)) {
      fail("draft not found")
    }
    if (ext === ".xlsx") {
      const comment: XlsxComment = {
        id: input.commentId,
        author: input.author,
        text: input.commentText,
        timestamp: new Date(),
        cellRef: input.cellRef as string,
        parentId: null,
        resolved: false,
        suggestedText: input.suggestedText ?? null,
      }
      await writeXlsxComment(draftPath, comment)
      return `Comment added to draft for ${input.filePath}`
    }
    if (ext === ".pptx") {
      const comment: PptxComment = {
        id: input.commentId,
        author: input.author,
        text: input.commentText,
        timestamp: new Date(),
        slide: input.slide ?? 0,
        x: input.x ?? 100000,
        y: input.y ?? 100000,
        parentId: null,
        resolved: false,
        suggestedText: input.suggestedText ?? null,
        targetText: input.targetText ?? null,
      }
      await writePptxComment(draftPath, comment)
      return `Comment added to draft for ${input.filePath}`
    }
    const comment: Comment = {
      id: input.commentId,
      author: input.author,
      text: input.commentText,
      timestamp: new Date(),
      rangeStart: { paragraph: input.rangeStartParagraph as number, offset: input.rangeStartOffset as number },
      rangeEnd: { paragraph: input.rangeEndParagraph as number, offset: input.rangeEndOffset as number },
      parentId: null,
      resolved: false,
      suggestedText: input.suggestedText ?? null,
    }
    await writeComment(draftPath, comment)
    return `Comment added to draft for ${input.filePath}`
  }

  if (input.action === "approve") {
    const ext = extname(input.filePath)
    if (ext !== ".docx" && ext !== ".xlsx" && ext !== ".pptx") {
      fail("suggestions only supported for DOCX, XLSX and PPTX files")
    }
    const filePathHash = getFilePathHash(input.filePath)
    const lock = getLock(filePathHash)
    if (!lock || lock.sessionID !== sessionID) {
      fail("no active draft to approve")
    }
    const draftPath = getDraftPath(filePathHash, sessionID, ext)
    if (!draftExists(filePathHash, sessionID)) {
      fail("draft not found")
    }
    let result: "applied" | "not-found" | "no-suggestion"
    if (ext === ".xlsx") {
      result = await applyCellSuggestion(draftPath, input.commentId)
    } else if (ext === ".pptx") {
      result = await applySlideSuggestion(draftPath, input.commentId)
    } else {
      result = await applyCommentSuggestion(draftPath, input.commentId)
    }
    if (result === "not-found") {
      fail(`comment ${input.commentId} not found`)
    }
    if (result === "no-suggestion") {
      fail(`comment ${input.commentId} has no suggestion to approve`)
    }
    return `Approved comment ${input.commentId} on ${input.filePath}: suggestion applied`
  }

  if (input.action === "track-insert" || input.action === "track-delete") {
    const ext = extname(input.filePath)
    if (ext !== ".docx") {
      fail("track changes not supported for XLSX/PPTX files (w:ins/w:del is Word-only OOXML); use comment action for review feedback")
    }
    const filePathHash = getFilePathHash(input.filePath)
    const lock = getLock(filePathHash)
    if (!lock || lock.sessionID !== sessionID) {
      fail("no active draft to add track change")
    }
    const draftPath = getDraftPath(filePathHash, sessionID, ext)
    if (!draftExists(filePathHash, sessionID)) {
      fail("draft not found")
    }
    const trackChange: TrackChange = {
      id: input.commentId,
      type: input.action === "track-insert" ? "insertion" : "deletion",
      author: input.author,
      timestamp: new Date(),
      text: input.content,
      paragraph: input.paragraph,
      offset: input.offset,
    }
    await writeTrackChange(draftPath, trackChange)
    return `Track change added to draft for ${input.filePath}`
  }

  if (input.action === "list-comments") {
    const ext = extname(input.filePath)
    if (ext !== ".docx" && ext !== ".xlsx" && ext !== ".pptx") {
      fail("comments only supported for DOCX, XLSX and PPTX files")
    }
    const filePathHash = getFilePathHash(input.filePath)
    let targetPath = input.filePath
    if (draftExists(filePathHash, sessionID)) {
      targetPath = getDraftPath(filePathHash, sessionID, ext)
    } else if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    if (ext === ".xlsx") {
      const comments = await readXlsxComments(targetPath)
      return `${comments.length} comments\n${JSON.stringify(comments, null, 2)}`
    }
    if (ext === ".pptx") {
      const comments = await readPptxComments(targetPath)
      return `${comments.length} comments\n${JSON.stringify(comments, null, 2)}`
    }
    const comments = await readComments(targetPath)
    return `${comments.length} comments\n${JSON.stringify(comments, null, 2)}`
  }

  if (input.action === "preview") {
    const filePathHash = getFilePathHash(input.filePath)
    if (!draftExists(filePathHash, sessionID)) {
      fail("no active draft to preview")
    }
    const draftPath = getDraftPath(filePathHash, sessionID, extname(input.filePath))
    const outputPath = join(tmpdir(), "openoffice-preview", `${filePathHash}.html`)
    try {
      await renderMarkdownFileToHtml(draftPath, outputPath)
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
    const filePathHash = getFilePathHash(input.filePath)
    if (!draftExists(filePathHash, sessionID)) {
      fail("no active draft to validate")
    }
    const draftPath = getDraftPath(filePathHash, sessionID, extname(input.filePath))
    const content = readFileSync(draftPath, "utf-8")
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
    const ext = extname(input.filePath)
    if (ext !== ".docx" && ext !== ".xlsx" && ext !== ".pptx") {
      fail("review only supported for DOCX, XLSX and PPTX files")
    }
    const filePathHash = getFilePathHash(input.filePath)
    let targetPath = input.filePath
    if (draftExists(filePathHash, sessionID)) {
      targetPath = getDraftPath(filePathHash, sessionID, ext)
    } else if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    if (ext === ".xlsx") {
      const comments = await readXlsxComments(targetPath)
      return `Review summary for ${input.filePath}:\n${comments.length} comments (XLSX has no track changes)\n\nComments:\n${JSON.stringify(comments, null, 2)}`
    }
    if (ext === ".pptx") {
      const comments = await readPptxComments(targetPath)
      return `Review summary for ${input.filePath}:\n${comments.length} comments (PPTX has no track changes)\n\nComments:\n${JSON.stringify(comments, null, 2)}`
    }
    const comments = await readComments(targetPath)
    const trackChanges = await readTrackChanges(targetPath)
    return `Review summary for ${input.filePath}:\n${comments.length} comments, ${trackChanges.length} track changes\n\nComments:\n${JSON.stringify(comments, null, 2)}\n\nTrack Changes:\n${JSON.stringify(trackChanges, null, 2)}`
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

function requireDraftFor(filePath: string, sessionID: string): string | null {
  const filePathHash = getFilePathHash(filePath)
  const lock = getLock(filePathHash)
  if (!lock || lock.sessionID !== sessionID) {
    return "no active draft"
  }
  if (!draftExists(filePathHash, sessionID)) {
    return "draft not found"
  }
  return null
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
