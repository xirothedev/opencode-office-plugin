import { getRegistryDir, getFilePathHash } from "./paths.js"
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs"
import { join, dirname } from "path"

interface RegistryEntry {
  absolutePath: string
}

export function registerDraft(absolutePath: string): void {
  const filePathHash = getFilePathHash(absolutePath)
  const registryPath = join(getRegistryDir(), `${filePathHash}.json`)
  mkdirSync(dirname(registryPath), { recursive: true })
  writeFileSync(registryPath, JSON.stringify({ absolutePath } satisfies RegistryEntry))
}

export function unregisterDraft(filePathHash: string): void {
  const registryPath = join(getRegistryDir(), `${filePathHash}.json`)
  if (existsSync(registryPath)) {
    unlinkSync(registryPath)
  }
}

export function getRegisteredPath(filePathHash: string): string | null {
  const registryPath = join(getRegistryDir(), `${filePathHash}.json`)
  if (!existsSync(registryPath)) {
    return null
  }
  const entry = JSON.parse(readFileSync(registryPath, "utf-8")) as RegistryEntry
  return entry.absolutePath
}
