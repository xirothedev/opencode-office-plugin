import ExcelJS from "exceljs"

export async function writeXlsxFromMarkdown(markdown: string, outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const lines = markdown.split("\n")

  // Extract sheet name from first # heading (optional)
  let sheetName = "Sheet1"
  let tableStartIdx = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith("# ")) {
      sheetName = line.slice(2).trim()
    } else if (line.startsWith("|") && tableStartIdx === -1) {
      tableStartIdx = i
    }
  }

  if (tableStartIdx === -1) {
    throw new Error("No markdown table found")
  }

  // Parse table rows
  const rows: string[][] = []
  for (let i = tableStartIdx; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith("|")) break

    // Skip separator row (|---|---|)
    if (/^\|[\s\-:|]+\|$/.test(line)) continue

    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim())
    rows.push(cells)
  }

  if (rows.length === 0) {
    throw new Error("Table has no data rows")
  }

  const worksheet = workbook.addWorksheet(sheetName)

  // Write rows
  for (const row of rows) {
    worksheet.addRow(row)
  }

  // Auto-fit column widths (approximate)
  const columnCount = rows[0].length
  for (let colIdx = 0; colIdx < columnCount; colIdx++) {
    let maxLen = 10
    for (const row of rows) {
      const cellLen = (row[colIdx] || "").length
      if (cellLen > maxLen) maxLen = cellLen
    }
    const column = worksheet.getColumn(colIdx + 1)
    column.width = Math.min(maxLen + 2, 50)
  }

  await workbook.xlsx.writeFile(outputPath)
}
