import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { classifyPdfAsync } from "@firecrawl/pdf-inspector"
import { readFileSync, writeFileSync, unlinkSync } from "fs"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export async function extractTextFromPDF(absolutePath: string): Promise<string> {
  const buffer = readFileSync(absolutePath)
  const data = new Uint8Array(buffer)

  // Classify PDF (metadata only, for future OCR routing)
  await classifyPdfAsync(buffer).catch(() => null)

  // Extract text using pdfjs-dist (reliable for text-based PDFs)
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

export async function writePdfFromMarkdown(markdown: string, outputPath: string): Promise<void> {
  const tempPath = `${outputPath}.tmp.md`
  writeFileSync(tempPath, markdown)
  const engine = process.env.OFFICECLI_PDF_ENGINE ?? "xelatex"
  try {
    await execAsync(`pandoc "${tempPath}" --pdf-engine=${engine} -o "${outputPath}"`)
  } catch (error) {
    throw new Error(`pandoc PDF conversion failed: ${(error as Error).message}`)
  } finally {
    unlinkSync(tempPath)
  }
}
