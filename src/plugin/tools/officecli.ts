import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createDraft, acceptDraft, undoDraft, getHistory, getDraftPath, draftExists, getSnapshot } from "@/core/draft/manager"
import { acquireLock, getLock, releaseLock, isLockStale, overrideLock } from "@/core/draft/lock"
import { getFilePathHash } from "@/core/storage/paths"
import { writeFileSync, readFileSync, existsSync } from "fs"
import { extname, resolve, join } from "path"
import { detectFormat } from "@/core/format/detect"
import { writeComment, readComments, applyCommentSuggestion, type Comment } from "@/core/format/ooxml/comments"
import { writeTrackChange, readTrackChanges, type TrackChange } from "@/core/format/ooxml/trackchanges"
import { writeComment as writeXlsxComment, readComments as readXlsxComments, applyCellSuggestion, type XlsxComment } from "@/core/format/ooxml/xlsxcomments"
import { writeComment as writePptxComment, readComments as readPptxComments, applySlideSuggestion, type PptxComment } from "@/core/format/ooxml/pptxcomments"
import { listActiveDrafts, getDraftSessions } from "@/core/draft/manager"
import { diffTexts } from "@/core/draft/diff"
import { substituteTemplate } from "@/core/template/substitute"
import { readRealFileAsMarkdown } from "@/core/format/read"
import { renderMarkdownFileToHtml } from "@/core/format/render"
import { tmpdir } from "os"

