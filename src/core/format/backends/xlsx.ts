import ExcelJS from "exceljs"
import { sanitizeXmlText } from "@/core/format/sanitize"

interface TableBlock {
  name: string | undefined
  rows: string[][]
}

// ponytail: v2 styled defaults — header bold, fill D9E1F2, borders, centered, auto-width. Keeps markdown-table → sheet mapping.
// ponytail: sanitizeXmlText strips C0 controls that would make Excel refuse to open (ECMA-376)

export async function writeXlsxFromMarkdown(markdown: string, outputPath: string): Promise<void> {
  markdown = sanitizeXmlText(markdown)
  const workbook = new ExcelJS.Workbook()
  const lines = markdown.split("\n")

  // Split into table blocks; the nearest preceding # heading names each sheet
  const blocks: TableBlock[] = []
  let pendingName: string | undefined
  let current: { name: string | undefined; rows: string[][] } | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith("# ")) {
      if (current && current.rows.length > 0) {
        blocks.push(current)
        current = null
      }
      pendingName = line.slice(2).trim()
      continue
    }
    if (!line.startsWith("|")) {
      if (current && current.rows.length > 0) {
        blocks.push(current)
        current = null
      }
      continue
    }

    if (/^\|[\s\-:|]+\|$/.test(line)) continue

    if (!current) {
      current = { name: pendingName, rows: [] }
      pendingName = undefined
    }
    current.rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim()),
    )
  }
  if (current && current.rows.length > 0) {
    blocks.push(current)
  }

  if (blocks.length === 0) {
    throw new Error("No markdown table found")
  }

  // Backwards compat: single unnamed block keeps "Sheet1"
  const usedNames = new Set<string>()
  blocks.forEach((block, i) => {
    let name = block.name ?? `Sheet${i + 1}`
    while (usedNames.has(name)) {
      name = `${name}_2`
    }
    usedNames.add(name)
    addSheet(workbook, name, block.rows)
  })

  await workbook.xlsx.writeFile(outputPath)
}

function addSheet(workbook: ExcelJS.Workbook, sheetName: string, rows: string[][]): void {
  const worksheet = workbook.addWorksheet(sheetName)

  for (const row of rows) {
    worksheet.addRow(row)
  }

  // v2 styling — header row + borders + auto-width
  const columnCount = Math.max(...rows.map((r) => r.length))
  const headerFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9E1F2" },
  } as any
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFB4C6E7" } },
    bottom: { style: "thin", color: { argb: "FFB4C6E7" } },
    left: { style: "thin", color: { argb: "FFB4C6E7" } },
    right: { style: "thin", color: { argb: "FFB4C6E7" } },
  } as any

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = thinBorder as any
      cell.alignment = { vertical: "middle", horizontal: rowNumber === 1 ? "center" : "left", wrapText: true }
      if (rowNumber === 1) {
        cell.font = { bold: true, color: { argb: "FF1F4E79" }, size: 11 }
        cell.fill = headerFill as any
      } else {
        cell.font = { size: 11 }
        // try numeric
        const v = cell.value as any
        if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v.replace(/,/g, "")))) {
          // keep as string to preserve formatting; no auto-conversion
        }
      }
    })
    row.commit()
  })

  // Auto-fit column widths (approximate) + header filter
  for (let colIdx = 0; colIdx < columnCount; colIdx++) {
    let maxLen = 10
    for (const row of rows) {
      const cellLen = (row[colIdx] || "").length
      if (cellLen > maxLen) maxLen = cellLen
    }
    worksheet.getColumn(colIdx + 1).width = Math.min(maxLen + 4, 50)
  }

  // Freeze header + auto filter
  worksheet.views = [{ state: "frozen", ySplit: 1 } as any]
  if (worksheet.rowCount > 1) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columnCount },
    } as any
  }
}
