import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle } from "docx"
import { writeFileSync } from "fs"

export async function writeDocxFromMarkdown(markdown: string, outputPath: string): Promise<void> {
  const lines = markdown.split("\n")
  const children: any[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Heading
    if (line.startsWith("# ")) {
      children.push(new Paragraph({ text: line.slice(2), heading: "Heading1" }))
      i++
    } else if (line.startsWith("## ")) {
      children.push(new Paragraph({ text: line.slice(3), heading: "Heading2" }))
      i++
    } else if (line.startsWith("### ")) {
      children.push(new Paragraph({ text: line.slice(4), heading: "Heading3" }))
      i++
    }
    // Table
    else if (line.trim().startsWith("|")) {
      const tableRows: TableRow[] = []
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const rowLine = lines[i].trim()
        // Skip separator
        if (/^\|[\s\-:|]+\|$/.test(rowLine)) {
          i++
          continue
        }
        const cells = rowLine.slice(1, -1).split("|").map((c) => c.trim())
        const tableRow = new TableRow({
          children: cells.map(
            (cell) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun(cell)] })],
                width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
              })
          ),
        })
        tableRows.push(tableRow)
        i++
      }
      if (tableRows.length > 0) {
        children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }))
      }
    }
    // Paragraph
    else if (line.trim().length > 0) {
      children.push(new Paragraph({ children: [new TextRun(line)] }))
      i++
    } else {
      i++
    }
  }

  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  writeFileSync(outputPath, buffer)
}
