import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createDraft, acceptDraft, undoDraft, getHistory, getDraftPath, draftExists, getSnapshot } from "@/core/draft/manager.js"
import { acquireLock, getLock, releaseLock } from "@/core/draft/lock.js"
import { getFilePathHash } from "@/core/storage/paths.js"
import { writeFileSync, readFileSync, existsSync } from "fs"
import { extname } from "path"
import { detectFormat } from "@/core/format/detect.js"
import { extractTextFromPDF } from "@/core/format/backends/pdf.js"
import { extractTextFromImage } from "@/core/format/backends/image.js"
import { extractTextFromOffice } from "@/core/format/backends/office.js"
import { writeComment, readComments, type Comment } from "@/core/format/ooxml/comments.js"
import { writeTrackChange, readTrackChanges, type TrackChange } from "@/core/format/ooxml/trackchanges.js"

export const officecliTool: ToolDefinition = tool({
  description: "Office document automation. Create, edit, read, accept, undo, revert documents with draft lifecycle. Supports comments and track changes for DOCX.",
  args: {
    action: tool.schema.enum(["create", "edit", "read", "accept", "undo", "revert", "history", "comment", "track-insert", "track-delete", "list-comments", "review"]),
    filePath: tool.schema.string().optional(),
    content: tool.schema.string().optional(),
    timestamp: tool.schema.number().optional(),
    commentId: tool.schema.string().optional(),
    author: tool.schema.string().optional(),
    commentText: tool.schema.string().optional(),
    paragraph: tool.schema.number().optional(),
    offset: tool.schema.number().optional(),
    rangeStartParagraph: tool.schema.number().optional(),
    rangeStartOffset: tool.schema.number().optional(),
    rangeEndParagraph: tool.schema.number().optional(),
    rangeEndOffset: tool.schema.number().optional(),
  },
  async execute(args, context) {
    const { action, filePath, content } = args
    const sessionID = context.sessionID

    if (action === "create") {
      if (!filePath || !content) {
        return { output: "error: create requires filePath and content" }
      }
      const filePathHash = getFilePathHash(filePath)
      acquireLock(filePathHash, sessionID)
      createDraft(filePath, sessionID, content)
      return { output: `Draft created for ${filePath}` }
    }

    if (action === "accept") {
      if (!filePath) {
        return { output: "error: accept requires filePath" }
      }
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock || lock.sessionID !== sessionID) {
        return { output: "error: no active draft to accept" }
      }
      await acceptDraft(filePath, sessionID, args.timestamp)
      return { output: `Accepted draft for ${filePath}` }
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
      acquireLock(filePathHash, sessionID)
      createDraft(filePath, sessionID, snapshot)
      return { output: `Reverted to snapshot for ${filePath}` }
    }

    if (action === "read") {
      if (!filePath) {
        return { output: "error: read requires filePath" }
      }
      const filePathHash = getFilePathHash(filePath)
      const ext = extname(filePath)
      const format = detectFormat(filePath)

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
      if (format === "pdf") {
        const content = await extractTextFromPDF(filePath)
        return { output: content }
      }
      if (format === "docx" || format === "xlsx" || format === "pptx") {
        const content = await extractTextFromOffice(filePath)
        return { output: content }
      }
      if (format === "image") {
        const content = await extractTextFromImage(filePath)
        return { output: content }
      }
      if (format !== "text") {
        return { output: "error: format conversion not implemented for binary files" }
      }
      const content = readFileSync(filePath, "utf-8")
      return { output: content }
    }

    // Comment and track changes actions
    if (action === "comment") {
      if (!filePath || !args.commentId || !args.author || !args.commentText || args.rangeStartParagraph === undefined || args.rangeStartOffset === undefined || args.rangeEndParagraph === undefined || args.rangeEndOffset === undefined) {
        return { output: "error: comment requires filePath, commentId, author, commentText, rangeStartParagraph, rangeStartOffset, rangeEndParagraph, rangeEndOffset" }
      }
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock || lock.sessionID !== sessionID) {
        return { output: "error: no active draft to add comment" }
      }
      const ext = extname(filePath)
      if (ext !== ".docx") {
        return { output: "error: comments only supported for DOCX files" }
      }
      const draftPath = getDraftPath(filePathHash, sessionID, ext)
      if (!draftExists(filePathHash, sessionID)) {
        return { output: "error: draft not found" }
      }
      const comment: Comment = {
        id: args.commentId,
        author: args.author,
        text: args.commentText,
        timestamp: new Date(),
        rangeStart: { paragraph: args.rangeStartParagraph, offset: args.rangeStartOffset },
        rangeEnd: { paragraph: args.rangeEndParagraph, offset: args.rangeEndOffset },
        parentId: null,
        resolved: false,
      }
      await writeComment(draftPath, comment)
      return { output: `Comment added to draft for ${filePath}` }
    }

    if (action === "track-insert" || action === "track-delete") {
      if (!filePath || !args.commentId || !args.author || !args.content || args.paragraph === undefined || args.offset === undefined) {
        return { output: "error: track-insert/track-delete requires filePath, commentId, author, content, paragraph, offset" }
      }
      const filePathHash = getFilePathHash(filePath)
      const lock = getLock(filePathHash)
      if (!lock || lock.sessionID !== sessionID) {
        return { output: "error: no active draft to add track change" }
      }
      const ext = extname(filePath)
      if (ext !== ".docx") {
        return { output: "error: track changes only supported for DOCX files" }
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
      if (ext !== ".docx") {
        return { output: "error: comments only supported for DOCX files" }
      }
      const filePathHash = getFilePathHash(filePath)
      let targetPath = filePath
      if (draftExists(filePathHash, sessionID)) {
        targetPath = getDraftPath(filePathHash, sessionID, ext)
      } else if (!existsSync(filePath)) {
        return { output: `error: file not found: ${filePath}` }
      }
      const comments = await readComments(targetPath)
      return { output: `${comments.length} comments\n${JSON.stringify(comments, null, 2)}` }
    }

    if (action === "review") {
      if (!filePath) {
        return { output: "error: review requires filePath" }
      }
      const ext = extname(filePath)
      if (ext !== ".docx") {
        return { output: "error: review only supported for DOCX files" }
      }
      const filePathHash = getFilePathHash(filePath)
      let targetPath = filePath
      if (draftExists(filePathHash, sessionID)) {
        targetPath = getDraftPath(filePathHash, sessionID, ext)
      } else if (!existsSync(filePath)) {
        return { output: `error: file not found: ${filePath}` }
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
