import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createDraft, acceptDraft, undoDraft, getHistory, getDraftPath, draftExists, getSnapshot } from "../../core/draft/manager.js"
import { acquireLock, getLock, releaseLock } from "../../core/draft/lock.js"
import { getFilePathHash } from "../../core/storage/paths.js"
import { writeFileSync, readFileSync, existsSync } from "fs"
import { extname } from "path"
import { detectFormat } from "../../core/format/detect.js"
import { extractTextFromPDF } from "../../core/format/backends/pdf.js"
import { extractTextFromImage } from "../../core/format/backends/image.js"
import { extractTextFromOffice } from "../../core/format/backends/office.js"

export const officecliTool: ToolDefinition = tool({
  description: "Office document automation. Create, edit, read, accept, undo, revert documents with draft lifecycle.",
  args: {
    action: tool.schema.enum(["create", "edit", "read", "accept", "undo", "revert", "history"]),
    filePath: tool.schema.string().optional(),
    content: tool.schema.string().optional(),
    timestamp: tool.schema.number().optional(),
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

    return { output: `error: action ${action} not implemented` }
  },
})
