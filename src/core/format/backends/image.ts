import { readFileSync } from "node:fs";
import path from "node:path";

import { toMarkdownBytes } from "@firecrawl/anydoc";
import sharp from "sharp";

export const extractTextFromImage = async (
  absolutePath: string
): Promise<string> => {
  const buffer = readFileSync(absolutePath);
  return await toMarkdownBytes(buffer);
};

export const writeImageFromMarkdown = async (
  markdown: string,
  outputPath: string
): Promise<void> => {
  const lines = markdown.split("\n").filter((l) => l.trim().length > 0);

  // Calculate dimensions
  const padding = 40;
  const lineHeight = 28;
  const width = 800;
  const height = padding * 2 + lines.length * lineHeight + 20;

  // Build SVG with text
  const textElements = lines
    .map((line, idx) => {
      const y = padding + idx * lineHeight + 20;
      const escaped = line
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      return `<text x="${padding}" y="${y}" font-family="monospace" font-size="16" fill="black">${escaped}</text>`;
    })
    .join("\n");

  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="white"/>
  ${textElements}
</svg>
`;

  const ext = path.extname(outputPath).toLowerCase();
  const format = ext === ".jpg" || ext === ".jpeg" ? "jpeg" : "png";

  await sharp(new TextEncoder().encode(svg))
    .toFormat(format)
    .toFile(outputPath);
};
