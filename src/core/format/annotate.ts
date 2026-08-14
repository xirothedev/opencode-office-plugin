import sharp from "sharp"
import { writeFileSync } from "fs"
import type { AnnotationOp } from "@/core/draft/sidecar"
import { escapeXml } from "@/core/format/ooxml/parts"

export const STAMP_PALETTE = ["DRAFT", "APPROVED", "CONFIDENTIAL"]

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
