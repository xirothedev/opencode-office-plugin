import { beforeEach, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";

import { configureOptions } from "@/core/options";
import {
  getDraftsDir,
  getHistoryDir,
  getLocksDir,
  getRegistryDir,
  getSidecarsDir,
} from "@/core/storage/paths";
import type { editTool } from "@/plugin/tools/edit";
import type { officecliTool } from "@/plugin/tools/officecli";

export type AnyTool = typeof officecliTool | typeof editTool;
export type ToolArgs = Record<string, unknown>;

export const mockContext = {
  agent: "test-agent",
  id: "test-call",
  messageID: "test-message",
  progress: () => Effect.void,
  sessionID: "test-session",
};

export const runTool = (
  tool: AnyTool,
  args: ToolArgs,
  ctx = mockContext
): Promise<string> => {
  let decoded: unknown;
  try {
    decoded = Schema.decodeUnknownSync(
      (tool as { input: unknown }).input as never
    )(args as never);
  } catch (error) {
    // ponytail: rejected promise (not sync throw) so rejects-style assertions see a rejection, matching the original async function
    return Promise.reject(
      new Tool.Error({
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
  return Effect.runPromise(tool.execute(decoded as never, ctx as never)).then(
    (result) => result.output as string
  );
};

export const setupHermeticDirs = (): void => {
  const dir = path.join(
    tmpdir(),
    `openoffice-test-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  configureOptions({ dataDir: dir });
  beforeEach(async () => {
    await mkdir(getDraftsDir(), { recursive: true });
    await mkdir(getHistoryDir(), { recursive: true });
    await mkdir(getLocksDir(), { recursive: true });
    await mkdir(getRegistryDir(), { recursive: true });
    await mkdir(getSidecarsDir(), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });
};

export const cleanupTestFile = (filePath: string): void => {
  afterEach(async () => {
    if (existsSync(filePath)) {
      await rm(filePath, { force: true });
    }
  });
};
