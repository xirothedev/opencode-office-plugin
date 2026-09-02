// Comment intake module: the only comment surface the plugin layer may import.
// Routes each operation to the DOCX/XLSX/PPTX adapter by file extension and
// sanitizes all text at the seam. The adapters are private to this module.
import { extname } from "path"
import {
  writeComment,
  readComments,
  applyCommentSuggestion,
  updateComment,
  deleteComment,
  setCommentStatus,
  type Comment,
} from "@/core/format/ooxml/comments"
import {
  writeComment as writeXlsxComment,
  readComments as readXlsxComments,
  applyCellSuggestion,
  updateComment as updateXlsxComment,
  deleteComment as deleteXlsxComment,
  setCommentStatus as setXlsxCommentStatus,
  type XlsxComment,
} from "@/core/format/ooxml/xlsxcomments"
import {
  writeComment as writePptxComment,
  readComments as readPptxComments,
  applySlideSuggestion,
  updateComment as updatePptxComment,
  deleteComment as deletePptxComment,
  setCommentStatus as setPptxCommentStatus,
  type PptxComment,
} from "@/core/format/ooxml/pptxcomments"
import type { CommentStatus } from "@/core/format/ooxml/parts"
import { sanitizeXmlText } from "@/core/format/sanitize"

export type ApproveResult = "applied" | "not-found" | "no-suggestion"
export type AnyComment = Comment | XlsxComment | PptxComment

export interface NewComment {
  id: string
  author: string
  text: string
  suggestedText?: string | null
  targetText?: string | null
  rangeStartParagraph?: number
  rangeStartOffset?: number
  rangeEndParagraph?: number
  rangeEndOffset?: number
  cellRef?: string
  slide?: number
  x?: number
  y?: number
}

export interface PreviewComment {
  id: string
  author: string
  text: string
  status: CommentStatus
  suggestedText?: string | null
  anchor: string
  createdAt: number
}

export function requireFormat(filePath: string, noun: string): string {
  const ext = extname(filePath)
  if (ext !== ".docx" && ext !== ".xlsx" && ext !== ".pptx") {
    throw new Error(`${noun} only supported for DOCX, XLSX and PPTX files`)
  }
  return ext
}

export function validate(filePath: string, input: NewComment): void {
  const ext = requireFormat(filePath, "comments")
  if (
    ext === ".docx" &&
    (input.rangeStartParagraph === undefined ||
      input.rangeStartOffset === undefined ||
      input.rangeEndParagraph === undefined ||
      input.rangeEndOffset === undefined)
  ) {
    throw new Error(
      "comment on DOCX requires rangeStartParagraph, rangeStartOffset, rangeEndParagraph, rangeEndOffset",
    )
  }
  if (ext === ".xlsx" && !input.cellRef) {
    throw new Error('comment on XLSX requires cellRef (e.g. "B4")')
  }
}

export async function add(filePath: string, input: NewComment): Promise<void> {
  validate(filePath, input)
  const ext = requireFormat(filePath, "comments")
  const author = sanitizeXmlText(input.author)
  const text = sanitizeXmlText(input.text)
  const suggestedText = input.suggestedText ? sanitizeXmlText(input.suggestedText) : null
  if (ext === ".xlsx") {
    await writeXlsxComment(filePath, {
      id: input.id,
      author,
      text,
      timestamp: new Date(),
      cellRef: input.cellRef as string,
      parentId: null,
      status: "open",
      suggestedText,
    })
    return
  }
  if (ext === ".pptx") {
    await writePptxComment(filePath, {
      id: input.id,
      author,
      text,
      timestamp: new Date(),
      slide: input.slide ?? 0,
      x: input.x ?? 100000,
      y: input.y ?? 100000,
      parentId: null,
      status: "open",
      suggestedText,
      targetText: input.targetText ? sanitizeXmlText(input.targetText) : null,
    })
    return
  }
  await writeComment(filePath, {
    id: input.id,
    author,
    text,
    timestamp: new Date(),
    rangeStart: { paragraph: input.rangeStartParagraph as number, offset: input.rangeStartOffset as number },
    rangeEnd: { paragraph: input.rangeEndParagraph as number, offset: input.rangeEndOffset as number },
    parentId: null,
    status: "open",
    suggestedText,
  })
}

export async function applySuggestion(filePath: string, commentId: string): Promise<ApproveResult> {
  const ext = requireFormat(filePath, "suggestions")
  if (ext === ".xlsx") return applyCellSuggestion(filePath, commentId)
  if (ext === ".pptx") return applySlideSuggestion(filePath, commentId)
  return applyCommentSuggestion(filePath, commentId)
}

export async function update(
  filePath: string,
  commentId: string,
  changes: { text?: string; suggestedText?: string },
): Promise<"updated" | "not-found"> {
  const ext = requireFormat(filePath, "comment lifecycle actions")
  const text = changes.text ? sanitizeXmlText(changes.text) : undefined
  const suggestedText = changes.suggestedText ? sanitizeXmlText(changes.suggestedText) : undefined
  if (ext === ".xlsx") return updateXlsxComment(filePath, commentId, { text, suggestedText })
  if (ext === ".pptx") return updatePptxComment(filePath, commentId, { text, suggestedText })
  return updateComment(filePath, commentId, { text, suggestedText })
}

export async function remove(filePath: string, commentId: string): Promise<"deleted" | "not-found"> {
  const ext = requireFormat(filePath, "comment lifecycle actions")
  if (ext === ".xlsx") return deleteXlsxComment(filePath, commentId)
  if (ext === ".pptx") return deletePptxComment(filePath, commentId)
  return deleteComment(filePath, commentId)
}

export async function setStatus(
  filePath: string,
  commentId: string,
  status: CommentStatus,
): Promise<"ok" | "not-found"> {
  const ext = requireFormat(filePath, "comment lifecycle actions")
  if (ext === ".xlsx") return setXlsxCommentStatus(filePath, commentId, status)
  if (ext === ".pptx") return setPptxCommentStatus(filePath, commentId, status)
  return setCommentStatus(filePath, commentId, status)
}

export async function list(filePath: string): Promise<AnyComment[]> {
  const ext = requireFormat(filePath, "comments")
  if (ext === ".xlsx") return readXlsxComments(filePath)
  if (ext === ".pptx") return readPptxComments(filePath)
  return readComments(filePath)
}

export async function preview(filePath: string): Promise<PreviewComment[]> {
  const ext = extname(filePath)
  const common = (c: {
    id: string
    author: string
    text: string
    status: CommentStatus
    suggestedText?: string | null
    timestamp: Date
  }) => ({
    id: c.id,
    author: c.author,
    text: c.text,
    status: c.status,
    suggestedText: c.suggestedText ?? undefined,
    createdAt: c.timestamp.getTime(),
  })
  if (ext === ".xlsx") {
    return (await readXlsxComments(filePath)).map((c) => ({ ...common(c), anchor: c.cellRef }))
  }
  if (ext === ".pptx") {
    return (await readPptxComments(filePath)).map((c) => ({
      ...common(c),
      anchor: `${c.slide}:${c.x}:${c.y}`,
    }))
  }
  if (ext === ".docx") {
    return (await readComments(filePath)).map((c) => ({
      ...common(c),
      anchor: `${c.rangeStart.paragraph}:${c.rangeStart.offset}`,
    }))
  }
  return []
}
