import { readFileSync, writeFileSync } from "node:fs";

import JSZip from "jszip";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

import type { WatermarkConfig, WatermarkPosition } from "@/core/draft/sidecar";
import { detectFormat } from "@/core/format/detect";
import {
  addRelationship,
  ensureContentType,
  escapeXml,
} from "@/core/format/ooxml/parts";

const HEADER_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
const FOOTER_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";
const HEADER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
const FOOTER_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";

const loadAndSavePdf = async (
  absolutePath: string,
  mutate: (doc: PDFDocument) => Promise<void>
): Promise<void> => {
  const doc = await PDFDocument.load(readFileSync(absolutePath));
  await mutate(doc);
  writeFileSync(absolutePath, await doc.save());
};

const applyPdfWatermark = (
  absolutePath: string,
  config: WatermarkConfig
): Promise<void> =>
  loadAndSavePdf(absolutePath, async (doc) => {
    const pages = doc.getPages();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const size = Math.max(6, Math.min(200, config.size ?? 48));
    const opacity = Math.max(0.05, Math.min(1, config.opacity ?? 0.3));
    const rotation = config.position === "diagonal-center" ? -45 : 0;
    for (const page of pages) {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(config.text, size);
      const x = (width - textWidth) / 2;
      let y = height / 2;
      if (config.position === "top-center") {
        y = height - size * 2;
      } else if (config.position === "bottom-center") {
        y = size * 2;
      }
      page.drawText(config.text, {
        color: rgb(0.35, 0.35, 0.35),
        font,
        opacity,
        rotate: degrees(rotation),
        size,
        x,
        y,
      });
    }
  });

const headerXml = (
  text: string,
  size: number
): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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
`;

const footerXml = (text: string, size: number): string =>
  headerXml(text, size)
    .replace("<w:hdr ", "<w:ftr ")
    .replace("</w:hdr>", "</w:ftr>");

const applyDocxWatermark = async (
  absolutePath: string,
  config: WatermarkConfig
): Promise<void> => {
  if (config.position === "diagonal-center") {
    throw new Error(
      "diagonal-center watermark not supported for DOCX (supported: top-center, bottom-center)"
    );
  }
  const isHeader = config.position !== "bottom-center";
  const partName = isHeader ? "word/header1.xml" : "word/footer1.xml";
  const relType = isHeader ? HEADER_REL_TYPE : FOOTER_REL_TYPE;
  const contentType = isHeader ? HEADER_CONTENT_TYPE : FOOTER_CONTENT_TYPE;

  const zip = await JSZip.loadAsync(readFileSync(absolutePath));
  const rId = await addRelationship(
    zip,
    "word/_rels/document.xml.rels",
    relType,
    isHeader ? "header1.xml" : "footer1.xml"
  );
  const size = Math.max(6, Math.min(200, config.size ?? 48));
  zip.file(
    partName,
    isHeader ? headerXml(config.text, size) : footerXml(config.text, size)
  );
  await ensureContentType(zip, `/${partName}`, contentType);

  const documentPath = "word/document.xml";
  let documentXml = await zip.file(documentPath)?.async("string");
  if (documentXml === undefined) {
    throw new Error("word/document.xml not found in DOCX");
  }
  if (!documentXml.includes("xmlns:r=")) {
    documentXml = documentXml.replace(
      /<w:document(?<attrs>[^>]*)>/u,
      '<w:document$<attrs> xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    );
  }
  const reference = `<w:headerReference w:type="default" r:id="${rId}"/>`;
  const sectPrMatch = documentXml.match(/<w:sectPr[^>]*>/gu);
  if (sectPrMatch && sectPrMatch.length > 0) {
    const lastSectPr = sectPrMatch.at(-1);
    if (lastSectPr === undefined) {
      throw new Error("no sectPr found in DOCX document");
    }
    const index = documentXml.lastIndexOf(lastSectPr);
    if (index === -1) {
      throw new Error("no sectPr found in DOCX document");
    }
    documentXml =
      documentXml.slice(0, index + lastSectPr.length) +
      reference +
      documentXml.slice(index + lastSectPr.length);
  } else {
    throw new Error("no sectPr found in DOCX document");
  }
  zip.file(documentPath, documentXml);
  writeFileSync(absolutePath, await zip.generateAsync({ type: "uint8array" }));
};

export const WATERMARK_EXTENSIONS = [".docx", ".pdf"];

export interface WatermarkRequest {
  text: string;
  position?: string;
  size?: number;
  opacity?: number;
}

// Format policy for the watermark Sidecar write: per-Format defaults and
// rejections live here, not in the tool layer.
export const buildWatermarkConfig = (
  ext: string,
  input: WatermarkRequest
): WatermarkConfig => {
  if (!WATERMARK_EXTENSIONS.includes(ext)) {
    throw new Error("watermark only supported for DOCX and PDF files");
  }
  const defaultPosition: WatermarkPosition =
    ext === ".docx" ? "top-center" : "diagonal-center";
  const position =
    (input.position as WatermarkPosition | undefined) ?? defaultPosition;
  const validPositions: WatermarkPosition[] = [
    "diagonal-center",
    "top-center",
    "bottom-center",
  ];
  if (!validPositions.includes(position)) {
    throw new Error(
      `invalid position "${position}" (supported: diagonal-center, top-center, bottom-center)`
    );
  }
  if (ext === ".docx" && position === "diagonal-center") {
    throw new Error(
      "diagonal-center watermark not supported for DOCX (supported: top-center, bottom-center)"
    );
  }
  if (ext === ".docx" && input.opacity !== undefined) {
    throw new Error(
      "opacity not supported for DOCX watermarks (supported: PDF only)"
    );
  }
  const config: WatermarkConfig = { position, text: input.text };
  if (input.size !== undefined) {
    config.size = input.size;
  }
  if (input.opacity !== undefined) {
    config.opacity = input.opacity;
  }
  return config;
};

export const applyWatermarkToFile = async (
  absolutePath: string,
  config: WatermarkConfig
): Promise<void> => {
  const format = detectFormat(absolutePath);
  if (format === "pdf") {
    await applyPdfWatermark(absolutePath, config);
    return;
  }
  if (format === "docx") {
    await applyDocxWatermark(absolutePath, config);
    return;
  }
  throw new Error("watermark only supported for DOCX and PDF files");
};
