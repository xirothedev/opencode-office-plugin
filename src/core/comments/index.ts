// Comment intake module: the only comment surface the plugin layer may import.
// Routes each operation to the DOCX/XLSX/PPTX adapter by file extension and
// sanitizes all text at the seam. The adapters are private to this module.
import path from "node:path";

import {
  writeComment,
  readComments,
  applyCommentSuggestion,
  updateComment,
  deleteComment,
  setCommentStatus,
} from "@/core/format/ooxml/comments";
import type { Comment } from "@/core/format/ooxml/comments";
import type { CommentStatus } from "@/core/format/ooxml/parts";
import {
  writeComment as writePptxComment,
  readComments as readPptxComments,
  applySlideSuggestion,
  updateComment as updatePptxComment,
  deleteComment as deletePptxComment,
  setCommentStatus as setPptxCommentStatus,
} from "@/core/format/ooxml/pptxcomments";
import type { PptxComment } from "@/core/format/ooxml/pptxcomments";
import {
  writeComment as writeXlsxComment,
  readComments as readXlsxComments,
  applyCellSuggestion,
  updateComment as updateXlsxComment,
  deleteComment as deleteXlsxComment,
  setCommentStatus as setXlsxCommentStatus,
} from "@/core/format/ooxml/xlsxcomments";
import type { XlsxComment } from "@/core/format/ooxml/xlsxcomments";
import { sanitizeXmlText } from "@/core/format/sanitize";

export type ApproveResult =
  | "applied"
  | "not-found"
  | "no-suggestion"
  | "denied";
export type AnyComment = Comment | XlsxComment | PptxComment;

export interface NewComment {
  id: string;
  author: string;
  text: string;
  suggestedText?: string | null;
  targetText?: string | null;
  rangeStartParagraph?: number;
  rangeStartOffset?: number;
  rangeEndParagraph?: number;
  rangeEndOffset?: number;
  cellRef?: string;
  slide?: number;
  x?: number;
  y?: number;
}

export interface PreviewComment {
  id: string;
  author: string;
  text: string;
  status: CommentStatus;
  suggestedText?: string | null;
  anchor: string;
  createdAt: number;
}

export const requireFormat = (filePath: string, noun: string): string => {
  const ext = path.extname(filePath);
  if (ext !== ".docx" && ext !== ".xlsx" && ext !== ".pptx") {
    throw new Error(`${noun} only supported for DOCX, XLSX and PPTX files`);
  }
  return ext;
};

export const validate = (filePath: string, input: NewComment): void => {
  const ext = requireFormat(filePath, "comments");
  if (
    ext === ".docx" &&
    (input.rangeStartParagraph === undefined ||
      input.rangeStartOffset === undefined ||
      input.rangeEndParagraph === undefined ||
      input.rangeEndOffset === undefined)
  ) {
    throw new Error(
      "comment on DOCX requires rangeStartParagraph, rangeStartOffset, rangeEndParagraph, rangeEndOffset"
    );
  }
  if (ext === ".xlsx" && !input.cellRef) {
    throw new Error('comment on XLSX requires cellRef (e.g. "B4")');
  }
};

export const add = async (
  filePath: string,
  input: NewComment
): Promise<void> => {
  validate(filePath, input);
  const ext = requireFormat(filePath, "comments");
  const author = sanitizeXmlText(input.author);
  const text = sanitizeXmlText(input.text);
  const suggestedText = input.suggestedText
    ? sanitizeXmlText(input.suggestedText)
    : null;
  if (ext === ".xlsx") {
    await writeXlsxComment(filePath, {
      author,
      cellRef: input.cellRef as string,
      id: input.id,
      parentId: null,
      status: "open",
      suggestedText,
      text,
      timestamp: new Date(),
    });
    return;
  }
  if (ext === ".pptx") {
    await writePptxComment(filePath, {
      author,
      id: input.id,
      parentId: null,
      slide: input.slide ?? 0,
      status: "open",
      suggestedText,
      targetText: input.targetText ? sanitizeXmlText(input.targetText) : null,
      text,
      timestamp: new Date(),
      x: input.x ?? 100_000,
      y: input.y ?? 100_000,
    });
    return;
  }
  await writeComment(filePath, {
    author,
    id: input.id,
    parentId: null,
    rangeEnd: {
      offset: input.rangeEndOffset as number,
      paragraph: input.rangeEndParagraph as number,
    },
    rangeStart: {
      offset: input.rangeStartOffset as number,
      paragraph: input.rangeStartParagraph as number,
    },
    status: "open",
    suggestedText,
    text,
    timestamp: new Date(),
  });
};

