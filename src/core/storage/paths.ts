import { join } from "path"
import { createHash } from "crypto"
import { getPluginDataDir } from "@/core/options"

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

export function getSidecarsDir(): string {
  return join(getPluginDataDir(), "sidecars")
}

export function getCapturesDir(): string {
  return join(getPluginDataDir(), ".capture")
}

export function getFilePathHash(absolutePath: string): string {
  return createHash("sha256").update(absolutePath).digest("hex")
}
