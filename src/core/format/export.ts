import { mkdirSync } from "fs"
import { dirname, extname } from "path"
import { writeOfficeFromMarkdown } from "@/core/format/backends/office"
import { writePdfFromMarkdown } from "@/core/format/backends/pdf"
import { writeXlsxFromMarkdown } from "@/core/format/backends/xlsx"
import { writeDocxFromMarkdown } from "@/core/format/backends/docx"

export const EXPORT_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".pptx"]

export async function writeDerivedFile(markdown: string, targetPath: string): Promise<void> {
  mkdirSync(dirname(targetPath), { recursive: true })
  const ext = extname(targetPath).toLowerCase()
  if (ext === ".pdf") {
    await writePdfFromMarkdown(markdown, targetPath)
    return
  }
  if (ext === ".docx") {
    await writeDocxFromMarkdown(markdown, targetPath)
    return
  }
  if (ext === ".xlsx") {
    await writeXlsxFromMarkdown(markdown, targetPath)
    return
  }
  if (ext === ".pptx") {
    await writeOfficeFromMarkdown(markdown, targetPath)
    return
  }
  throw new Error(`export target format not supported: ${ext} (supported: pdf, docx, xlsx, pptx)`)
}
