import ExcelJS from "exceljs"

interface TableBlock {
  name: string | undefined
  rows: string[][]
}

export async function writeXlsxFromMarkdown(markdown: string, outputPath: string): Promise<void> {
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

  // Auto-fit column widths (approximate)
  const columnCount = Math.max(...rows.map((r) => r.length))
  for (let colIdx = 0; colIdx < columnCount; colIdx++) {
    let maxLen = 10
    for (const row of rows) {
      const cellLen = (row[colIdx] || "").length
      if (cellLen > maxLen) maxLen = cellLen
    }
    worksheet.getColumn(colIdx + 1).width = Math.min(maxLen + 2, 50)
  }
}
