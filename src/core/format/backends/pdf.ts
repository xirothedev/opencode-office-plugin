import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { classifyPdfAsync } from "@firecrawl/pdf-inspector"
import { toMarkdown, type ConvertOptions } from "@firecrawl/anydoc"
import { readFileSync, writeFileSync, unlinkSync } from "fs"
import { exec } from "child_process"
import { promisify } from "util"
import { getFirecrawlApiKey, getFirecrawlApiUrl, getPdfEngine } from "@/core/options"
import { sanitizeXmlText } from "@/core/format/sanitize"

const execAsync = promisify(exec)

export async function extractTextFromPDF(
  absolutePath: string,
  opts?: ConvertOptions,
): Promise<string> {
  const buffer = readFileSync(absolutePath)
  // ponytail: anydoc is primary for PDF — knows needsOcr/hosted, pdfjs is fallback for text PDFs only
  const apiKey = opts?.apiKey ?? getFirecrawlApiKey()
  const apiUrl = opts?.apiUrl ?? getFirecrawlApiUrl()
  const anydocOpts: ConvertOptions | undefined =
    opts || apiKey || apiUrl
      ? { ...(opts ?? {}), ...(apiKey ? { apiKey } : {}), ...(apiUrl ? { apiUrl } : {}) }
      : undefined
  try {
    return (await toMarkdown(absolutePath, anydocOpts as ConvertOptions)).trim()
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code
    if (code === "hosted") throw error
    // ponytail: anydoc's pdf heuristic false-positives on tiny text PDFs — try pdfjs before surfacing needsOcr
    if (code === "needsOcr") {
      const fallback = await extractViaPdfjs(buffer)
      if (fallback.trim().length > 0) return fallback
      // blank PDFs (no image, no text) are not scanned — return empty instead of throwing
      const hasImage = buffer.includes(Buffer.from("/Image"))
      if (!hasImage) return fallback
      throw error
    }
    // fallback to pdfjs for text-based PDFs when anydoc unsupported/malformed
    return extractViaPdfjs(buffer)
  }
}

async function extractViaPdfjs(buffer: Buffer): Promise<string> {
  await classifyPdfAsync(buffer).catch(() => null)
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

// ponytail: v2 styled defaults — A4, heading colors, table shading via weasyprint CSS. Falls back to plain if css missing.
const PDF_CSS = `@page{size:A4;margin:2cm}body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#222}h1{font-size:20pt;color:#1F4E79;border-bottom:2pt solid #2E75B6;padding-bottom:6pt;margin-top:18pt}h2{font-size:14pt;color:#2E75B6;margin-top:14pt}h3{font-size:12pt;color:#333;margin-top:10pt}table{width:100%;border-collapse:collapse;margin:12pt 0;font-size:9pt}th{background-color:#D9E1F2;color:#1F4E79;font-weight:bold;text-align:center;border:0.5pt solid #B4C6E7;padding:6pt}td{border:0.5pt solid #B4C6E7;padding:6pt;text-align:left}tr:nth-child(even) td{background-color:#F2F6FD}p{margin:6pt 0}ul,ol{margin-left:18pt}`

export async function writePdfFromMarkdown(markdown: string, outputPath: string): Promise<void> {
  markdown = sanitizeXmlText(markdown)
  const tempPath = `${outputPath}.tmp.md`
  const cssPath = `${outputPath}.tmp.css`
  writeFileSync(tempPath, markdown)
  writeFileSync(cssPath, PDF_CSS)
  const engine = getPdfEngine()
  try {
    // ponytail: weasyprint respects --css, xelatex ignores it — harmless, no branch needed
    await execAsync(`pandoc "${tempPath}" --pdf-engine=${engine} --css="${cssPath}" -o "${outputPath}"`)
  } catch (error) {
    // fallback without css if engine doesn't support it (e.g. xelatex without weasyprint css)
    try {
      await execAsync(`pandoc "${tempPath}" --pdf-engine=${engine} -o "${outputPath}"`)
    } catch (e2) {
      throw new Error(`pandoc PDF conversion failed: ${(error as Error).message}`)
    }
  } finally {
    try { unlinkSync(tempPath) } catch {}
    try { unlinkSync(cssPath) } catch {}
  }
}
