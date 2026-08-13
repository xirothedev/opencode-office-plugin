import { readFileSync } from "fs"
import { detectFormat } from "./detect"
import { extractTextFromPDF } from "./backends/pdf"
import { extractTextFromImage } from "./backends/image"
import { extractTextFromOffice } from "./backends/office"

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
