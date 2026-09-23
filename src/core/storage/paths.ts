import { createHash } from "node:crypto";
import path from "node:path";

import { getPluginDataDir } from "@/core/options";

export const getDraftsDir = (): string =>
  path.join(getPluginDataDir(), "drafts");

export const getLocksDir = (): string => path.join(getPluginDataDir(), "locks");

export const getHistoryDir = (): string =>
  path.join(getPluginDataDir(), "history");

export const getRegistryDir = (): string =>
  path.join(getPluginDataDir(), "registry");

export const getSidecarsDir = (): string =>
  path.join(getPluginDataDir(), "sidecars");

export const getCapturesDir = (): string =>
  path.join(getPluginDataDir(), ".capture");

export const getFilePathHash = (absolutePath: string): string =>
  createHash("sha256").update(absolutePath).digest("hex");
