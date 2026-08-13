import { homedir } from "os"
import { join } from "path"
import { createHash } from "crypto"

export function getPluginDataDir(): string {
  return join(homedir(), ".local", "share", "opencode", "plugins", "openoffice")
}

export function getDraftsDir(): string {
  return join(getPluginDataDir(), "drafts")
}

export function getLocksDir(): string {
  return join(getPluginDataDir(), "locks")
}

export function getHistoryDir(): string {
  return join(getPluginDataDir(), "history")
}

export function getRegistryDir(): string {
  return join(getPluginDataDir(), "registry")
}

export function getFilePathHash(absolutePath: string): string {
  return createHash("sha256").update(absolutePath).digest("hex")
}
