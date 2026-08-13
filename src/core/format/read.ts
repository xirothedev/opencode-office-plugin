import { readFileSync } from "fs"
import { detectFormat } from "./detect.ts"
import { extractTextFromPDF } from "./backends/pdf.ts"
import { extractTextFromImage } from "./backends/image.ts"
import { extractTextFromOffice } from "./backends/office.ts"

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