export const officecliTool: ToolDefinition = tool({
  description: "Office document automation. Create, edit, read, accept, undo, revert documents with draft lifecycle. Preview renders a draft to HTML, validate checks draft content against rules, lock-status queries lock state, force-release takes over a stale lock. Supports comments for DOCX, XLSX, PPTX, track changes for DOCX, and content-changing suggestions (comment with suggestedText, applied by approve action).",
  args: {
    action: tool.schema.enum(["create", "edit", "read", "accept", "undo", "revert", "history", "list", "diff", "generate", "preview", "validate", "lock-status", "force-release", "comment", "track-insert", "track-delete", "list-comments", "review", "approve"]),
    filePath: tool.schema.string().optional(),
    content: tool.schema.string().optional(),
    timestamp: tool.schema.number().optional(),
    commentId: tool.schema.string().optional(),
    author: tool.schema.string().optional(),
    commentText: tool.schema.string().optional(),
    suggestedText: tool.schema.string().optional(),
    paragraph: tool.schema.number().optional(),
    offset: tool.schema.number().optional(),
    rangeStartParagraph: tool.schema.number().optional(),
    rangeStartOffset: tool.schema.number().optional(),
    rangeEndParagraph: tool.schema.number().optional(),
    rangeEndOffset: tool.schema.number().optional(),
    cellRef: tool.schema.string().optional(),
    slide: tool.schema.number().optional(),
    x: tool.schema.number().optional(),
    y: tool.schema.number().optional(),
    templatePath: tool.schema.string().optional(),
    data: tool.schema.string().optional(),
    dataArray: tool.schema.string().optional(),
    filePaths: tool.schema.string().optional(),
    rules: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const { action, filePath, content } = args
    const sessionID = context.sessionID
    const owner = context.agent

    if (action === "create") {
      if (!filePath && !args.filePaths) {
        return { output: "error: create requires filePath or filePaths" }
      }
      if (!content) {
        return { output: "error: create requires content" }
      }
      const targets = parseFilePaths(args.filePaths)
      if (typeof targets === "string") {
        return { output: targets }
      }
      if (filePath && targets.length === 0) {
        const filePathHash = getFilePathHash(filePath)
        acquireLock(filePathHash, sessionID, owner)
        createDraft(filePath, sessionID, content)
        return { output: `Draft created for ${filePath}` }
      }
      const paths = targets.length > 0 ? targets : [filePath as string]
      for (const p of paths) {
        const filePathHash = getFilePathHash(p)
        const lock = getLock(filePathHash)
        if (lock && lock.sessionID !== sessionID && !isLockStale(filePathHash)) {
          return { output: `error: lock on ${p} held by session ${lock.sessionID}` }
        }
      }
      for (const p of paths) {
        const filePathHash = getFilePathHash(p)
        acquireLock(filePathHash, sessionID, owner)
        createDraft(p, sessionID, content)
      }
      return { output: `Created ${paths.length} drafts` }
    }

    if (action === "accept") {
      if (!filePath && !args.filePaths) {
        return { output: "error: accept requires filePath or filePaths" }
      }
      const targets = parseFilePaths(args.filePaths)
      if (typeof targets === "string") {
        return { output: targets }
      }
      if (filePath && targets.length === 0) {
        const filePathHash = getFilePathHash(filePath)
        const lock = getLock(filePathHash)
        if (!lock || lock.sessionID !== sessionID) {
          return { output: "error: no active draft to accept" }
        }
        await acceptDraft(filePath, sessionID, args.timestamp)
        return { output: `Accepted draft for ${filePath}` }
      }
      const paths = targets.length > 0 ? targets : [filePath as string]
      for (const p of paths) {
        const filePathHash = getFilePathHash(p)
        const lock = getLock(filePathHash)
        if (!lock || lock.sessionID !== sessionID) {
          return { output: `error: no active draft to accept for ${p}` }
        }
        if (!draftExists(filePathHash, sessionID)) {
          return { output: `error: draft not found for ${p}` }
        }
      }
      for (const p of paths) {
        await acceptDraft(p, sessionID, args.timestamp)
      }
      return { output: `Accepted ${paths.length} drafts` }
    }

    if (action === "undo") {
      if (!filePath) {
        return { output: "error: undo requires filePath" }
      }
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock || lock.sessionID !== sessionID) {
        return { output: "error: no active draft to undo" }
      }
      undoDraft(filePath, sessionID)
      releaseLock(filePathHash)
      return { output: `Draft undone for ${filePath}` }
    }

    if (action === "edit") {
      if (!filePath || !content) {
        return { output: "error: edit requires filePath and content" }
      }
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock || lock.sessionID !== sessionID) {
        return { output: "error: no active draft to edit" }
      }
      if (!draftExists(filePathHash, sessionID)) {
        return { output: "error: draft not found" }
      }
      const ext = extname(filePath)
      const draftPath = getDraftPath(filePathHash, sessionID, ext)
      writeFileSync(draftPath, content)
      return { output: `Draft edited for ${filePath}` }
    }

    if (action === "lock-status") {
      if (!filePath) {
        return { output: "error: lock-status requires filePath" }
      }
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock) {
        return { output: `no lock on ${filePath}` }
      }
      return {
        output: JSON.stringify({
          sessionID: lock.sessionID,
          owner: lock.owner,
          status: lock.status,
          stale: isLockStale(filePathHash),
          touchedAt: lock.touchedAt,
        }),
      }
    }

    if (action === "force-release") {
      if (!filePath) {
        return { output: "error: force-release requires filePath" }
      }
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock) {
        return { output: `error: no lock on ${filePath} to force release` }
      }
      if (!isLockStale(filePathHash)) {
        return { output: `error: lock on ${filePath} is not stale; force release allowed only on stale locks` }
      }
      overrideLock(filePathHash, sessionID, owner)
      return { output: `Force released lock on ${filePath}` }
    }

    if (action === "list") {
      const drafts = args.filePath
        ? listActiveDrafts().filter(
            (d) => d.filePath === args.filePath || resolve(d.filePath) === resolve(args.filePath as string)
          )
        : listActiveDrafts()
      return { output: JSON.stringify(drafts, null, 2) }
    }

    if (action === "diff") {
      if (!filePath) {
        return { output: "error: diff requires filePath" }
      }
      const filePathHash = getFilePathHash(filePath)
      if (!draftExists(filePathHash, sessionID)) {
        const sessions = getDraftSessions(filePathHash)
        if (sessions.length > 0) {
          return { output: `error: no draft for this session; draft held by session ${sessions[0]}` }
        }
        return { output: "error: no active draft to diff" }
      }
      if (!existsSync(filePath)) {
        return { output: `error: file not found: ${filePath}` }
      }
      if (detectFormat(filePath) === "image") {
        return { output: "error: diff not supported for images" }
      }
      const ext = extname(filePath)
      const draftPath = getDraftPath(filePathHash, sessionID, ext)
      const draftContent = readFileSync(draftPath, "utf-8")
      const realContent = await readRealFileAsMarkdown(filePath)
      return { output: diffTexts(realContent, draftContent) }
    }

    if (action === "generate") {
      if (!args.templatePath) {
        return { output: "error: generate requires templatePath" }
      }
      if (!existsSync(args.templatePath)) {
        return { output: `error: template not found: ${args.templatePath}` }
      }
      const templateFormat = detectFormat(args.templatePath)
      if (templateFormat !== "text" && templateFormat !== "docx" && templateFormat !== "xlsx" && templateFormat !== "pptx") {
        return { output: "error: template must be a text, docx, xlsx or pptx file" }
      }
      const template = await readRealFileAsMarkdown(args.templatePath)
      const entries: Array<{ data: Record<string, string | number>; filePath: string }> = []
      if (args.data && args.filePath) {
        let parsed: unknown
        try {
          parsed = JSON.parse(args.data)
        } catch {
          return { output: "error: invalid data JSON" }
        }
        if (!isDataObject(parsed)) {
          return { output: "error: data must be a JSON object with string or number values" }
        }
        entries.push({ data: parsed, filePath: args.filePath })
      } else if (args.dataArray && args.filePaths) {
        let dataArray: unknown
        let filePaths: unknown
        try {
          dataArray = JSON.parse(args.dataArray)
        } catch {
          return { output: "error: invalid dataArray JSON" }
        }
        try {
          filePaths = JSON.parse(args.filePaths)
        } catch {
          return { output: "error: invalid filePaths JSON" }
        }
        if (
          !Array.isArray(dataArray) ||
          !Array.isArray(filePaths) ||
          dataArray.length !== filePaths.length
        ) {
          return { output: "error: dataArray and filePaths must be arrays of equal length" }
        }
        for (let i = 0; i < dataArray.length; i++) {
          const d = dataArray[i]
          const p = filePaths[i]
          if (!isDataObject(d)) {
            return { output: `error: dataArray entry ${i} must be a JSON object with string or number values` }
          }
          if (typeof p !== "string") {
            return { output: `error: filePaths entry ${i} must be a string` }
          }
          entries.push({ data: d, filePath: p })
        }
      } else {
        return { output: "error: generate requires data + filePath or dataArray + filePaths" }
      }
      // Validate every entry before creating anything: a missing key or a held
      // lock must abort with no partial drafts
      const prepared: Array<{ filePath: string; content: string }> = []
      for (const entry of entries) {
        const filePathHash = getFilePathHash(entry.filePath)
        const lock = getLock(filePathHash)
        if (lock && lock.sessionID !== sessionID) {
          return { output: `error: lock on ${entry.filePath} held by session ${lock.sessionID}` }
        }
        try {
          prepared.push({ filePath: entry.filePath, content: substituteTemplate(template, entry.data) })
        } catch (error) {
          return { output: `error: ${(error as Error).message}` }
        }
      }
      for (const p of prepared) {
        const filePathHash = getFilePathHash(p.filePath)
        acquireLock(filePathHash, sessionID, owner)
        createDraft(p.filePath, sessionID, p.content)
      }
      return { output: `Generated ${prepared.length} drafts from ${args.templatePath}` }
    }

    if (action === "history") {
      if (!filePath) {
        return { output: "error: history requires filePath" }
      }
      const filePathHash = getFilePathHash(filePath)
      const history = getHistory(filePathHash)
      const metadata = history.map((ap) => ({
        timestamp: ap.timestamp,
        sessionID: ap.sessionID,
      }))
      return { output: `${history.length} accept-points for ${filePath}\n${JSON.stringify(metadata)}` }
    }

    if (action === "revert") {
      if (!filePath || !args.timestamp) {
        return { output: "error: revert requires filePath and timestamp" }
      }
      const filePathHash = getFilePathHash(filePath)
      const snapshot = getSnapshot(filePathHash, args.timestamp)
      if (!snapshot) {
        return { output: "error: snapshot not found for timestamp" }
      }
      acquireLock(filePathHash, sessionID, owner)
      createDraft(filePath, sessionID, snapshot)
      return { output: `Reverted to snapshot for ${filePath}` }
    }

    if (action === "read") {
      if (!filePath) {
        return { output: "error: read requires filePath" }
      }
      const filePathHash = getFilePathHash(filePath)
      const ext = extname(filePath)

      // Return draft if exists, else real file
      if (draftExists(filePathHash, sessionID)) {
        const draftPath = getDraftPath(filePathHash, sessionID, ext)
        // Draft is always markdown, return as-is
        const content = readFileSync(draftPath, "utf-8")
        return { output: content }
      }
      if (!existsSync(filePath)) {
        return { output: `error: file not found: ${filePath}` }
      }
      const content = await readRealFileAsMarkdown(filePath)
      return { output: content }
    }

    // Comment and track changes actions
    if (action === "comment") {
      if (!filePath || !args.commentId || !args.author || !args.commentText) {
        return { output: "error: comment requires filePath, commentId, author, commentText" }
      }
      const ext = extname(filePath)
      if (ext !== ".docx" && ext !== ".xlsx" && ext !== ".pptx") {
        return { output: "error: comments only supported for DOCX, XLSX and PPTX files" }
      }
      if (ext === ".docx" && (args.rangeStartParagraph === undefined || args.rangeStartOffset === undefined || args.rangeEndParagraph === undefined || args.rangeEndOffset === undefined)) {
        return { output: "error: comment on DOCX requires rangeStartParagraph, rangeStartOffset, rangeEndParagraph, rangeEndOffset" }
      }
      if (ext === ".xlsx" && !args.cellRef) {
        return { output: "error: comment on XLSX requires cellRef (e.g. \"B4\")" }
      }
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock || lock.sessionID !== sessionID) {
        return { output: "error: no active draft to add comment" }
      }
      const draftPath = getDraftPath(filePathHash, sessionID, ext)
      if (!draftExists(filePathHash, sessionID)) {
        return { output: "error: draft not found" }
      }
      if (ext === ".xlsx") {
        const comment: XlsxComment = {
          id: args.commentId,
          author: args.author,
          text: args.commentText,
          timestamp: new Date(),
          cellRef: args.cellRef as string,
          parentId: null,
          resolved: false,
          suggestedText: args.suggestedText ?? null,
        }
        await writeXlsxComment(draftPath, comment)
        return { output: `Comment added to draft for ${filePath}` }
      }
      if (ext === ".pptx") {
        const comment: PptxComment = {
          id: args.commentId,
          author: args.author,
          text: args.commentText,
          timestamp: new Date(),
          slide: args.slide ?? 0,
          x: args.x ?? 100000,
          y: args.y ?? 100000,
          parentId: null,
          resolved: false,
          suggestedText: args.suggestedText ?? null,
        }
        await writePptxComment(draftPath, comment)
        return { output: `Comment added to draft for ${filePath}` }
      }
      const comment: Comment = {
        id: args.commentId,
        author: args.author,
        text: args.commentText,
        timestamp: new Date(),
        rangeStart: { paragraph: args.rangeStartParagraph as number, offset: args.rangeStartOffset as number },
        rangeEnd: { paragraph: args.rangeEndParagraph as number, offset: args.rangeEndOffset as number },
        parentId: null,
        resolved: false,
        suggestedText: args.suggestedText ?? null,
      }
      await writeComment(draftPath, comment)
      return { output: `Comment added to draft for ${filePath}` }
    }

    if (action === "approve") {
      if (!filePath || !args.commentId) {
        return { output: "error: approve requires filePath and commentId" }
      }
      const ext = extname(filePath)
      if (ext !== ".docx" && ext !== ".xlsx" && ext !== ".pptx") {
        return { output: "error: suggestions only supported for DOCX, XLSX and PPTX files" }
      }
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock || lock.sessionID !== sessionID) {
        return { output: "error: no active draft to approve" }
      }
      const draftPath = getDraftPath(filePathHash, sessionID, ext)
      if (!draftExists(filePathHash, sessionID)) {
        return { output: "error: draft not found" }
      }
      let result: "applied" | "not-found" | "no-suggestion"
      if (ext === ".xlsx") {
        result = await applyCellSuggestion(draftPath, args.commentId)
      } else if (ext === ".pptx") {
        result = await applySlideSuggestion(draftPath, args.commentId)
      } else {
        result = await applyCommentSuggestion(draftPath, args.commentId)
      }
      if (result === "not-found") {
        return { output: `error: comment ${args.commentId} not found` }
      }
      if (result === "no-suggestion") {
        return { output: `error: comment ${args.commentId} has no suggestion to approve` }
      }
      return { output: `Approved comment ${args.commentId} on ${filePath}: suggestion applied` }
    }

    if (action === "track-insert" || action === "track-delete") {
      if (!filePath || !args.commentId || !args.author || !args.content || args.paragraph === undefined || args.offset === undefined) {
        return { output: "error: track-insert/track-delete requires filePath, commentId, author, content, paragraph, offset" }
      }
      const ext = extname(filePath)
      if (ext !== ".docx") {
        return { output: "error: track changes not supported for XLSX/PPTX files (w:ins/w:del is Word-only OOXML); use comment action for review feedback" }
      }
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock || lock.sessionID !== sessionID) {
        return { output: "error: no active draft to add track change" }
      }
      const draftPath = getDraftPath(filePathHash, sessionID, ext)
      if (!draftExists(filePathHash, sessionID)) {
        return { output: "error: draft not found" }
      }
      const trackChange: TrackChange = {
        id: args.commentId,
        type: action === "track-insert" ? "insertion" : "deletion",
        author: args.author,
        timestamp: new Date(),
        text: args.content,
        paragraph: args.paragraph,
        offset: args.offset,
      }
      await writeTrackChange(draftPath, trackChange)
      return { output: `Track change added to draft for ${filePath}` }
    }

    if (action === "list-comments") {
      if (!filePath) {
        return { output: "error: list-comments requires filePath" }
      }
      const ext = extname(filePath)
      if (ext !== ".docx" && ext !== ".xlsx" && ext !== ".pptx") {
        return { output: "error: comments only supported for DOCX, XLSX and PPTX files" }
      }
      const filePathHash = getFilePathHash(filePath)
      let targetPath = filePath
      if (draftExists(filePathHash, sessionID)) {
        targetPath = getDraftPath(filePathHash, sessionID, ext)
      } else if (!existsSync(filePath)) {
        return { output: `error: file not found: ${filePath}` }
      }
      if (ext === ".xlsx") {
        const comments = await readXlsxComments(targetPath)
        return { output: `${comments.length} comments\n${JSON.stringify(comments, null, 2)}` }
      }
      if (ext === ".pptx") {
        const comments = await readPptxComments(targetPath)
        return { output: `${comments.length} comments\n${JSON.stringify(comments, null, 2)}` }
      }
      const comments = await readComments(targetPath)
      return { output: `${comments.length} comments\n${JSON.stringify(comments, null, 2)}` }
    }

    if (action === "preview") {
      if (!filePath) {
        return { output: "error: preview requires filePath" }
      }
      const filePathHash = getFilePathHash(filePath)
      if (!draftExists(filePathHash, sessionID)) {
        return { output: "error: no active draft to preview" }
      }
      const draftPath = getDraftPath(filePathHash, sessionID, extname(filePath))
      const outputPath = join(tmpdir(), "openoffice-preview", `${filePathHash}.html`)
      try {
        await renderMarkdownFileToHtml(draftPath, outputPath)
      } catch (error) {
        return { output: `error: ${(error as Error).message}` }
      }
      return { output: `Preview rendered to ${outputPath}` }
    }

    if (action === "validate") {
      if (!filePath || !args.rules) {
        return { output: "error: validate requires filePath and rules" }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(args.rules)
      } catch {
        return { output: "error: invalid rules JSON" }
      }
      if (!Array.isArray(parsed)) {
        return { output: "error: rules must be an array" }
      }
      const rules: Array<{ type: "regex" | "required"; pattern: string }> = []
      for (let i = 0; i < parsed.length; i++) {
        const rule = parsed[i] as { type?: unknown; pattern?: unknown }
        if (rule.type !== "regex" && rule.type !== "required") {
          return { output: `error: rule ${i} has unknown type ${String(rule.type)}` }
        }
        if (typeof rule.pattern !== "string") {
          return { output: `error: rule ${i} must have a string pattern` }
        }
        rules.push({ type: rule.type, pattern: rule.pattern })
      }
      const filePathHash = getFilePathHash(filePath)
      if (!draftExists(filePathHash, sessionID)) {
        return { output: "error: no active draft to validate" }
      }
      const draftPath = getDraftPath(filePathHash, sessionID, extname(filePath))
      const content = readFileSync(draftPath, "utf-8")
      const results: Array<{ rule: (typeof rules)[number]; pass: boolean }> = []
      for (const rule of rules) {
        let pass: boolean
        if (rule.type === "regex") {
          try {
            pass = new RegExp(rule.pattern).test(content)
          } catch {
            return { output: `error: invalid regex pattern "${rule.pattern}"` }
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
      return { output: `Validation of ${filePath}: ${results.length} rules, ${passed} passed, ${failed} failed\n${lines.join("\n")}` }
    }

    if (action === "review") {
      if (!filePath) {
        return { output: "error: review requires filePath" }
      }
      const ext = extname(filePath)
      if (ext !== ".docx" && ext !== ".xlsx" && ext !== ".pptx") {
        return { output: "error: review only supported for DOCX, XLSX and PPTX files" }
      }
      const filePathHash = getFilePathHash(filePath)
      let targetPath = filePath
      if (draftExists(filePathHash, sessionID)) {
        targetPath = getDraftPath(filePathHash, sessionID, ext)
      } else if (!existsSync(filePath)) {
        return { output: `error: file not found: ${filePath}` }
      }
      if (ext === ".xlsx") {
        const comments = await readXlsxComments(targetPath)
        return {
          output: `Review summary for ${filePath}:\n${comments.length} comments (XLSX has no track changes)\n\nComments:\n${JSON.stringify(comments, null, 2)}`,
        }
      }
      if (ext === ".pptx") {
        const comments = await readPptxComments(targetPath)
        return {
          output: `Review summary for ${filePath}:\n${comments.length} comments (PPTX has no track changes)\n\nComments:\n${JSON.stringify(comments, null, 2)}`,
        }
      }
      const comments = await readComments(targetPath)
      const trackChanges = await readTrackChanges(targetPath)
      return {
        output: `Review summary for ${filePath}:\n${comments.length} comments, ${trackChanges.length} track changes\n\nComments:\n${JSON.stringify(comments, null, 2)}\n\nTrack Changes:\n${JSON.stringify(trackChanges, null, 2)}`,
      }
    }

    return { output: `error: action ${action} not implemented` }
  },
})

function isDataObject(value: unknown): value is Record<string, string | number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every((v) => typeof v === "string" || typeof v === "number")
}

function parseFilePaths(filePaths: string | undefined): string[] | string {
  if (filePaths === undefined) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(filePaths)
  } catch {
    return "error: invalid filePaths JSON"
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((p) => typeof p === "string")) {
    return "error: filePaths must be a non-empty array of strings"
  }
  return parsed
}
