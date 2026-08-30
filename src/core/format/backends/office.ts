import { toMarkdown, type ConvertOptions } from "@firecrawl/anydoc"
import { exec } from "child_process"
import { promisify } from "util"
import { writeFileSync, unlinkSync } from "fs"
import { sanitizeXmlText } from "@/core/format/sanitize"
import { getFirecrawlApiKey, getFirecrawlApiUrl } from "@/core/options"

const execAsync = promisify(exec)

export async function extractTextFromOffice(
  absolutePath: string,
  opts?: ConvertOptions,
): Promise<string> {
  const apiKey = opts?.apiKey ?? getFirecrawlApiKey()
  const apiUrl = opts?.apiUrl ?? getFirecrawlApiUrl()
  const anydocOpts: ConvertOptions | undefined =
    opts || apiKey || apiUrl
      ? { ...(opts ?? {}), ...(apiKey ? { apiKey } : {}), ...(apiUrl ? { apiUrl } : {}) }
      : undefined
  return await toMarkdown(absolutePath, anydocOpts as ConvertOptions)
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
