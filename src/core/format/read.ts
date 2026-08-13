import { readFileSync } from "fs"
import { detectFormat } from "@/core/format/detect"
import { extractTextFromPDF } from "@/core/format/backends/pdf"
import { extractTextFromImage } from "@/core/format/backends/image"
import { extractTextFromOffice } from "@/core/format/backends/office"

export async function readRealFileAsMarkdown(filePath: string): Promise<string> {
  const format = detectFormat(filePath)
  if (format === "pdf") {
    return await extractTextFromPDF(filePath)
  }
  if (format === "docx" || format === "xlsx" || format === "pptx") {
    return await extractTextFromOffice(filePath)
  }
  if (format === "image") {
    return await extractTextFromImage(filePath)
  }
  return readFileSync(filePath, "utf-8")
}
