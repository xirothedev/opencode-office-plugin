import ExcelJS from "exceljs";

import { sanitizeXmlText } from "@/core/format/sanitize";

interface TableBlock {
  name: string | undefined;
  rows: string[][];
}

// ponytail: v2 styled defaults — header bold, fill D9E1F2, borders, centered, auto-width. Keeps markdown-table → sheet mapping.
// ponytail: sanitizeXmlText strips C0 controls that would make Excel refuse to open (ECMA-376)

const addSheet = (
  workbook: ExcelJS.Workbook,
  sheetName: string,
  rows: string[][]
): void => {
  const worksheet = workbook.addWorksheet(sheetName);

  for (const row of rows) {
    worksheet.addRow(row);
  }

  // v2 styling — header row + borders + auto-width
  const columnCount = Math.max(...rows.map((r) => r.length));
  const headerFill = {
    fgColor: { argb: "FFD9E1F2" },
    pattern: "solid",
    type: "pattern",
  } as unknown as ExcelJS.Fill;
  const thinBorder = {
    bottom: { color: { argb: "FFB4C6E7" }, style: "thin" },
    left: { color: { argb: "FFB4C6E7" }, style: "thin" },
    right: { color: { argb: "FFB4C6E7" }, style: "thin" },
    top: { color: { argb: "FFB4C6E7" }, style: "thin" },
  } as unknown as Partial<ExcelJS.Borders>;

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = thinBorder as unknown as ExcelJS.Borders;
      cell.alignment = {
        horizontal: rowNumber === 1 ? "center" : "left",
        vertical: "middle",
        wrapText: true,
      };
      if (rowNumber === 1) {
        cell.font = { bold: true, color: { argb: "FF1F4E79" }, size: 11 };
        cell.fill = headerFill;
      } else {
        cell.font = { size: 11 };
        // try numeric
        const v: unknown = cell.value;
        if (
          typeof v === "string" &&
          v.trim() !== "" &&
          !Number.isNaN(Number(v.replaceAll(",", "")))
        ) {
          // keep as string to preserve formatting; no auto-conversion
        }
      }
    });
    row.commit();
  });

  // Auto-fit column widths (approximate) + header filter
  for (let colIdx = 0; colIdx < columnCount; colIdx += 1) {
    let maxLen = 10;
    for (const row of rows) {
      const cellLen = (row[colIdx] ?? "").length;
      if (cellLen > maxLen) {
        maxLen = cellLen;
      }
    }
    worksheet.getColumn(colIdx + 1).width = Math.min(maxLen + 4, 50);
  }

  // Freeze header + auto filter
  worksheet.views = [
    { state: "frozen", ySplit: 1 } as unknown as ExcelJS.WorksheetView,
  ];
  if (worksheet.rowCount > 1) {
    worksheet.autoFilter = {
      from: { column: 1, row: 1 },
      to: { column: columnCount, row: 1 },
    } as unknown as ExcelJS.AutoFilter;
  }
};

export const writeXlsxFromMarkdown = async (
  markdownInput: string,
  outputPath: string
): Promise<void> => {
  const markdown = sanitizeXmlText(markdownInput);
  const workbook = new ExcelJS.Workbook();
  const lines = markdown.split("\n");

  // Split into table blocks; the nearest preceding # heading names each sheet
  const blocks: TableBlock[] = [];
  let pendingName: string | undefined;
  let current: { name: string | undefined; rows: string[][] } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("# ")) {
      if (current && current.rows.length > 0) {
        blocks.push(current);
        current = null;
      }
      pendingName = line.slice(2).trim();
      continue;
    }
    if (!line.startsWith("|")) {
      if (current && current.rows.length > 0) {
        blocks.push(current);
        current = null;
      }
      continue;
    }

    if (/^\|[\s\-:|]+\|$/u.test(line)) {
      continue;
    }

    if (!current) {
      current = { name: pendingName, rows: [] };
      pendingName = undefined;
    }
    current.rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim())
    );
  }
  if (current && current.rows.length > 0) {
    blocks.push(current);
  }

  if (blocks.length === 0) {
    throw new Error("No markdown table found");
  }

  // Backwards compat: single unnamed block keeps "Sheet1"
  const usedNames = new Set<string>();
  for (const [i, block] of blocks.entries()) {
    let name = block.name ?? `Sheet${i + 1}`;
    while (usedNames.has(name)) {
      name = `${name}_2`;
    }
    usedNames.add(name);
    addSheet(workbook, name, block.rows);
  }

  await workbook.xlsx.writeFile(outputPath);
};
