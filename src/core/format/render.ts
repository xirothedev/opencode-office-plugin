import { exec } from "child_process"
import { promisify } from "util"
import { mkdirSync } from "fs"
import { dirname } from "path"

const execAsync = promisify(exec)

export async function renderMarkdownFileToHtml(markdownPath: string, outputPath: string): Promise<void> {
  mkdirSync(dirname(outputPath), { recursive: true })
  try {
    await execAsync(`pandoc "${markdownPath}" -o "${outputPath}"`)
  } catch (error) {
    throw new Error(`pandoc preview failed: ${(error as Error).message}`)
  }
}
