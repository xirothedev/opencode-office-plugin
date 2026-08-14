import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib"
import JSZip from "jszip"
import { readFileSync, writeFileSync } from "fs"
import { detectFormat } from "@/core/format/detect"
import { addRelationship, ensureContentType, escapeXml } from "@/core/format/ooxml/parts"
import type { WatermarkConfig } from "@/core/draft/sidecar"

const HEADER_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
const FOOTER_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"
const HEADER_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"
const FOOTER_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"

function applyPdfWatermark(absolutePath: string, config: WatermarkConfig): Promise<void> {
  return loadAndSavePdf(absolutePath, async (doc) => {
    const pages = doc.getPages()
    const font = await doc.embedFont(StandardFonts.HelveticaBold)
    const size = Math.max(6, Math.min(200, config.size ?? 48))
    const opacity = Math.max(0.05, Math.min(1, config.opacity ?? 0.3))
    const rotation = config.position === "diagonal-center" ? -45 : 0
    for (const page of pages) {
      const { width, height } = page.getSize()
      const textWidth = font.widthOfTextAtSize(config.text, size)
      let x = (width - textWidth) / 2
      let y = height / 2
      if (config.position === "top-center") {
        y = height - size * 2
      } else if (config.position === "bottom-center") {
        y = size * 2
      }
      page.drawText(config.text, {
        x,
        y,
        size,
        font,
        color: rgb(0.35, 0.35, 0.35),
        opacity,
        rotate: degrees(rotation),
      })
    }
  })
}

async function loadAndSavePdf(absolutePath: string, mutate: (doc: import("pdf-lib").PDFDocument) => Promise<void>): Promise<void> {
  const doc = await PDFDocument.load(readFileSync(absolutePath))
  await mutate(doc)
  writeFileSync(absolutePath, await doc.save())
}

function headerXml(text: string, size: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:r>
      <w:rPr>
        <w:sz w:val="${Math.round(size * 2)}"/>
      </w:rPr>
      <w:t>${escapeXml(text)}</w:t>
    </w:r>
  </w:p>
</w:hdr>
`
}

function footerXml(text: string, size: number): string {
  return headerXml(text, size).replace("<w:hdr ", "<w:ftr ").replace("</w:hdr>", "</w:ftr>")
}

async function applyDocxWatermark(absolutePath: string, config: WatermarkConfig): Promise<void> {
  if (config.position === "diagonal-center") {
    throw new Error("diagonal-center watermark not supported for DOCX (supported: top-center, bottom-center)")
  }
  const isHeader = config.position !== "bottom-center"
  const partName = isHeader ? "word/header1.xml" : "word/footer1.xml"
  const relType = isHeader ? HEADER_REL_TYPE : FOOTER_REL_TYPE
  const contentType = isHeader ? HEADER_CONTENT_TYPE : FOOTER_CONTENT_TYPE

  const zip = await JSZip.loadAsync(readFileSync(absolutePath))
  const rId = await addRelationship(zip, "word/_rels/document.xml.rels", relType, isHeader ? "header1.xml" : "footer1.xml")
  const size = Math.max(6, Math.min(200, config.size ?? 48))
  zip.file(partName, isHeader ? headerXml(config.text, size) : footerXml(config.text, size))
  await ensureContentType(zip, `/${partName}`, contentType)

  const documentPath = "word/document.xml"
  let documentXml = await zip.file(documentPath)?.async("string")
  if (documentXml === undefined) {
    throw new Error("word/document.xml not found in DOCX")
  }
  if (!documentXml.includes("xmlns:r=")) {
    documentXml = documentXml.replace(
      /<w:document([^>]*)>/,
      '<w:document$1 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    )
  }
  const reference = `<w:headerReference w:type="default" r:id="${rId}"/>`
  const sectPrMatch = documentXml.match(/<w:sectPr[^>]*>/g)
  if (sectPrMatch && sectPrMatch.length > 0) {
    const lastSectPr = sectPrMatch[sectPrMatch.length - 1]
    const index = documentXml.lastIndexOf(lastSectPr)
    documentXml = documentXml.slice(0, index + lastSectPr.length) + reference + documentXml.slice(index + lastSectPr.length)
  } else {
    throw new Error("no sectPr found in DOCX document")
  }
  zip.file(documentPath, documentXml)
  writeFileSync(absolutePath, await zip.generateAsync({ type: "nodebuffer" }))
}

export async function applyWatermarkToFile(absolutePath: string, config: WatermarkConfig): Promise<void> {
  const format = detectFormat(absolutePath)
  if (format === "pdf") {
    await applyPdfWatermark(absolutePath, config)
    return
  }
  if (format === "docx") {
    await applyDocxWatermark(absolutePath, config)
    return
  }
  throw new Error("watermark only supported for DOCX and PDF files")
}
