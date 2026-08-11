import { extname } from "path"

export type Format = "pdf" | "docx" | "xlsx" | "pptx" | "image" | "text"

export function detectFormat(absolutePath: string): Format {
  const ext = extname(absolutePath).toLowerCase()

  if (ext === ".pdf") return "pdf"
  if (ext === ".docx") return "docx"
  if (ext === ".xlsx") return "xlsx"
  if (ext === ".pptx") return "pptx"
  if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff"].includes(ext)) return "image"
  return "text"
}
