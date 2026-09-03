import sharp from "sharp"
import { writeFileSync } from "fs"
import type { AnnotationOp } from "@/core/draft/sidecar"
import { escapeXml } from "@/core/format/ooxml/parts"

export const STAMP_PALETTE = ["DRAFT", "APPROVED", "CONFIDENTIAL"]

function isFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function isFractionPoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== "object" || value === null) return false
  const point = value as { x?: unknown; y?: unknown }
  return isFraction(point.x) && isFraction(point.y)
}

function isFractionRect(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (typeof value !== "object" || value === null) return false
  const rect = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  return isFraction(rect.x) && isFraction(rect.y) && isFraction(rect.width) && isFraction(rect.height)
}

export const ANNOTATE_EXTENSIONS = [".png", ".jpg", ".jpeg"]

// Parses the annotate action's annotations JSON into Sidecar ops.
// Empty array means "clear all" and is returned as null.
export function parseAnnotationOps(ext: string, annotationsJson: string): AnnotationOp[] | null {
  if (!ANNOTATE_EXTENSIONS.includes(ext)) {
    throw new Error("annotate only supported for PNG and JPG images")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(annotationsJson)
  } catch {
    throw new Error("invalid annotations JSON")
  }
  if (!Array.isArray(parsed)) {
    throw new Error("annotations must be an array")
  }
  if (parsed.length === 0) {
    return null
  }
  const ops: AnnotationOp[] = []
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i] as { type?: unknown; text?: unknown; position?: unknown; rect?: unknown; size?: unknown }
    if (entry.type !== "note" && entry.type !== "highlight" && entry.type !== "stamp") {
      throw new Error(`annotation ${i} has unknown type ${String(entry.type)}`)
    }
    if (entry.type === "note") {
      if (typeof entry.text !== "string" || entry.text === "" || !isFractionPoint(entry.position)) {
        throw new Error(`note ${i} requires text and position {x, y} between 0 and 1`)
      }
      const op: AnnotationOp = { type: "note", text: entry.text, position: entry.position as AnnotationOp["position"] }
      if (typeof entry.size === "number") op.size = entry.size
      ops.push(op)
    } else if (entry.type === "highlight") {
      if (!isFractionRect(entry.rect)) {
        throw new Error(`highlight ${i} requires rect {x, y, width, height} between 0 and 1`)
      }
      ops.push({ type: "highlight", rect: entry.rect as AnnotationOp["rect"] })
    } else {
      if (typeof entry.text !== "string" || !isFractionPoint(entry.position)) {
        throw new Error(`stamp ${i} requires text and position {x, y} between 0 and 1`)
      }
      const stampText = normalizeStampText(entry.text)
      if (!stampText) {
        throw new Error(`stamp ${i} text must be one of: ${STAMP_PALETTE.join(", ")}`)
      }
      const op: AnnotationOp = { type: "stamp", text: stampText, position: entry.position as AnnotationOp["position"] }
      if (typeof entry.size === "number") op.size = entry.size
      ops.push(op)
    }
  }
  return ops
}

export function normalizeStampText(text: string): string | null {
  const upper = text.toUpperCase()
  return STAMP_PALETTE.includes(upper) ? upper : null
}

function buildSvg(annotations: AnnotationOp[], width: number, height: number): string {
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`]
  for (const op of annotations) {
    if (op.type === "highlight" && op.rect) {
      const { x, y, width: w, height: h } = op.rect
      parts.push(
        `<rect x="${x * width}" y="${y * height}" width="${w * width}" height="${h * height}" fill="rgba(255, 255, 0, 0.35)" stroke="rgba(200, 150, 0, 0.9)" stroke-width="2"/>`
      )
    } else if (op.type === "note" && op.position && op.text) {
      const fontSize = op.size ?? 24
      parts.push(
        `<text x="${op.position.x * width}" y="${op.position.y * height}" font-family="sans-serif" font-size="${fontSize}" fill="black" stroke="white" stroke-width="2" paint-order="stroke">${escapeXml(op.text)}</text>`
      )
    } else if (op.type === "stamp" && op.position && op.text) {
      const fontSize = op.size ?? 72
      const cx = op.position.x * width
      const cy = op.position.y * height
      parts.push(
        `<text x="${cx}" y="${cy}" font-family="sans-serif" font-weight="bold" font-size="${fontSize}" fill="rgba(200, 0, 0, 0.55)" stroke="rgba(150, 0, 0, 0.6)" stroke-width="3" paint-order="stroke" text-anchor="middle" dominant-baseline="middle" transform="rotate(-30 ${cx} ${cy})">${escapeXml(op.text)}</text>`
      )
    }
  }
  parts.push("</svg>")
  return parts.join("\n")
}

export async function renderAnnotationsToImage(absolutePath: string, annotations: AnnotationOp[]): Promise<void> {
  const image = sharp(absolutePath)
  const meta = await image.metadata()
  if (!meta.width || !meta.height) {
    throw new Error("could not read image dimensions")
  }
  const svg = buildSvg(annotations, meta.width, meta.height)
  const buffer = await image.composite([{ input: Buffer.from(svg) }]).toBuffer()
  writeFileSync(absolutePath, buffer)
}
