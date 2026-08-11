import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { readFileSync } from "fs"

export async function extractTextFromPDF(absolutePath: string): Promise<string> {
  const buffer = readFileSync(absolutePath)
  const data = new Uint8Array(buffer)
  const pdf = await getDocument({ data }).promise
  let fullText = ""

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items.map((item: any) => item.str).join(" ")
    fullText += pageText + "\n\n"
  }

  return fullText.trim()
}
