import { readFileSync } from "fs"
import { execSync } from "child_process"
import { platform } from "os"
import { detectFormat } from "@/core/format/detect"
import { extractTextFromPDF } from "@/core/format/backends/pdf"
import { extractTextFromImage } from "@/core/format/backends/image"
import { extractTextFromOffice } from "@/core/format/backends/office"
import { sanitizeXmlText } from "@/core/format/sanitize"
import { getFirecrawlApiKey, getFirecrawlApiUrl } from "@/core/options"

// ponytail: explicit opt-in — no auto upload, caller must pass ocr: 'hosted'
export interface ReadOptions {
  ocr?: boolean | "hosted" | "reject"
  apiKey?: string
  apiUrl?: string
}

function normalizeOcrOptions(opts?: ReadOptions): { ocr?: "hosted" | "reject"; apiKey?: string; apiUrl?: string } | undefined {
  if (!opts) return undefined
  const ocr = opts.ocr === true ? "hosted" : opts.ocr === false ? "reject" : opts.ocr
  const apiKey = opts.apiKey ?? getFirecrawlApiKey()
  const apiUrl = opts.apiUrl ?? getFirecrawlApiUrl()
  const out: { ocr?: "hosted" | "reject"; apiKey?: string; apiUrl?: string } = {}
  if (ocr) out.ocr = ocr
  if (apiKey) out.apiKey = apiKey
  if (apiUrl) out.apiUrl = apiUrl
  return Object.keys(out).length ? out : undefined
}

export async function readRealFileAsMarkdown(filePath: string, opts?: ReadOptions): Promise<string> {
  const format = detectFormat(filePath)
  const anydocOpts = normalizeOcrOptions(opts)
  if (format === "pdf") {
    return sanitizeXmlText(await extractTextFromPDF(filePath, anydocOpts))
  }
  if (format === "docx" || format === "xlsx" || format === "pptx") {
    return sanitizeXmlText(await extractTextFromOffice(filePath, anydocOpts))
  }
  if (format === "image") {
    return sanitizeXmlText(await extractTextFromImage(filePath))
  }
  return sanitizeXmlText(readFileSync(filePath, "utf-8"))
}

// ponytail: live read best-effort via stdlib only, file fallback when Word not running — Office.js bridge if cross-platform matters
export async function readLiveOrFileAsMarkdown(filePath: string, live: boolean, opts?: ReadOptions): Promise<string> {
  if (!live) return readRealFileAsMarkdown(filePath, opts)
  const liveText = tryReadLiveDocument(filePath)
  if (liveText !== undefined) return sanitizeXmlText(liveText)
  return readRealFileAsMarkdown(filePath, opts)
}

function tryReadLiveDocument(filePath: string): string | undefined {
  try {
    if (platform() === "darwin") return readViaAppleScript(filePath)
    if (platform() === "win32") return readViaCom(filePath)
  } catch {
    return undefined
  }
  return undefined
}

function execTrim(cmd: string): string | undefined {
  const out = execSync(cmd, { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] })
  const trimmed = out.trim()
  if (!trimmed || trimmed === "missing value") return undefined
  return trimmed
}

function readViaAppleScript(filePath: string): string | undefined {
  // ponytail: one osascript — match full name when filePath is open, else missing value → fallback to file
  const script = `tell application "Microsoft Word" to try
return content of text object of document 1 whose full name is POSIX file "${filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
on error
return missing value
end try`
  return execTrim(`osascript -e '${script.replace(/'/g, `'"'"'`)}'`)
}

function readViaCom(filePath: string): string | undefined {
  // ponytail: one powershell — match FullName when open, else fallback
  const safe = filePath.replace(/'/g, "''")
  const ps = `$w=[Runtime.InteropServices.Marshal]::GetActiveComObject('Word.Application'); $d=$w.Documents | Where-Object { $_.FullName -eq '${safe}' }; if ($d) { Write-Output $d.Content.Text } else { Write-Output 'missing value' }`
  return execTrim(`powershell -NoProfile -Command "${ps.replace(/"/g, '`"')}"`)
}
