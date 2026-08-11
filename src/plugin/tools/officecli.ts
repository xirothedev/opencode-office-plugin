import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createDraft, acceptDraft, undoDraft, getHistory, getDraftPath, draftExists, getSnapshot } from "../../core/draft/manager.js"
import { acquireLock, getLock, releaseLock } from "../../core/draft/lock.js"
import { getFilePathHash } from "../../core/storage/paths.js"
import { writeFileSync, readFileSync, existsSync } from "fs"
import { extname } from "path"

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
      acceptDraft(filePath, sessionID, args.timestamp)
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
      return { output: `${history.length} accept-points for ${filePath}` }
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
      // Return draft if exists, else real file
      if (draftExists(filePathHash, sessionID)) {
        const draftPath = getDraftPath(filePathHash, sessionID, ext)
        const content = readFileSync(draftPath, "utf-8")
        return { output: content }
      }
      if (!existsSync(filePath)) {
        return { output: `error: file not found: ${filePath}` }
      }
      const content = readFileSync(filePath, "utf-8")
      return { output: content }
    }

    return { output: `error: action ${action} not implemented` }
  },
})
