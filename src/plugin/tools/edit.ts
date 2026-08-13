import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createDraft, draftExists, getDraftPath } from "../../core/draft/manager"
import { acquireLock, getLock } from "../../core/draft/lock"
import { getFilePathHash } from "../../core/storage/paths"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { extname } from "path"

const BINARY_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".png", ".jpg", ".jpeg", ".gif"])

export const editTool: ToolDefinition = tool({
  description: "Edit file (text only). Binary files require officecli tool.",
  args: {
    filePath: tool.schema.string(),
    oldString: tool.schema.string(),
    newString: tool.schema.string(),
  },
  async execute(args, context) {
    const { filePath, oldString, newString } = args
    const sessionID = context.sessionID
    const ext = extname(filePath).toLowerCase()

    // Deny binary files
    if (BINARY_EXTENSIONS.has(ext)) {
      return { output: "error: use officecli tool for binary files" }
    }

    const filePathHash = getFilePathHash(filePath)

    // Check lock
    const lock = getLock(filePathHash)
    if (lock && lock.sessionID !== sessionID) {
      return { output: `error: lock held by session ${lock.sessionID}` }
    }

    // Acquire lock if needed
    if (!lock) {
      acquireLock(filePathHash, sessionID, context.agent)
    }

    // Copy real file to draft if first edit
    if (!draftExists(filePathHash, sessionID)) {
      if (!existsSync(filePath)) {
        return { output: `error: file not found: ${filePath}` }
      }
      const content = readFileSync(filePath, "utf-8")
      createDraft(filePath, sessionID, content)
    }

    // Apply edit to draft
    const draftPath = getDraftPath(filePathHash, sessionID, ext)
    const draftContent = readFileSync(draftPath, "utf-8")
    if (!draftContent.includes(oldString)) {
      return { output: "error: oldString not found in draft" }
    }
    const updated = draftContent.replace(oldString, newString)
    writeFileSync(draftPath, updated)

    return { output: `Edit applied to draft for ${filePath}` }
  },
})
