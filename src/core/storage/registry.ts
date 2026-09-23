import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";

import { getRegistryDir, getFilePathHash } from "@/core/storage/paths";

interface RegistryEntry {
  absolutePath: string;
}

export const registerDraft = (absolutePath: string): void => {
  const filePathHash = getFilePathHash(absolutePath);
  const registryPath = path.join(getRegistryDir(), `${filePathHash}.json`);
  mkdirSync(path.dirname(registryPath), { recursive: true });
  writeFileSync(
    registryPath,
    JSON.stringify({ absolutePath } satisfies RegistryEntry)
  );
};

export const unregisterDraft = (filePathHash: string): void => {
  const registryPath = path.join(getRegistryDir(), `${filePathHash}.json`);
  if (existsSync(registryPath)) {
    unlinkSync(registryPath);
  }
};

export const getRegisteredPath = (filePathHash: string): string | null => {
  const registryPath = path.join(getRegistryDir(), `${filePathHash}.json`);
  if (!existsSync(registryPath)) {
    return null;
  }
  const entry = JSON.parse(
    readFileSync(registryPath, "utf-8")
  ) as RegistryEntry;
  return entry.absolutePath;
};
