import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import type { Tool } from "@opencode/schema/tool";

import * as Comments from "@/core/comments";
import * as Draft from "@/core/draft";
import { diffTexts } from "@/core/draft/diff";
import {
  parseAnnotationOps,
  ANNOTATE_EXTENSIONS,
} from "@/core/format/annotate";
import { detectFormat } from "@/core/format/detect";
import { writeDerivedFile, assertExportPaths } from "@/core/format/export";
import {
  METADATA_EXTENSIONS,
  parseMetadataProperties,
} from "@/core/format/metadata";
import {
  writeTrackChange,
  readTrackChanges,
} from "@/core/format/ooxml/trackchanges";
import type { TrackChange } from "@/core/format/ooxml/trackchanges";
import {
  readLiveOrFileAsMarkdown,
  readRealFileAsMarkdown,
} from "@/core/format/read";
import type { ReadOptions } from "@/core/format/read";
import { renderMarkdownFileToHtml } from "@/core/format/render";
import { sanitizeMarkdown, sanitizeXmlText } from "@/core/format/sanitize";
import { parseRules, renderValidationReport } from "@/core/format/validate";
import {
  buildWatermarkConfig,
  WATERMARK_EXTENSIONS,
} from "@/core/format/watermark";
import {
  assertTemplate,
  parseGenerateEntries,
  parseTemplateData,
  readCloneSource,
} from "@/core/template/generate";
import { substituteTemplate } from "@/core/template/substitute";
import { captureQuiet } from "@/plugin/capture";
import { fail } from "@/plugin/tools/boundary";
import type { OfficeCliInput } from "@/plugin/tools/officecli";

const parseFilePaths = (filePaths: string | undefined): string[] | string => {
  if (filePaths === undefined) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(filePaths);
  } catch {
    return "invalid filePaths JSON";
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((p) => typeof p === "string")
  ) {
    return "filePaths must be a non-empty array of strings";
  }
  return parsed;
};

// The metadata/watermark/annotate/substitute preamble, in one call into Draft
const requireDraftFor = (filePath: string, sessionID: string): void => {
  Draft.requireOwned(filePath, sessionID, "no active draft");
  Draft.requireDraftExists(filePath, sessionID);
};

// needsOcr/hosted are the tool's agent-facing read contract (ADR: Hosted OCR);
// both the draft and the file branch of the read action share this mapping.
const readWithOcrError = async (
  filePath: string,
  opts?: ReadOptions
): Promise<string> => {
  try {
    return await readRealFileAsMarkdown(filePath, opts);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "needsOcr") {
      const pages = (error as { pages?: number[] })?.pages ?? [];
      const pageCount = (error as { pageCount?: number })?.pageCount ?? 0;
      fail(
        JSON.stringify({
          code: "needsOcr",
          hint: 'retry with ocr: "hosted" (or ocr: true) — sends document to Firecrawl Parse for OCR',
          pageCount,
          pages,
        })
      );
    }
    if (code === "hosted") {
      fail(`hosted OCR failed: ${(error as Error).message}`);
    }
    throw error;
  }
};

interface ActionContext {
  owner: string;
  sessionID: string;
  context: Tool.Context;
}

const handleCreate = (
  input: Extract<OfficeCliInput, { action: "create" }>,
  { owner, sessionID }: ActionContext
): string => {
  const { filePath, filePaths, content } = input;
  if (!filePath && !filePaths) {
    return fail("create requires filePath or filePaths");
  }
  const cleanContent = sanitizeMarkdown(content);
  const targets = parseFilePaths(filePaths);
  if (typeof targets === "string") {
    return fail(targets);
  }
  if (filePath && targets.length === 0) {
    Draft.create(filePath, sessionID, owner, cleanContent);
    return existsSync(filePath)
      ? `Draft created for ${filePath} — pre-existing document: prefer comment+suggestedText for content changes; ask the user before direct-editing`
      : `Draft created for ${filePath}`;
  }
  const paths = targets.length > 0 ? targets : [filePath as string];
  for (const p of paths) {
    Draft.assertNoForeignLock(p, sessionID, true);
  }
  for (const p of paths) {
    Draft.create(p, sessionID, owner, cleanContent);
  }
  const preExisting = paths.filter((p) => existsSync(p)).length;
  return `Created ${paths.length} drafts${preExisting > 0 ? ` (${preExisting} pre-existing — suggest-first, ask the user before direct-editing)` : ""}`;
};

