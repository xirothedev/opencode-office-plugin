import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { runCommand } from "./exec"

export async function renderMarkdownFileToHtml(markdownPath: string, outputPath: string): Promise<void> {
  mkdirSync(dirname(outputPath), { recursive: true })
  try {
    await runCommand(`pandoc "${markdownPath}" -o "${outputPath}"`)
  } catch (error) {
    throw new Error(`pandoc preview failed: ${(error as Error).message}`)
  }
}
