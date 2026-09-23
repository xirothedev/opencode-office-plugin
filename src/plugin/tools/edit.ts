import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import type { Tool } from "@opencode/schema/tool";
import { Schema } from "effect";

import { acquireLock, getLock } from "@/core/draft/lock";
// ponytail: editTool is unregistered until host ships ctx.tool; extensions live in detect for the plugin-level permission guard
import { BINARY_EXTENSIONS } from "@/core/format/detect";
import { getFilePathHash } from "@/core/storage/paths";
import { fail, tryExecute } from "@/plugin/tools/boundary";

export {
  BINARY_EXTENSIONS,
  OFFICE_READ_EXTENSIONS,
} from "@/core/format/detect";

const S = Schema;

const editInput = S.Struct({
  filePath: S.String,
  newString: S.String,
  oldString: S.String,
});
type EditInput = Schema.Schema.Type<typeof editInput>;

const editOutput = S.String;

const runEdit = async (
  input: EditInput,
  context: Tool.Context
): Promise<string> => {
  // ponytail: manager pulls the docx backend — load it only when an edit actually runs
  const { createDraft, draftExists, getDraftPath } =
    await import("@/core/draft/manager");
  const { sessionID } = context;
  const ext = path.extname(input.filePath).toLowerCase();

  // Deny office/pdf/images — officecli is the main method for read + handle
  if (BINARY_EXTENSIONS.has(ext)) {
    fail(
      "use officecli tool for office/PDF files — office is the main method for read + handle"
    );
  }

  const filePathHash = getFilePathHash(input.filePath);

  // Check lock
  const lock = getLock(filePathHash);
  if (lock && lock.sessionID !== sessionID) {
    fail(`lock held by session ${lock.sessionID}`);
  }

  // Acquire lock if needed
  if (!lock) {
    acquireLock(filePathHash, sessionID, context.agent);
  }

  // Copy real file to draft if first edit
  if (!draftExists(filePathHash, sessionID)) {
    if (!existsSync(input.filePath)) {
      fail(`file not found: ${input.filePath}`);
    }
    const content = readFileSync(input.filePath, "utf-8");
    createDraft(input.filePath, sessionID, content);
  }

  // Apply edit to draft
  const draftPath = getDraftPath(filePathHash, sessionID, ext);
  const draftContent = readFileSync(draftPath, "utf-8");
  if (!draftContent.includes(input.oldString)) {
    fail("oldString not found in draft");
  }
  const updated = draftContent.replace(input.oldString, input.newString);
  writeFileSync(draftPath, updated);

  return `Edit applied to draft for ${input.filePath}`;
};

export const editTool: Tool.Info<typeof editInput, typeof editOutput> = {
  description:
    "Edit file (text only) — Office/PDF (.docx/.doc/.xlsx/.xls/.pptx/.ppt/.pdf/images) are blocked here; use officecli (the main method for read + handle of office/PDF).",
  execute: (input, context) =>
    tryExecute(async () => ({ output: await runEdit(input, context) })),
  input: editInput,
  name: "edit",
  options: { codemode: false },
  output: editOutput,
};