const handleAccept = async (
  input: Extract<OfficeCliInput, { action: "accept" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  const { filePath, filePaths, timestamp } = input;
  if (!filePath && !filePaths) {
    return fail("accept requires filePath or filePaths");
  }
  const targets = parseFilePaths(filePaths);
  if (typeof targets === "string") {
    return fail(targets);
  }
  if (filePath && targets.length === 0) {
    Draft.requireOwned(filePath, sessionID, "no active draft to accept");
    Draft.requireDraftExists(
      filePath,
      sessionID,
      `draft not found for ${filePath}`
    );
    await Draft.accept(filePath, sessionID, timestamp);
    return `Accepted draft for ${filePath}`;
  }
  const paths = targets.length > 0 ? targets : [filePath as string];
  for (const p of paths) {
    Draft.requireOwned(p, sessionID, `no active draft to accept for ${p}`);
    Draft.requireDraftExists(p, sessionID, `draft not found for ${p}`);
  }
  await Promise.all(paths.map((p) => Draft.accept(p, sessionID, timestamp)));
  return `Accepted ${paths.length} drafts`;
};

const handleUndo = (
  input: Extract<OfficeCliInput, { action: "undo" }>,
  { sessionID }: ActionContext
): string => {
  Draft.requireOwned(input.filePath, sessionID, "no active draft to undo");
  Draft.undo(input.filePath, sessionID);
  return `Draft undone for ${input.filePath}`;
};

const handleEdit = (
  input: Extract<OfficeCliInput, { action: "edit" }>,
  { sessionID }: ActionContext
): string => {
  Draft.requireOwned(input.filePath, sessionID, "no active draft to edit");
  Draft.requireDraftExists(input.filePath, sessionID);
  Draft.write(input.filePath, sessionID, sanitizeMarkdown(input.content));
  return `Draft edited for ${input.filePath}`;
};

const handleLockStatus = (
  input: Extract<OfficeCliInput, { action: "lock-status" }>
): string => {
  const lock = Draft.status(input.filePath);
  if (!lock) {
    return `no lock on ${input.filePath}`;
  }
  return JSON.stringify({
    owner: lock.owner,
    sessionID: lock.sessionID,
    stale: lock.stale,
    status: lock.status,
    touchedAt: lock.touchedAt,
  });
};

const handleForceRelease = (
  input: Extract<OfficeCliInput, { action: "force-release" }>,
  { owner, sessionID }: ActionContext
): string => {
  Draft.forceRelease(input.filePath, sessionID, owner);
  return `Force released lock on ${input.filePath}`;
};

const handleList = (
  input: Extract<OfficeCliInput, { action: "list" }>
): string => JSON.stringify(Draft.listDrafts(input.filePath), null, 2);

const handleDiff = async (
  input: Extract<OfficeCliInput, { action: "diff" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  if (!Draft.exists(input.filePath, sessionID)) {
    const sessions = Draft.draftSessions(input.filePath);
    if (sessions.length > 0) {
      fail(`no draft for this session; draft held by session ${sessions[0]}`);
    }
    fail("no active draft to diff");
  }
  if (!existsSync(input.filePath)) {
    fail(`file not found: ${input.filePath}`);
  }
  if (detectFormat(input.filePath) === "image") {
    fail("diff not supported for images");
  }
  const draftContent = await Draft.draftMarkdown(input.filePath, sessionID);
  const realContent = await readRealFileAsMarkdown(input.filePath);
  return diffTexts(realContent, draftContent);
};

const handleGenerate = async (
  input: Extract<OfficeCliInput, { action: "generate" }>,
  { owner, sessionID }: ActionContext
): Promise<string> => {
  assertTemplate(input.templatePath);
  const entries = parseGenerateEntries(input);
  const template = await readRealFileAsMarkdown(input.templatePath);
  // Validate every entry before creating anything: a missing key or a held
  // lock must abort with no partial drafts
  const prepared: { filePath: string; content: string }[] = [];
  for (const entry of entries) {
    Draft.assertNoForeignLock(entry.filePath, sessionID, false);
    prepared.push({
      content: sanitizeMarkdown(substituteTemplate(template, entry.data)),
      filePath: entry.filePath,
    });
  }
  for (const p of prepared) {
    Draft.create(p.filePath, sessionID, owner, p.content);
  }
  return `Generated ${prepared.length} drafts from ${input.templatePath}`;
};

const handleHistory = (
  input: Extract<OfficeCliInput, { action: "history" }>
): string => {
  const history = Draft.history(input.filePath);
  return `${history.length} accept-points for ${input.filePath}\n${JSON.stringify(history)}`;
};

const handleRevert = (
  input: Extract<OfficeCliInput, { action: "revert" }>,
  { owner, sessionID }: ActionContext
): string => {
  Draft.revert(input.filePath, sessionID, owner, input.timestamp);
  return `Reverted to snapshot for ${input.filePath}`;
};

const handleMetadata = async (
  input: Extract<OfficeCliInput, { action: "metadata" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  const ext = nodePath.extname(input.filePath).toLowerCase();
  if (!METADATA_EXTENSIONS.includes(ext)) {
    fail("metadata only supported for DOCX, XLSX, PPTX and PDF files");
  }
  if (input.properties !== undefined) {
    requireDraftFor(input.filePath, sessionID);
    Draft.setSidecarMetadata(
      input.filePath,
      sessionID,
      parseMetadataProperties(input.properties)
    );
    return `Metadata set for ${input.filePath}`;
  }
  if (!existsSync(input.filePath)) {
    fail(`file not found: ${input.filePath}`);
  }
  return JSON.stringify(
    await Draft.effectiveMetadata(input.filePath, sessionID),
    null,
    2
  );
};

const handleWatermark = (
  input: Extract<OfficeCliInput, { action: "watermark" }>,
  { sessionID }: ActionContext
): string => {
  const ext = nodePath.extname(input.filePath).toLowerCase();
  if (!WATERMARK_EXTENSIONS.includes(ext)) {
    fail("watermark only supported for DOCX and PDF files");
  }
  requireDraftFor(input.filePath, sessionID);
  if (input.text === "") {
    Draft.setSidecarWatermark(input.filePath, sessionID, null);
    return `Watermark removed for ${input.filePath}`;
  }
  Draft.setSidecarWatermark(
    input.filePath,
    sessionID,
    buildWatermarkConfig(ext, {
      opacity: input.opacity,
      position: input.position,
      size: input.size,
      text: input.text,
    })
  );
  return `Watermark set for ${input.filePath}: "${input.text}"`;
};

const handleAnnotate = (
  input: Extract<OfficeCliInput, { action: "annotate" }>,
  { sessionID }: ActionContext
): string => {
  const ext = nodePath.extname(input.filePath).toLowerCase();
  if (!ANNOTATE_EXTENSIONS.includes(ext)) {
    fail("annotate only supported for PNG and JPG images");
  }
  requireDraftFor(input.filePath, sessionID);
  const ops = parseAnnotationOps(ext, input.annotations);
  Draft.appendSidecarAnnotations(input.filePath, sessionID, ops ?? []);
  return ops === null
    ? `Annotations cleared for ${input.filePath}`
    : `Annotations added to draft for ${input.filePath}: ${ops.length}`;
};

const handleExport = async (
  input: Extract<OfficeCliInput, { action: "export" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  const hasDraft = Draft.exists(input.filePath, sessionID);
  if (!hasDraft && !existsSync(input.filePath)) {
    fail(`file not found: ${input.filePath}`);
  }
  assertExportPaths(input.filePath, input.targetPath);
  const markdown = hasDraft
    ? await Draft.draftMarkdown(input.filePath, sessionID)
    : await readRealFileAsMarkdown(input.filePath);
  await writeDerivedFile(markdown, input.targetPath);
  return `Exported ${input.filePath} to ${input.targetPath}`;
};

const handleRead = async (
  input: Extract<OfficeCliInput, { action: "read" }>,
  { sessionID, context }: ActionContext
): Promise<string> => {
  const readOpts =
    input.ocr !== undefined ||
    input.apiKey !== undefined ||
    input.apiUrl !== undefined
      ? { apiKey: input.apiKey, apiUrl: input.apiUrl, ocr: input.ocr as never }
      : undefined;

  // Return draft if exists, else real file (live flag prefers Word app when on same machine)
  if (Draft.exists(input.filePath, sessionID)) {
    const draftPath = Draft.draftPath(input.filePath, sessionID);
    // ponytail: zip draft (comment/track) holds real OOXML — extract text, don't dump PK
    const buf = readFileSync(draftPath);
    const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (isZip) {
      return await readWithOcrError(draftPath, readOpts);
    }
    return buf.toString("utf-8");
  }
  if (input.live === true) {
    try {
      return await readLiveOrFileAsMarkdown(input.filePath, true, readOpts);
    } catch (error) {
      // ponytail: live best-effort failed, fall through to file check — captured so the failure is not invisible
      captureQuiet(
        context.agent === "openoffice-invoke" ? "host" : "agent",
        "live-read-fallback",
        { filePath: input.filePath },
        error
      );
    }
  }
  if (!existsSync(input.filePath)) {
    fail(`file not found: ${input.filePath}`);
  }
  return await readWithOcrError(input.filePath, readOpts);
};

const handleComment = async (
  input: Extract<OfficeCliInput, { action: "comment" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  Comments.requireFormat(input.filePath, "comments");
  const newComment = {
    author: input.author,
    cellRef: input.cellRef,
    id: input.commentId,
    rangeEndOffset: input.rangeEndOffset,
    rangeEndParagraph: input.rangeEndParagraph,
    rangeStartOffset: input.rangeStartOffset,
    rangeStartParagraph: input.rangeStartParagraph,
    slide: input.slide,
    suggestedText: input.suggestedText,
    targetText: input.targetText,
    text: input.commentText,
    x: input.x,
    y: input.y,
  };
  Comments.validate(input.filePath, newComment);
  Draft.requireOwned(
    input.filePath,
    sessionID,
    "no active draft to add comment"
  );
  Draft.requireDraftExists(input.filePath, sessionID);
  const draftPath = Draft.draftPath(input.filePath, sessionID);
  await Comments.add(draftPath, newComment);
  return `Comment added to draft for ${input.filePath}`;
};

const handleApprove = async (
  input: Extract<OfficeCliInput, { action: "approve" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  Comments.requireFormat(input.filePath, "suggestions");
  Draft.requireOwned(input.filePath, sessionID, "no active draft to approve");
  Draft.requireDraftExists(input.filePath, sessionID);
  const draftPath = Draft.draftPath(input.filePath, sessionID);
  const result = await Comments.applySuggestion(draftPath, input.commentId);
  if (result === "not-found") {
    fail(`comment ${input.commentId} not found`);
  }
  if (result === "no-suggestion") {
    fail(`comment ${input.commentId} has no suggestion to approve`);
  }
  if (result === "denied") {
    fail(`comment ${input.commentId} was denied — suggestion not applied`);
  }
  return `Approved comment ${input.commentId} on ${input.filePath}: suggestion applied`;
};

const handleCommentLifecycle = async (
  input: Extract<
    OfficeCliInput,
    {
      action:
        | "edit-comment"
        | "delete-comment"
        | "resolve-comment"
        | "deny-comment";
    }
  >,
  { sessionID }: ActionContext
): Promise<string> => {
  Comments.requireFormat(input.filePath, "comment lifecycle actions");
  Draft.requireOwned(
    input.filePath,
    sessionID,
    `no active draft to ${input.action.replace("-", " ")}`
  );
  Draft.requireDraftExists(input.filePath, sessionID);
  const draftPath = Draft.draftPath(input.filePath, sessionID);
  if (input.action === "edit-comment") {
    if (input.text === undefined && input.suggestedText === undefined) {
      fail("edit-comment requires text or suggestedText");
    }
    const result = await Comments.update(draftPath, input.commentId, {
      suggestedText: input.suggestedText,
      text: input.text,
    });
    if (result === "not-found") {
      fail(`comment ${input.commentId} not found`);
    }
    return `Comment ${input.commentId} updated on ${input.filePath}`;
  }
  if (input.action === "delete-comment") {
    const result = await Comments.remove(draftPath, input.commentId);
    if (result === "not-found") {
      fail(`comment ${input.commentId} not found`);
    }
    return `Comment ${input.commentId} deleted from ${input.filePath}`;
  }
  const status = input.action === "resolve-comment" ? "resolved" : "denied";
  const result = await Comments.setStatus(draftPath, input.commentId, status);
  if (result === "not-found") {
    fail(`comment ${input.commentId} not found`);
  }
  return `Comment ${input.commentId} marked ${status} on ${input.filePath}`;
};

const handleTrackChange = async (
  input: Extract<OfficeCliInput, { action: "track-insert" | "track-delete" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  const ext = nodePath.extname(input.filePath);
  if (ext !== ".docx") {
    fail(
      "track changes not supported for XLSX/PPTX files (w:ins/w:del is Word-only OOXML); use comment action for review feedback"
    );
  }
  Draft.requireOwned(
    input.filePath,
    sessionID,
    "no active draft to add track change"
  );
  Draft.requireDraftExists(input.filePath, sessionID);
  const draftPath = Draft.draftPath(input.filePath, sessionID);
  const trackChange: TrackChange = {
    author: sanitizeXmlText(input.author),
    id: input.commentId,
    offset: input.offset,
    paragraph: input.paragraph,
    text: sanitizeXmlText(input.content),
    timestamp: new Date(),
    type: input.action === "track-insert" ? "insertion" : "deletion",
  };
  await writeTrackChange(draftPath, trackChange);
  return `Track change added to draft for ${input.filePath}`;
};

const handleListComments = async (
  input: Extract<OfficeCliInput, { action: "list-comments" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  Comments.requireFormat(input.filePath, "comments");
  let targetPath = input.filePath;
  if (Draft.exists(input.filePath, sessionID)) {
    targetPath = Draft.draftPath(input.filePath, sessionID);
  } else if (!existsSync(input.filePath)) {
    fail(`file not found: ${input.filePath}`);
  }
  const comments = await Comments.list(targetPath);
  return `${comments.length} comments\n${JSON.stringify(comments, null, 2)}`;
};

const handlePreview = async (
  input: Extract<OfficeCliInput, { action: "preview" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  if (!Draft.exists(input.filePath, sessionID)) {
    fail("no active draft to preview");
  }
  const filePathHash = Draft.hashOf(input.filePath);
  const outputPath = nodePath.join(
    tmpdir(),
    "openoffice-preview",
    `${filePathHash}.html`
  );
  try {
    const md = await Draft.draftMarkdown(input.filePath, sessionID);
    const tmpMd = nodePath.join(
      tmpdir(),
      `openoffice-preview-${filePathHash}.md`
    );
    writeFileSync(tmpMd, md);
    await renderMarkdownFileToHtml(tmpMd, outputPath);
  } catch (error) {
    fail((error as Error).message);
  }
  return `Preview rendered to ${outputPath}`;
};

const handleValidate = async (
  input: Extract<OfficeCliInput, { action: "validate" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  const rules = parseRules(input.rules);
  if (!Draft.exists(input.filePath, sessionID)) {
    fail("no active draft to validate");
  }
  const content = await Draft.draftMarkdown(input.filePath, sessionID);
  return renderValidationReport(input.filePath, content, rules);
};

const handleReview = async (
  input: Extract<OfficeCliInput, { action: "review" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  const ext = Comments.requireFormat(input.filePath, "review");
  let targetPath = input.filePath;
  if (Draft.exists(input.filePath, sessionID)) {
    targetPath = Draft.draftPath(input.filePath, sessionID);
  } else if (!existsSync(input.filePath)) {
    fail(`file not found: ${input.filePath}`);
  }
  const comments = await Comments.list(targetPath);
  if (ext === ".xlsx") {
    return `Review summary for ${input.filePath}:\n${comments.length} comments (XLSX has no track changes)\n\nComments:\n${JSON.stringify(comments, null, 2)}`;
  }
  if (ext === ".pptx") {
    return `Review summary for ${input.filePath}:\n${comments.length} comments (PPTX has no track changes)\n\nComments:\n${JSON.stringify(comments, null, 2)}`;
  }
  const trackChanges = await readTrackChanges(targetPath);
  return `Review summary for ${input.filePath}:\n${comments.length} comments, ${trackChanges.length} track changes\n\nComments:\n${JSON.stringify(comments, null, 2)}\n\nTrack Changes:\n${JSON.stringify(trackChanges, null, 2)}`;
};

const handleClone = (
  input: Extract<OfficeCliInput, { action: "clone" }>,
  { owner, sessionID }: ActionContext
): string => {
  const buf = readCloneSource(nodePath.resolve(input.filePath), input.filePath);
  const targetPath = nodePath.resolve(input.targetPath);
  if (targetPath === nodePath.resolve(input.filePath)) {
    fail("targetPath must differ from filePath");
  }
  Draft.assertNoForeignLock(targetPath, sessionID, true, input.targetPath);
  Draft.cloneIntoDraft(targetPath, sessionID, owner, buf);
  return `Cloned ${input.filePath} to draft for ${input.targetPath} (L3 Format preserved)`;
};

const handleSubstitute = async (
  input: Extract<OfficeCliInput, { action: "substitute" }>,
  { sessionID }: ActionContext
): Promise<string> => {
  requireDraftFor(input.filePath, sessionID);
  const data = parseTemplateData(input.data);
  const { replaced, format } = await Draft.substituteInDraft(
    input.filePath,
    sessionID,
    data
  );
  return `Substituted ${replaced} placeholders in ${input.filePath} (${format}, run-preserving)`;
};

const handleVerifyL3 = async (
  input: Extract<OfficeCliInput, { action: "verify-l3" }>
): Promise<string> => {
  const fileA = nodePath.resolve(input.filePath);
  const fileB = nodePath.resolve(input.referencePath);
  if (!existsSync(fileA)) {
    fail(`file not found: ${input.filePath}`);
  }
  if (!existsSync(fileB)) {
    fail(`reference not found: ${input.referencePath}`);
  }
  const { verifyL3 } = await import("@/core/format/verify-l3");
  const result = await verifyL3(fileA, fileB);
  return result.pass
    ? `L3 PASS: ${input.filePath} vs ${input.referencePath} — only text nodes differ (${result.textDiffs} diffs, ${result.checkedFiles} files checked)`
    : `L3 FAIL: ${input.filePath} vs ${input.referencePath} — Format differs\n${result.details}`;
};

type ActionHandler = (
  input: OfficeCliInput,
  actionContext: ActionContext
) => string | Promise<string>;

const actionHandlers: Record<OfficeCliInput["action"], ActionHandler> = {
  accept: (input, actionContext) =>
    handleAccept(
      input as Extract<OfficeCliInput, { action: "accept" }>,
      actionContext
    ),
  annotate: (input, actionContext) =>
    handleAnnotate(
      input as Extract<OfficeCliInput, { action: "annotate" }>,
      actionContext
    ),
  approve: (input, actionContext) =>
    handleApprove(
      input as Extract<OfficeCliInput, { action: "approve" }>,
      actionContext
    ),
  clone: (input, actionContext) =>
    handleClone(
      input as Extract<OfficeCliInput, { action: "clone" }>,
      actionContext
    ),
  comment: (input, actionContext) =>
    handleComment(
      input as Extract<OfficeCliInput, { action: "comment" }>,
      actionContext
    ),
  create: (input, actionContext) =>
    handleCreate(
      input as Extract<OfficeCliInput, { action: "create" }>,
      actionContext
    ),
  "delete-comment": (input, actionContext) =>
    handleCommentLifecycle(
      input as Extract<OfficeCliInput, { action: "delete-comment" }>,
      actionContext
    ),
  "deny-comment": (input, actionContext) =>
    handleCommentLifecycle(
      input as Extract<OfficeCliInput, { action: "deny-comment" }>,
      actionContext
    ),
  diff: (input, actionContext) =>
    handleDiff(
      input as Extract<OfficeCliInput, { action: "diff" }>,
      actionContext
    ),
  edit: (input, actionContext) =>
    handleEdit(
      input as Extract<OfficeCliInput, { action: "edit" }>,
      actionContext
    ),
  "edit-comment": (input, actionContext) =>
    handleCommentLifecycle(
      input as Extract<OfficeCliInput, { action: "edit-comment" }>,
      actionContext
    ),
  export: (input, actionContext) =>
    handleExport(
      input as Extract<OfficeCliInput, { action: "export" }>,
      actionContext
    ),
  "force-release": (input, actionContext) =>
    handleForceRelease(
      input as Extract<OfficeCliInput, { action: "force-release" }>,
      actionContext
    ),
  generate: (input, actionContext) =>
    handleGenerate(
      input as Extract<OfficeCliInput, { action: "generate" }>,
      actionContext
    ),
  history: (input) =>
    handleHistory(input as Extract<OfficeCliInput, { action: "history" }>),
  list: (input) =>
    handleList(input as Extract<OfficeCliInput, { action: "list" }>),
  "list-comments": (input, actionContext) =>
    handleListComments(
      input as Extract<OfficeCliInput, { action: "list-comments" }>,
      actionContext
    ),
  "lock-status": (input) =>
    handleLockStatus(
      input as Extract<OfficeCliInput, { action: "lock-status" }>
    ),
  metadata: (input, actionContext) =>
    handleMetadata(
      input as Extract<OfficeCliInput, { action: "metadata" }>,
      actionContext
    ),
  preview: (input, actionContext) =>
    handlePreview(
      input as Extract<OfficeCliInput, { action: "preview" }>,
      actionContext
    ),
  read: (input, actionContext) =>
    handleRead(
      input as Extract<OfficeCliInput, { action: "read" }>,
      actionContext
    ),
  "resolve-comment": (input, actionContext) =>
    handleCommentLifecycle(
      input as Extract<OfficeCliInput, { action: "resolve-comment" }>,
      actionContext
    ),
  revert: (input, actionContext) =>
    handleRevert(
      input as Extract<OfficeCliInput, { action: "revert" }>,
      actionContext
    ),
  review: (input, actionContext) =>
    handleReview(
      input as Extract<OfficeCliInput, { action: "review" }>,
      actionContext
    ),
  substitute: (input, actionContext) =>
    handleSubstitute(
      input as Extract<OfficeCliInput, { action: "substitute" }>,
      actionContext
    ),
  "track-delete": (input, actionContext) =>
    handleTrackChange(
      input as Extract<OfficeCliInput, { action: "track-delete" }>,
      actionContext
    ),
  "track-insert": (input, actionContext) =>
    handleTrackChange(
      input as Extract<OfficeCliInput, { action: "track-insert" }>,
      actionContext
    ),
  undo: (input, actionContext) =>
    handleUndo(
      input as Extract<OfficeCliInput, { action: "undo" }>,
      actionContext
    ),
  validate: (input, actionContext) =>
    handleValidate(
      input as Extract<OfficeCliInput, { action: "validate" }>,
      actionContext
    ),
  "verify-l3": (input) =>
    handleVerifyL3(input as Extract<OfficeCliInput, { action: "verify-l3" }>),
  watermark: (input, actionContext) =>
    handleWatermark(
      input as Extract<OfficeCliInput, { action: "watermark" }>,
      actionContext
    ),
};

export const runAction = async (
  input: OfficeCliInput,
  context: Tool.Context
): Promise<string> => {
  const actionContext: ActionContext = {
    context,
    owner: context.agent,
    sessionID: context.sessionID,
  };
  const handler = actionHandlers[input.action];
  if (handler) {
    return await handler(input, actionContext);
  }
  return fail(`action ${input.action} not implemented`);
};
