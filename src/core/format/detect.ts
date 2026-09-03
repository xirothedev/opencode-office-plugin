import { extname } from "path"

export type Format = "pdf" | "docx" | "xlsx" | "pptx" | "image" | "text"

// ponytail: office is the main method for read + handle of office/pdf — single source for guard
export const OFFICE_READ_EXTENSIONS = new Set([
  ".docx",
  ".doc",
  ".dotx",
  ".dotm",
  ".xlsx",
  ".xls",
  ".xlsm",
  ".xlsb",
  ".xltx",
  ".xltm",
  ".pptx",
  ".ppt",
  ".potx",
  ".potm",
  ".ppsx",
  ".pdf",
])
// ponytail: binary guard = office (all variants) + images — edit/write on any of these must go through officecli
export const BINARY_EXTENSIONS = new Set([...OFFICE_READ_EXTENSIONS, ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"])

export function detectFormat(absolutePath: string): Format {
  const ext = extname(absolutePath).toLowerCase()

  if (ext === ".pdf") return "pdf"
  if ([".docx", ".doc", ".dotx", ".dotm"].includes(ext)) return "docx"
  if ([".xlsx", ".xls", ".xlsm", ".xlsb", ".xltx", ".xltm"].includes(ext)) return "xlsx"
  if ([".pptx", ".ppt", ".potx", ".potm", ".ppsx"].includes(ext)) return "pptx"
  if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"].includes(ext)) return "image"
  return "text"
}
