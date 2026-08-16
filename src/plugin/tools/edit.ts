import { Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import { createDraft, draftExists, getDraftPath } from "@/core/draft/manager"
import { acquireLock, getLock } from "@/core/draft/lock"
import { getFilePathHash } from "@/core/storage/paths"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { extname } from "path"
import { fail, tryExecute } from "@/plugin/tools/boundary"

const BINARY_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".png", ".jpg", ".jpeg", ".gif"])

const S = Schema

const editInput = S.Struct({
  filePath: S.String,
  oldString: S.String,
  newString: S.String,
})
type EditInput = Schema.Schema.Type<typeof editInput>

const editOutput = S.String

export const editTool: Tool.Info<typeof editInput, typeof editOutput> = {
  name: "edit",
  description: "Edit file (text only). Binary files require officecli tool.",
  input: editInput,
  output: editOutput,
  options: { codemode: false },
  execute: (input, context) =>
    tryExecute(async () => ({ output: await runEdit(input, context) })),
}

async function runEdit(input: EditInput, context: Tool.Context): Promise<string> {
  const sessionID = context.sessionID
  const ext = extname(input.filePath).toLowerCase()

  // Deny binary files
  if (BINARY_EXTENSIONS.has(ext)) {
    fail("use officecli tool for binary files")
  }

  const filePathHash = getFilePathHash(input.filePath)

  // Check lock
  const lock = getLock(filePathHash)
  if (lock && lock.sessionID !== sessionID) {
    fail(`lock held by session ${lock.sessionID}`)
  }

  // Acquire lock if needed
  if (!lock) {
    acquireLock(filePathHash, sessionID, context.agent)
  }

  // Copy real file to draft if first edit
  if (!draftExists(filePathHash, sessionID)) {
    if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`)
    }
    const content = readFileSync(input.filePath, "utf-8")
    createDraft(input.filePath, sessionID, content)
  }

  // Apply edit to draft
  const draftPath = getDraftPath(filePathHash, sessionID, ext)
  const draftContent = readFileSync(draftPath, "utf-8")
  if (!draftContent.includes(input.oldString)) {
    fail("oldString not found in draft")
  }
  const updated = draftContent.replace(input.oldString, input.newString)
  writeFileSync(draftPath, updated)

  return `Edit applied to draft for ${input.filePath}`
}
