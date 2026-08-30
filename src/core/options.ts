import { homedir } from "os"
import { join } from "path"
import { mkdirSync } from "fs"

export interface PluginOptions {
  pdfEngine?: string
  staleLockHours?: number
  dataDir?: string
  firecrawlApiKey?: string
  firecrawlApiUrl?: string
}

const DEFAULTS = {
  pdfEngine: "xelatex",
  staleLockHours: 24,
  dataDir: join(homedir(), ".local", "share", "opencode", "plugins", "openoffice"),
  firecrawlApiKey: undefined as string | undefined,
  firecrawlApiUrl: undefined as string | undefined,
}

let current: Required<PluginOptions> = { ...DEFAULTS } as Required<PluginOptions>
let pdfEngineConfigured = false

export function configureOptions(options: PluginOptions): void {
  if (options.pdfEngine !== undefined) {
    current.pdfEngine = options.pdfEngine
    pdfEngineConfigured = true
  }
  if (options.staleLockHours !== undefined) {
    current.staleLockHours = options.staleLockHours
  }
  if (options.dataDir !== undefined) {
    current.dataDir = options.dataDir
  }
  if (options.firecrawlApiKey !== undefined) {
    current.firecrawlApiKey = options.firecrawlApiKey
  }
  if (options.firecrawlApiUrl !== undefined) {
    current.firecrawlApiUrl = options.firecrawlApiUrl
  }
  ensureDataDirs()
}

function ensureDataDirs(): void {
  for (const sub of ["drafts", "locks", "history", "registry", "sidecars"]) {
    mkdirSync(join(current.dataDir, sub), { recursive: true })
  }
}

export function getPluginDataDir(): string {
  return current.dataDir
}

export function getStaleThresholdMs(): number {
  return current.staleLockHours * 60 * 60 * 1000
}

export function getPdfEngine(): string {
  return pdfEngineConfigured ? current.pdfEngine : (process.env.OFFICECLI_PDF_ENGINE ?? DEFAULTS.pdfEngine)
}

export function getFirecrawlApiKey(): string | undefined {
  return current.firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY
}

export function getFirecrawlApiUrl(): string | undefined {
  return current.firecrawlApiUrl ?? process.env.FIRECRAWL_API_URL
}
