import { mkdirSync } from "node:fs";
import path from "node:path";

import { writeDocxFromMarkdown } from "@/core/format/backends/docx";
import { writeOfficeFromMarkdown } from "@/core/format/backends/office";
import { writePdfFromMarkdown } from "@/core/format/backends/pdf";
import { writeXlsxFromMarkdown } from "@/core/format/backends/xlsx";

export const EXPORT_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".pptx"];

export const assertExportPaths = (
  sourcePath: string,
  targetPath: string
): void => {
  const sourceExt = path.extname(sourcePath).toLowerCase();
  if (!EXPORT_EXTENSIONS.includes(sourceExt)) {
    throw new Error(
      `export source format not supported: ${sourceExt} (supported: pdf, docx, xlsx, pptx)`
    );
  }
  const targetExt = path.extname(targetPath).toLowerCase();
  if (!EXPORT_EXTENSIONS.includes(targetExt)) {
    throw new Error(
      `export target format not supported: ${targetExt} (supported: pdf, docx, xlsx, pptx)`
    );
  }
  if (path.resolve(targetPath) === path.resolve(sourcePath)) {
    throw new Error("targetPath must differ from filePath");
  }
};

export const writeDerivedFile = async (
  markdown: string,
  targetPath: string
): Promise<void> => {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const ext = path.extname(targetPath).toLowerCase();
  if (ext === ".pdf") {
    await writePdfFromMarkdown(markdown, targetPath);
    return;
  }
  if (ext === ".docx") {
    await writeDocxFromMarkdown(markdown, targetPath);
    return;
  }
  if (ext === ".xlsx") {
    await writeXlsxFromMarkdown(markdown, targetPath);
    return;
  }
  if (ext === ".pptx") {
    await writeOfficeFromMarkdown(markdown, targetPath);
    return;
  }
  throw new Error(
    `export target format not supported: ${ext} (supported: pdf, docx, xlsx, pptx)`
  );
};
