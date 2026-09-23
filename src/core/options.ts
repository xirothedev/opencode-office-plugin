import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface PluginOptions {
  pdfEngine?: string;
  staleLockHours?: number;
  dataDir?: string;
  firecrawlApiKey?: string;
  firecrawlApiUrl?: string;
}

const DEFAULTS = {
  dataDir: path.join(
    homedir(),
    ".local",
    "share",
    "opencode",
    "plugins",
    "openoffice"
  ),
  firecrawlApiKey: undefined as string | undefined,
  firecrawlApiUrl: undefined as string | undefined,
  pdfEngine: "xelatex",
  staleLockHours: 24,
};

const current: Required<PluginOptions> = {
  ...DEFAULTS,
} as Required<PluginOptions>;
let pdfEngineConfigured = false;

const ensureDataDirs = (): void => {
  for (const sub of ["drafts", "locks", "history", "registry", "sidecars"]) {
    mkdirSync(path.join(current.dataDir, sub), { recursive: true });
  }
};

export const configureOptions = (options: PluginOptions): void => {
  if (options.pdfEngine !== undefined) {
    current.pdfEngine = options.pdfEngine;
    pdfEngineConfigured = true;
  }
  if (options.staleLockHours !== undefined) {
    current.staleLockHours = options.staleLockHours;
  }
  if (options.dataDir !== undefined) {
    current.dataDir = options.dataDir;
  }
  if (options.firecrawlApiKey !== undefined) {
    current.firecrawlApiKey = options.firecrawlApiKey;
  }
  if (options.firecrawlApiUrl !== undefined) {
    current.firecrawlApiUrl = options.firecrawlApiUrl;
  }
  ensureDataDirs();
};

export const getPluginDataDir = (): string => current.dataDir;

export const getStaleThresholdMs = (): number =>
  current.staleLockHours * 60 * 60 * 1000;

export const getPdfEngine = (): string =>
  pdfEngineConfigured
    ? current.pdfEngine
    : (process.env.OFFICECLI_PDF_ENGINE ?? DEFAULTS.pdfEngine);

export const getFirecrawlApiKey = (): string | undefined =>
  current.firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY;

export const getFirecrawlApiUrl = (): string | undefined =>
  current.firecrawlApiUrl ?? process.env.FIRECRAWL_API_URL;
