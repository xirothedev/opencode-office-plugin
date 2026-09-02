import { describe, it, expect } from "vitest"
import { rmSync } from "fs"
import { officecliTool } from "@/plugin/tools/officecli"
import { runTool, setupHermeticDirs } from "./harness"
import { acquireLock, releaseLock } from "@/core/draft/lock"
import { createDraft, getDraftPath } from "@/core/draft/manager"
import { getFilePathHash } from "@/core/storage/paths"

describe("officecli accept single-path guard", () => {
  const testFile = "/tmp/accept-guard-test.docx"
  setupHermeticDirs()

  it("fails with 'draft not found for <path>' when the draft is orphaned", async () => {
    const hash = getFilePathHash(testFile)
    acquireLock(hash, "test-session", "test-agent")
    createDraft(testFile, "test-session", "orphan me")
    rmSync(getDraftPath(hash, "test-session", ".docx"))

    await expect(runTool(officecliTool, { action: "accept", filePath: testFile })).rejects.toThrow(
      `draft not found for ${testFile}`,
    )
    releaseLock(hash)
  })

  it("fails without a lock as before", async () => {
    await expect(runTool(officecliTool, { action: "accept", filePath: testFile })).rejects.toThrow(
      "no active draft to accept",
    )
  })
})
