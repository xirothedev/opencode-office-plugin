import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  ShadingType,
} from "docx"
import { writeFileSync } from "fs"
import { sanitizeXmlText } from "@/core/format/sanitize"

// ponytail: v2 styled defaults — A4, 1" margins, header shading, DXA dual widths, bullet numbering. Boring markdown still works.
// ponytail: sanitizeXmlText strips C0 controls (\x03 etc.) that would make Word refuse to open (ECMA-376 forbids them in <w:t>)

// ponytail: minimal inline md → TextRun[]: **bold**, *italic*, \-* unescape, <br> → break
function inlineRuns(text: string, forceBold?: boolean): TextRun[] {
  const cleaned = text.replace(/<br\s*\/?>/gi, "\n").replace(/\\([\-+*\\])/g, "$1")
  const parts = cleaned.split(/(\*\*.*?\*\*)/g)
  const runs: TextRun[] = []
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      const inner = part.slice(2, -2).split("\n")
      inner.forEach((s, idx) => {
        if (s) runs.push(new TextRun({ text: s, bold: true, size: 22 }))
        if (idx < inner.length - 1) runs.push(new TextRun({ break: 1 }))
      })
      continue
    }
    // *italic* whole-segment (avoid **)
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2 && !part.startsWith("**")) {
      const inner = part.slice(1, -1)
      runs.push(new TextRun({ text: inner, italics: true, size: 22 }))
      continue
    }
    // plain (may contain lone *italic* inside) — handle *...* inside
    const sub = part.split(/(\*[^*]+\*)/g)
    for (const seg of sub) {
      if (!seg) continue
      if (seg.startsWith("*") && seg.endsWith("*") && seg.length >= 2) {
        runs.push(new TextRun({ text: seg.slice(1, -1), italics: true, size: 22 }))
      } else {
        const lines = seg.split("\n")
        lines.forEach((s, idx) => {
          if (s) runs.push(new TextRun({ text: s, bold: forceBold, size: 22 }))
          if (idx < lines.length - 1) runs.push(new TextRun({ break: 1 }))
        })
      }
    }
  }
  if (runs.length === 0) runs.push(new TextRun({ text: cleaned.replace(/\*\*/g, ""), size: 22 }))
  return runs
}

export async function writeDocxFromMarkdown(markdown: string, outputPath: string): Promise<void> {
  markdown = sanitizeXmlText(markdown)
  const lines = markdown.split("\n")
  const children: any[] = []

  let i = 0
  // numbering id for bullets
  const bulletNumbering = {
    config: [
      {
        reference: "bullet",
        levels: [
          {
            level: 0,
            format: "bullet" as any,
            text: "\u2022",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 260 } } },
          },
        ],
      },
    ],
  } as any

  while (i < lines.length) {
    const line = lines[i]

    // Heading
    if (line.startsWith("# ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: line.slice(2), bold: true, size: 32, color: "1F4E79" })],
          spacing: { after: 160 },
        }),
      )
      i++
    } else if (line.startsWith("## ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: line.slice(3), bold: true, size: 26, color: "2E75B6" })],
          spacing: { after: 120 },
        }),
      )
      i++
    } else if (line.startsWith("### ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: line.slice(4), bold: true, size: 22 })],
          spacing: { after: 80 },
        }),
      )
      i++
    }
    // Bullet list (- or * ) — also handles escaped \- \* from anydoc
    else if (/^\s*\\?[-*]\s+/.test(line)) {
      const norm = line.replace(/^\s*\\?[-*]\s+/, "")
      children.push(
        new Paragraph({
          children: inlineRuns(norm),
          numbering: { reference: "bullet", level: 0 },
        }),
      )
      i++
    }
    // Table
    else if (line.trim().startsWith("|")) {
      const tableRows: TableRow[] = []
      let colCount = 0
      const rawRows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const rowLine = lines[i].trim()
        if (/^\|[\s\-:|]+\|$/.test(rowLine)) {
          i++
          continue
        }
        const cells = rowLine.slice(1, -1).split("|").map((c) => c.trim())
        colCount = Math.max(colCount, cells.length)
        rawRows.push(cells)
        i++
      }
      // DXA: A4 usable width ~ 6720 DXA (8.27" - 2" margins) *1440 - approximate  6720? use  9000/cols? Use  2400 per col capped
      // For simplicity, total table width  9000 DXA (approx 6.25"), column widths equal
      const totalWidth = 9000
      const colWidth = Math.floor(totalWidth / Math.max(colCount, 1))
      const columnWidths = Array(colCount).fill(colWidth)
      rawRows.forEach((cells, rowIdx) => {
        const isHeader = rowIdx === 0
        const row = new TableRow({
          children: cells.map((cell) => {
            const runs = inlineRuns(cell, isHeader)
            // ponytail: <br> in anydoc table cell → inlineRuns already emits break runs
            return new TableCell({
              children: [new Paragraph({ children: runs, alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT })],
              width: { size: colWidth, type: WidthType.DXA },
              shading: isHeader ? { type: ShadingType.CLEAR, color: "auto", fill: "D9E1F2" } : undefined,
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: "B4C6E7" },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: "B4C6E7" },
                left: { style: BorderStyle.SINGLE, size: 4, color: "B4C6E7" },
                right: { style: BorderStyle.SINGLE, size: 4, color: "B4C6E7" },
              },
            })
          }),
          tableHeader: isHeader,
        })
        tableRows.push(row)
      })
      if (tableRows.length > 0) {
        children.push(
          new Table({
            rows: tableRows,
            width: { size: totalWidth, type: WidthType.DXA },
            columnWidths,
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: "B4C6E7" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "B4C6E7" },
              left: { style: BorderStyle.SINGLE, size: 4, color: "B4C6E7" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "B4C6E7" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "B4C6E7" },
              insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "B4C6E7" },
            },
          }),
        )
      }
    }
    // Paragraph — inline **bold**/*italic* + unescape
    else if (line.trim().length > 0) {
      const cleaned = line.replace(/\\([\-+*\\])/g, "$1")
      children.push(new Paragraph({ children: inlineRuns(cleaned), spacing: { after: 80 } }))
      i++
    } else {
      i++
    }
  }

  const doc = new Document({
    numbering: bulletNumbering,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
          paragraph: { spacing: { line: 276 } },
        },
      },
    } as any,
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children,
      },
    ],
  })
  const buffer = await Packer.toBuffer(doc)
  writeFileSync(outputPath, buffer)
}
