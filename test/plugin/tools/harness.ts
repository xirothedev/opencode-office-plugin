import { Effect, Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import type { officecliTool } from "@/plugin/tools/officecli"
import type { editTool } from "@/plugin/tools/edit"
import { beforeEach, afterEach } from "vitest"
import { mkdir, rm } from "fs/promises"
import { existsSync } from "fs"
import { getDraftsDir, getHistoryDir, getLocksDir, getRegistryDir, getSidecarsDir } from "@/core/storage/paths"
import { configureOptions } from "@/core/options"
import { tmpdir } from "os"
import { join } from "path"

export type AnyTool = typeof officecliTool | typeof editTool
export type ToolArgs = Record<string, unknown>

export const mockContext = {
  agent: "test-agent",
  sessionID: "test-session",
  messageID: "test-message",
  id: "test-call",
  progress: () => Effect.void,
}

export async function runTool(tool: AnyTool, args: ToolArgs, ctx = mockContext): Promise<string> {
  let decoded: unknown
  try {
    decoded = Schema.decodeUnknownSync((tool as { input: unknown }).input as never)(args as never)
  } catch (error) {
    throw new Tool.Error({
      message: error instanceof Error ? error.message : String(error),
    })
  }
  return Effect.runPromise(tool.execute(decoded as never, ctx as never)).then((result) => result.output as string)
}

export function setupHermeticDirs(): void {
  const dir = join(tmpdir(), `openoffice-test-${process.pid}-${Math.random().toString(36).slice(2)}`)
  configureOptions({ dataDir: dir })
  beforeEach(async () => {
    await mkdir(getDraftsDir(), { recursive: true })
    await mkdir(getHistoryDir(), { recursive: true })
    await mkdir(getLocksDir(), { recursive: true })
    await mkdir(getRegistryDir(), { recursive: true })
    await mkdir(getSidecarsDir(), { recursive: true })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
}

export function cleanupTestFile(filePath: string): void {
  afterEach(async () => {
    if (existsSync(filePath)) await rm(filePath, { force: true })
  })
}
