import { writeFileSync } from "node:fs";

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
} from "docx";
import type { INumberingOptions, IStylesOptions } from "docx";

import { sanitizeXmlText } from "@/core/format/sanitize";

// ponytail: v2 styled defaults — A4, 1" margins, header shading, DXA dual widths, bullet numbering. Boring markdown still works.
// ponytail: sanitizeXmlText strips C0 controls (\x03 etc.) that would make Word refuse to open (ECMA-376 forbids them in <w:t>)

const pushBreakSeparated = (
  runs: TextRun[],
  text: string,
  makeRun: (s: string) => TextRun
): void => {
  const lines = text.split("\n");
  for (const [idx, s] of lines.entries()) {
    if (s) {
      runs.push(makeRun(s));
    }
    if (idx < lines.length - 1) {
      runs.push(new TextRun({ break: 1 }));
    }
  }
};

const pushBoldSegment = (runs: TextRun[], part: string): boolean => {
  if (!(part.startsWith("**") && part.endsWith("**") && part.length >= 4)) {
    return false;
  }
  const inner = part.slice(2, -2).split("\n");
  for (const [idx, s] of inner.entries()) {
    if (s) {
      runs.push(new TextRun({ bold: true, size: 22, text: s }));
    }
    if (idx < inner.length - 1) {
      runs.push(new TextRun({ break: 1 }));
    }
  }
  return true;
};

const pushItalicSegment = (runs: TextRun[], part: string): boolean => {
  if (
    !(
      part.startsWith("*") &&
      part.endsWith("*") &&
      part.length >= 2 &&
      !part.startsWith("**")
    )
  ) {
    return false;
  }
  runs.push(new TextRun({ italics: true, size: 22, text: part.slice(1, -1) }));
  return true;
};

const pushPlainSegment = (
  runs: TextRun[],
  part: string,
  forceBold?: boolean
): void => {
  // plain (may contain lone *italic* inside) — handle *...* inside
  const sub = part.split(/(?<italic>\*[^*]+\*)/gu);
  for (const seg of sub) {
    if (!seg) {
      continue;
    }
    if (seg.startsWith("*") && seg.endsWith("*") && seg.length >= 2) {
      runs.push(
        new TextRun({ italics: true, size: 22, text: seg.slice(1, -1) })
      );
    } else {
      pushBreakSeparated(
        runs,
        seg,
        (s) => new TextRun({ bold: forceBold, size: 22, text: s })
      );
    }
  }
};

// ponytail: minimal inline md → TextRun[]: **bold**, *italic*, \-* unescape, <br> → break
const inlineRuns = (text: string, forceBold?: boolean): TextRun[] => {
  const cleaned = text
    .replaceAll(/<br\s*\/?>/giu, "\n")
    .replaceAll(/\\(?<escaped>[-+*\\])/gu, "$<escaped>");
  const parts = cleaned.split(/(?<bold>\*\*.*?\*\*)/gu);
  const runs: TextRun[] = [];
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (pushBoldSegment(runs, part)) {
      continue;
    }
    // *italic* whole-segment (avoid **)
    if (pushItalicSegment(runs, part)) {
      continue;
    }
    pushPlainSegment(runs, part, forceBold);
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ size: 22, text: cleaned.replaceAll("**", "") }));
  }
  return runs;
};

const pushHeading = (
  children: (Paragraph | Table)[],
  line: string
): boolean => {
  if (line.startsWith("# ")) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            bold: true,
            color: "1F4E79",
            size: 32,
            text: line.slice(2),
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 160 },
      })
    );
    return true;
  }
  if (line.startsWith("## ")) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            bold: true,
            color: "2E75B6",
            size: 26,
            text: line.slice(3),
          }),
        ],
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 120 },
      })
    );
    return true;
  }
  if (line.startsWith("### ")) {
    children.push(
      new Paragraph({
        children: [new TextRun({ bold: true, size: 22, text: line.slice(4) })],
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 80 },
      })
    );
    return true;
  }
  return false;
};

const pushBullet = (children: (Paragraph | Table)[], line: string): boolean => {
  // Bullet list (- or * ) — also handles escaped \- \* from anydoc
  if (!/^\s*\\?[-*]\s+/u.test(line)) {
    return false;
  }
  const norm = line.replace(/^\s*\\?[-*]\s+/u, "");
  children.push(
    new Paragraph({
      children: inlineRuns(norm),
      numbering: { level: 0, reference: "bullet" },
    })
  );
  return true;
};

