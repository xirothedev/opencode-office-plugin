import { toMarkdownBytes } from "@firecrawl/anydoc"
import { readFileSync } from "fs"

export async function extractTextFromImage(absolutePath: string): Promise<string> {
  const buffer = readFileSync(absolutePath)
  return await toMarkdownBytes(buffer, undefined as any)
}