const readBy = (ext: string, filePath: string): Promise<AnyComment[]> => {
  if (ext === ".xlsx") {
    return readXlsxComments(filePath);
  }
  if (ext === ".pptx") {
    return readPptxComments(filePath);
  }
  return readComments(filePath);
};

export const applySuggestion = async (
  filePath: string,
  commentId: string
): Promise<ApproveResult> => {
  const ext = requireFormat(filePath, "suggestions");
  // Deny is final (COMMENT-WORKFLOW.md: content stays untouched) — the adapters store
  // status in per-format shapes, so the refusal lives here where all reads are uniform.
  const existing = await readBy(ext, filePath);
  if (existing.some((c) => c.id === commentId && c.status === "denied")) {
    return "denied";
  }
  if (ext === ".xlsx") {
    return applyCellSuggestion(filePath, commentId);
  }
  if (ext === ".pptx") {
    return applySlideSuggestion(filePath, commentId);
  }
  return applyCommentSuggestion(filePath, commentId);
};

export const update = (
  filePath: string,
  commentId: string,
  changes: { text?: string; suggestedText?: string }
): Promise<"updated" | "not-found"> => {
  const ext = requireFormat(filePath, "comment lifecycle actions");
  const text = changes.text ? sanitizeXmlText(changes.text) : undefined;
  const suggestedText = changes.suggestedText
    ? sanitizeXmlText(changes.suggestedText)
    : undefined;
  if (ext === ".xlsx") {
    return updateXlsxComment(filePath, commentId, { suggestedText, text });
  }
  if (ext === ".pptx") {
    return updatePptxComment(filePath, commentId, { suggestedText, text });
  }
  return updateComment(filePath, commentId, { suggestedText, text });
};

export const remove = (
  filePath: string,
  commentId: string
): Promise<"deleted" | "not-found"> => {
  const ext = requireFormat(filePath, "comment lifecycle actions");
  if (ext === ".xlsx") {
    return deleteXlsxComment(filePath, commentId);
  }
  if (ext === ".pptx") {
    return deletePptxComment(filePath, commentId);
  }
  return deleteComment(filePath, commentId);
};

export const setStatus = (
  filePath: string,
  commentId: string,
  status: CommentStatus
): Promise<"ok" | "not-found"> => {
  const ext = requireFormat(filePath, "comment lifecycle actions");
  if (ext === ".xlsx") {
    return setXlsxCommentStatus(filePath, commentId, status);
  }
  if (ext === ".pptx") {
    return setPptxCommentStatus(filePath, commentId, status);
  }
  return setCommentStatus(filePath, commentId, status);
};

export const list = (filePath: string): Promise<AnyComment[]> => {
  const ext = requireFormat(filePath, "comments");
  return readBy(ext, filePath);
};

interface PreviewCommon {
  id: string;
  author: string;
  text: string;
  status: CommentStatus;
  suggestedText?: string | null;
  timestamp: Date;
}

const previewCommon = (
  c: PreviewCommon
): {
  id: string;
  author: string;
  text: string;
  status: CommentStatus;
  suggestedText?: string;
  createdAt: number;
} => ({
  author: c.author,
  createdAt: c.timestamp.getTime(),
  id: c.id,
  status: c.status,
  suggestedText: c.suggestedText ?? undefined,
  text: c.text,
});

export const preview = async (filePath: string): Promise<PreviewComment[]> => {
  const ext = path.extname(filePath);
  if (ext === ".xlsx") {
    const comments = await readXlsxComments(filePath);
    return comments.map((c) => ({ ...previewCommon(c), anchor: c.cellRef }));
  }
  if (ext === ".pptx") {
    const comments = await readPptxComments(filePath);
    return comments.map((c) => ({
      ...previewCommon(c),
      anchor: `${c.slide}:${c.x}:${c.y}`,
    }));
  }
  if (ext === ".docx") {
    const comments = await readComments(filePath);
    return comments.map((c) => ({
      ...previewCommon(c),
      anchor: `${c.rangeStart.paragraph}:${c.rangeStart.offset}`,
    }));
  }
  return [];
};
