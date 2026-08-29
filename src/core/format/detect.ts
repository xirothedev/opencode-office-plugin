import { extname } from "path"

export type Format = "pdf" | "docx" | "xlsx" | "pptx" | "image" | "text"

export function detectFormat(absolutePath: string): Format {
  const ext = extname(absolutePath).toLowerCase()

  if (ext === ".pdf") return "pdf"
  if ([".docx", ".doc", ".dotx", ".dotm"].includes(ext)) return "docx"
  if ([".xlsx", ".xls", ".xlsm", ".xlsb", ".xltx", ".xltm"].includes(ext)) return "xlsx"
  if ([".pptx", ".ppt", ".potx", ".potm", ".ppsx"].includes(ext)) return "pptx"
  if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"].includes(ext)) return "image"
  return "text"
}
