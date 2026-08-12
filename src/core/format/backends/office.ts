import { toMarkdown } from "@firecrawl/anydoc"
import { exec } from "child_process"
import { promisify } from "util"
import { writeFileSync, unlinkSync } from "fs"

const execAsync = promisify(exec)

export async function extractTextFromOffice(absolutePath: string): Promise<string> {
  return await toMarkdown(absolutePath)
}

export async function writeOfficeFromMarkdown(markdown: string, outputPath: string): Promise<void> {
  const tempPath = `${outputPath}.tmp.md`
  writeFileSync(tempPath, markdown)
  try {
    await execAsync(`pandoc "${tempPath}" -o "${outputPath}"`)
  } finally {
    unlinkSync(tempPath)
  }
}