const pushTable = (
  children: (Paragraph | Table)[],
  lines: string[],
  start: number
): number => {
  let i = start;
  const tableRows: TableRow[] = [];
  let colCount = 0;
  const rawRows: string[][] = [];
  while (i < lines.length && (lines[i]?.trim().startsWith("|") ?? false)) {
    const rowLine = (lines[i] ?? "").trim();
    if (/^\|[\s\-:|]+\|$/u.test(rowLine)) {
      i += 1;
      continue;
    }
    const cells = rowLine
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    colCount = Math.max(colCount, cells.length);
    rawRows.push(cells);
    i += 1;
  }
  // DXA: A4 usable width ~ 6720 DXA (8.27" - 2" margins) *1440 - approximate  6720? use  9000/cols? Use  2400 per col capped
  // For simplicity, total table width  9000 DXA (approx 6.25"), column widths equal
  const totalWidth = 9000;
  const colWidth = Math.floor(totalWidth / Math.max(colCount, 1));
  const columnWidths = Array.from({ length: colCount }, () => colWidth);
  for (const [rowIdx, cells] of rawRows.entries()) {
    const isHeader = rowIdx === 0;
    const row = new TableRow({
      children: cells.map((cell) => {
        const runs = inlineRuns(cell, isHeader);
        // ponytail: <br> in anydoc table cell → inlineRuns already emits break runs
        return new TableCell({
          borders: {
            bottom: { color: "B4C6E7", size: 4, style: BorderStyle.SINGLE },
            left: { color: "B4C6E7", size: 4, style: BorderStyle.SINGLE },
            right: { color: "B4C6E7", size: 4, style: BorderStyle.SINGLE },
            top: { color: "B4C6E7", size: 4, style: BorderStyle.SINGLE },
          },
          children: [
            new Paragraph({
              alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
              children: runs,
            }),
          ],
          shading: isHeader
            ? { color: "auto", fill: "D9E1F2", type: ShadingType.CLEAR }
            : undefined,
          width: { size: colWidth, type: WidthType.DXA },
        });
      }),
      tableHeader: isHeader,
    });
    tableRows.push(row);
  }
  if (tableRows.length > 0) {
    children.push(
      new Table({
        borders: {
          bottom: { color: "B4C6E7", size: 4, style: BorderStyle.SINGLE },
          insideHorizontal: {
            color: "B4C6E7",
            size: 4,
            style: BorderStyle.SINGLE,
          },
          insideVertical: {
            color: "B4C6E7",
            size: 4,
            style: BorderStyle.SINGLE,
          },
          left: { color: "B4C6E7", size: 4, style: BorderStyle.SINGLE },
          right: { color: "B4C6E7", size: 4, style: BorderStyle.SINGLE },
          top: { color: "B4C6E7", size: 4, style: BorderStyle.SINGLE },
        },
        columnWidths,
        rows: tableRows,
        width: { size: totalWidth, type: WidthType.DXA },
      })
    );
  }
  return i;
};

const pushParagraph = (children: (Paragraph | Table)[], line: string): void => {
  // Paragraph — inline **bold**/*italic* + unescape
  const cleaned = line.replaceAll(/\\(?<escaped>[-+*\\])/gu, "$<escaped>");
  children.push(
    new Paragraph({ children: inlineRuns(cleaned), spacing: { after: 80 } })
  );
};

export const writeDocxFromMarkdown = async (
  markdownInput: string,
  outputPath: string
): Promise<void> => {
  const markdown = sanitizeXmlText(markdownInput);
  const lines = markdown.split("\n");
  const children: (Paragraph | Table)[] = [];

  let i = 0;
  // numbering id for bullets
  const bulletNumbering: INumberingOptions = {
    config: [
      {
        levels: [
          {
            alignment: AlignmentType.LEFT,
            format: "bullet",
            level: 0,
            style: { paragraph: { indent: { hanging: 260, left: 360 } } },
            text: "\u2022",
          },
        ],
        reference: "bullet",
      },
    ],
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Heading
    if (pushHeading(children, line)) {
      i += 1;
    } else if (pushBullet(children, line)) {
      i += 1;
    } else if (line.trim().startsWith("|")) {
      i = pushTable(children, lines, i);
    } else if (line.trim().length > 0) {
      pushParagraph(children, line);
      i += 1;
    } else {
      i += 1;
    }
  }

  const defaultStyles: IStylesOptions = {
    default: {
      document: {
        paragraph: { spacing: { line: 276 } },
        run: { font: "Calibri", size: 22 },
      },
    },
  };
  const doc = new Document({
    numbering: bulletNumbering,
    sections: [
      {
        children,
        properties: {
          page: {
            margin: { bottom: 1440, left: 1440, right: 1440, top: 1440 },
            // A4
            size: { height: 16_838, width: 11_906 },
          },
        },
      },
    ],
    styles: defaultStyles,
  });
  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outputPath, buffer);
};
