import { toMarkdownBytes } from "@firecrawl/anydoc"
import { readFileSync } from "fs"
import sharp from "sharp"
import { extname } from "path"

export async function extractTextFromImage(absolutePath: string): Promise<string> {
  const buffer = readFileSync(absolutePath)
  return await toMarkdownBytes(buffer, undefined as any)
}

export async function writeImageFromMarkdown(markdown: string, outputPath: string): Promise<void> {
  const lines = markdown.split("\n").filter((l) => l.trim().length > 0)

  // Calculate dimensions
  const padding = 40
  const lineHeight = 28
  const width = 800
  const height = padding * 2 + lines.length * lineHeight + 20

  // Build SVG with text
  const textElements = lines
    .map((line, idx) => {
      const y = padding + idx * lineHeight + 20
      const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      return `<text x="${padding}" y="${y}" font-family="monospace" font-size="16" fill="black">${escaped}</text>`
    })
    .join("\n")

  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="white"/>
  ${textElements}
</svg>
`

  const ext = extname(outputPath).toLowerCase()
  const format = ext === ".jpg" || ext === ".jpeg" ? "jpeg" : "png"

  await sharp(Buffer.from(svg)).toFormat(format).toFile(outputPath)
}
