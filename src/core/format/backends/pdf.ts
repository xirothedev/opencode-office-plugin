import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

import { toMarkdown } from "@firecrawl/anydoc";
import type { ConvertOptions } from "@firecrawl/anydoc";
import { classifyPdfAsync } from "@firecrawl/pdf-inspector";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { sanitizeXmlText } from "@/core/format/sanitize";
import {
  getFirecrawlApiKey,
  getFirecrawlApiUrl,
  getPdfEngine,
} from "@/core/options";

import { runCommand } from "../exec";

const extractViaPdfjs = async (buffer: Buffer): Promise<string> => {
  await classifyPdfAsync(buffer).catch(() => null);
  const data = new Uint8Array(buffer);
  const pdf = await getDocument({ data }).promise;
  const pageNums = Array.from({ length: pdf.numPages }, (_, idx) => idx + 1);
  const texts = await Promise.all(
    pageNums.map((n) =>
      pdf.getPage(n).then(async (page) => {
        const content = await page.getTextContent();
        return content.items
          .map((item) => ("str" in item ? String(item.str) : ""))
          .join(" ");
      })
    )
  );
  return texts
    .map((t) => `${t}\n\n`)
    .join("")
    .trim();
};

export const extractTextFromPDF = async (
  absolutePath: string,
  opts?: ConvertOptions
): Promise<string> => {
  const buffer = readFileSync(absolutePath);
  // ponytail: anydoc is primary for PDF — knows needsOcr/hosted, pdfjs is fallback for text PDFs only
  const apiKey = opts?.apiKey ?? getFirecrawlApiKey();
  const apiUrl = opts?.apiUrl ?? getFirecrawlApiUrl();
  const anydocOpts: ConvertOptions | undefined =
    opts || apiKey || apiUrl
      ? {
          ...opts,
          ...(apiKey ? { apiKey } : {}),
          ...(apiUrl ? { apiUrl } : {}),
        }
      : undefined;
  try {
    const converted = await toMarkdown(
      absolutePath,
      anydocOpts as ConvertOptions
    );
    return converted.trim();
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === "hosted") {
      throw error;
    }
    // ponytail: anydoc's pdf heuristic false-positives on tiny text PDFs — try pdfjs before surfacing needsOcr
    if (code === "needsOcr") {
      const fallback = await extractViaPdfjs(buffer);
      if (fallback.trim().length > 0) {
        return fallback;
      }
      // blank PDFs (no image, no text) are not scanned — return empty instead of throwing
      const hasImage = buffer.includes(new TextEncoder().encode("/Image"));
      if (!hasImage) {
        return fallback;
      }
      throw error;
    }
    // fallback to pdfjs for text-based PDFs when anydoc unsupported/malformed
    return extractViaPdfjs(buffer);
  }
};

// ponytail: v2 styled defaults — A4, heading colors, table shading via weasyprint CSS. Falls back to plain if css missing.
const PDF_CSS = `@page{size:A4;margin:2cm}body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#222}h1{font-size:20pt;color:#1F4E79;border-bottom:2pt solid #2E75B6;padding-bottom:6pt;margin-top:18pt}h2{font-size:14pt;color:#2E75B6;margin-top:14pt}h3{font-size:12pt;color:#333;margin-top:10pt}table{width:100%;border-collapse:collapse;margin:12pt 0;font-size:9pt}th{background-color:#D9E1F2;color:#1F4E79;font-weight:bold;text-align:center;border:0.5pt solid #B4C6E7;padding:6pt}td{border:0.5pt solid #B4C6E7;padding:6pt;text-align:left}tr:nth-child(even) td{background-color:#F2F6FD}p{margin:6pt 0}ul,ol{margin-left:18pt}`;

export const writePdfFromMarkdown = async (
  markdownInput: string,
  outputPath: string
): Promise<void> => {
  const markdown = sanitizeXmlText(markdownInput);
  const tempPath = `${outputPath}.tmp.md`;
  const cssPath = `${outputPath}.tmp.css`;
  writeFileSync(tempPath, markdown);
  writeFileSync(cssPath, PDF_CSS);
  const engine = getPdfEngine();
  try {
    // ponytail: weasyprint respects --css, xelatex ignores it — harmless, no branch needed
    await runCommand(
      `pandoc "${tempPath}" --pdf-engine=${engine} --css="${cssPath}" -o "${outputPath}"`
    );
  } catch (error) {
    // fallback without css if engine doesn't support it (e.g. xelatex without weasyprint css)
    try {
      await runCommand(
        `pandoc "${tempPath}" --pdf-engine=${engine} -o "${outputPath}"`
      );
    } catch (fallbackError) {
      throw new Error(
        `pandoc PDF conversion failed: ${(error as Error).message}`,
        { cause: fallbackError }
      );
    }
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // temp cleanup best-effort
    }
    try {
      unlinkSync(cssPath);
    } catch {
      // temp cleanup best-effort
    }
  }
};
