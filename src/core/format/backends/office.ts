import { toMarkdown } from "@firecrawl/anydoc"
import { exec } from "child_process"
import { promisify } from "util"
import { writeFileSync, unlinkSync } from "fs"
import { sanitizeXmlText } from "@/core/format/sanitize"

const execAsync = promisify(exec)

export async function extractTextFromOffice(absolutePath: string): Promise<string> {
  return await toMarkdown(absolutePath)
}

export async function writeOfficeFromMarkdown(markdown: string, outputPath: string): Promise<void> {
  markdown = sanitizeXmlText(markdown)
  const tempPath = `${outputPath}.tmp.md`
  writeFileSync(tempPath, markdown)
  try {
    await execAsync(`pandoc "${tempPath}" -o "${outputPath}"`)
  } finally {
    unlinkSync(tempPath)
  }
}
