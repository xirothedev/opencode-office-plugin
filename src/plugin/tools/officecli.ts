import type { Tool } from "@opencode/schema/tool";
import { Schema } from "effect";

import { capture } from "@/plugin/capture";
import { tryExecute } from "@/plugin/tools/boundary";

const S = Schema;

const createArgs = S.Struct({
  action: S.Literal("create"),
  content: S.NonEmptyString,
  filePath: S.optional(S.String),
  filePaths: S.optional(S.String),
});
const acceptArgs = S.Struct({
  action: S.Literal("accept"),
  filePath: S.optional(S.String),
  filePaths: S.optional(S.String),
  timestamp: S.optional(S.Number),
});
const undoArgs = S.Struct({ action: S.Literal("undo"), filePath: S.String });
const editArgs = S.Struct({
  action: S.Literal("edit"),
  content: S.NonEmptyString,
  filePath: S.String,
});
const lockStatusArgs = S.Struct({
  action: S.Literal("lock-status"),
  filePath: S.String,
});
const forceReleaseArgs = S.Struct({
  action: S.Literal("force-release"),
  filePath: S.String,
});
const listArgs = S.Struct({
  action: S.Literal("list"),
  filePath: S.optional(S.String),
});
const diffArgs = S.Struct({ action: S.Literal("diff"), filePath: S.String });
const generateArgs = S.Struct({
  action: S.Literal("generate"),
  data: S.optional(S.String),
  dataArray: S.optional(S.String),
  filePath: S.optional(S.String),
  filePaths: S.optional(S.String),
  templatePath: S.String,
});
const historyArgs = S.Struct({
  action: S.Literal("history"),
  filePath: S.String,
});
const revertArgs = S.Struct({
  action: S.Literal("revert"),
  filePath: S.String,
  timestamp: S.Number,
});
const metadataArgs = S.Struct({
  action: S.Literal("metadata"),
  filePath: S.String,
  properties: S.optional(S.String),
});
const watermarkArgs = S.Struct({
  action: S.Literal("watermark"),
  filePath: S.String,
  opacity: S.optional(S.Number),
  position: S.optional(S.String),
  size: S.optional(S.Number),
  text: S.String,
});
const annotateArgs = S.Struct({
  action: S.Literal("annotate"),
  annotations: S.String,
  filePath: S.String,
});
const exportArgs = S.Struct({
  action: S.Literal("export"),
  filePath: S.String,
  targetPath: S.String,
});
const readArgs = S.Struct({
  action: S.Literal("read"),
  apiKey: S.optional(S.String),
  apiUrl: S.optional(S.String),
  filePath: S.String,
  live: S.optional(S.Boolean),
  ocr: S.optional(
    S.Union([S.Boolean, S.Literal("hosted"), S.Literal("reject")])
  ),
});
const commentArgs = S.Struct({
  action: S.Literal("comment"),
  author: S.String,
  cellRef: S.optional(S.String),
  commentId: S.String,
  commentText: S.String,
  filePath: S.String,
  rangeEndOffset: S.optional(S.Number),
  rangeEndParagraph: S.optional(S.Number),
  rangeStartOffset: S.optional(S.Number),
  rangeStartParagraph: S.optional(S.Number),
  slide: S.optional(S.Number),
  suggestedText: S.optional(S.String),
  targetText: S.optional(S.String),
  x: S.optional(S.Number),
  y: S.optional(S.Number),
});
const approveArgs = S.Struct({
  action: S.Literal("approve"),
  commentId: S.String,
  filePath: S.String,
});
const editCommentArgs = S.Struct({
  action: S.Literal("edit-comment"),
  commentId: S.String,
  filePath: S.String,
  suggestedText: S.optional(S.String),
  text: S.optional(S.String),
});
const deleteCommentArgs = S.Struct({
  action: S.Literal("delete-comment"),
  commentId: S.String,
  filePath: S.String,
});
const resolveCommentArgs = S.Struct({
  action: S.Literal("resolve-comment"),
  commentId: S.String,
  filePath: S.String,
});
const denyCommentArgs = S.Struct({
  action: S.Literal("deny-comment"),
  commentId: S.String,
  filePath: S.String,
});
const trackChangeArgs = S.Struct({
  action: S.Union([S.Literal("track-insert"), S.Literal("track-delete")]),
  author: S.String,
  commentId: S.String,
  content: S.String,
  filePath: S.String,
  offset: S.Number,
  paragraph: S.Number,
});
const listCommentsArgs = S.Struct({
  action: S.Literal("list-comments"),
  filePath: S.String,
});
const previewArgs = S.Struct({
  action: S.Literal("preview"),
  filePath: S.String,
});
const cloneArgs = S.Struct({
  action: S.Literal("clone"),
  filePath: S.String,
  targetPath: S.String,
});
const substituteArgs = S.Struct({
  action: S.Literal("substitute"),
  data: S.String,
  filePath: S.String,
});
const verifyL3Args = S.Struct({
  action: S.Literal("verify-l3"),
  filePath: S.String,
  referencePath: S.String,
});
const validateArgs = S.Struct({
  action: S.Literal("validate"),
  filePath: S.String,
  rules: S.String,
});
const reviewArgs = S.Struct({
  action: S.Literal("review"),
  filePath: S.String,
});

export const officecliInput = S.Union([
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
]);
export type OfficeCliInput = Schema.Schema.Type<typeof officecliInput>;

const officecliOutput = S.String;

export const officecliTool: Tool.Info<
  typeof officecliInput,
  typeof officecliOutput
> = {
  description:
    "MAIN method for all Office and PDF files (.docx/.doc/.dotx/.xlsx/.xls/.xlsm/.pptx/.ppt/.pdf and images) — handle every read, create, edit, accept, undo, history, revert, comment, track-change, metadata, watermark, export through this tool. The native read/edit/write tools are blocked for these extensions and will error with 'use officecli'. Draft lifecycle: create/edit → accept (writes real file, snapshots version). Preview renders draft to HTML, validate checks draft against rules, lock-status/force-release manage stale locks (default 24h). Comments for DOCX/XLSX/PPTX, track changes for DOCX, suggestions via comment+suggestedText+approve (PPTX approve accepts optional targetText to pick the box; denied suggestions cannot be approved). Comment lifecycle: open/resolved/denied via edit-comment/delete-comment/resolve-comment/deny-comment; list-comments/review surface status. L3 Fidelity: clone (copy Reference ZIP verbatim for 100% Format), substitute (run-preserving {{placeholder}} replace on Draft ZIP), verify-l3 (OOXML diff except text nodes). Suggest-first: on documents you did not create this session, content changes default to comment+suggestedText (approve applies); ask the user before direct-editing.",
  execute: (input, context) =>
    tryExecute(async () => ({
      output: await capture(
        context.agent === "openoffice-invoke" ? "host" : "agent",
        input.action,
        input,
        // ponytail: heavy backends load on first call — boot graph stays schema-only
        () =>
          import("@/plugin/tools/officecli-actions").then((m) =>
            m.runAction(input, context)
          )
      ),
    })),
  input: officecliInput,
  name: "officecli",
  options: { codemode: false },
  output: officecliOutput,
};
