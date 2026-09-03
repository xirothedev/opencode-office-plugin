import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, rm } from "fs/promises"
import { copyFileSync } from "fs"
import { join } from "path"
import { getSidecarsDir, getFilePathHash } from "@/core/storage/paths"
import { readSidecar } from "@/core/draft/sidecar"
import * as Draft from "@/core/draft"

const FIXTURE_DOCX = join(process.cwd(), "test/fixtures/sample.docx")

describe("Draft sidecar setters", () => {
  const file = "/tmp/sidecar-setters-test.docx"
  const session = "s1"
  const read = () => readSidecar(getFilePathHash(file), session)

  beforeEach(async () => {
    await mkdir(getSidecarsDir(), { recursive: true })
    copyFileSync(FIXTURE_DOCX, file)
  })

  afterEach(async () => {
    await rm(getSidecarsDir(), { recursive: true, force: true })
    await rm(file, { force: true })
  })

  it("setSidecarMetadata sets, overrides, and clears", () => {
    Draft.setSidecarMetadata(file, session, { title: "Pending" })
    expect(read()?.metadata?.title).toBe("Pending")
    Draft.setSidecarMetadata(file, session, { title: "Renamed" })
    expect(read()?.metadata?.title).toBe("Renamed")
    Draft.setSidecarMetadata(file, session, null)
    expect(read()?.metadata).toBeUndefined()
  })

  it("setSidecarWatermark replaces, then null removes", () => {
    Draft.setSidecarWatermark(file, session, { text: "DRAFT", position: "top-center" })
    expect(read()?.watermark?.text).toBe("DRAFT")
    Draft.setSidecarWatermark(file, session, { text: "APPROVED", position: "bottom-center" })
    expect(read()?.watermark?.text).toBe("APPROVED")
    Draft.setSidecarWatermark(file, session, null)
    expect(read()?.watermark).toBeUndefined()
  })

  it("appendSidecarAnnotations accumulates, empty array clears all", () => {
    Draft.appendSidecarAnnotations(file, session, [{ type: "note", text: "a", position: { x: 0.1, y: 0.1 } }])
    Draft.appendSidecarAnnotations(file, session, [{ type: "note", text: "b", position: { x: 0.2, y: 0.2 } }])
    expect(read()?.annotations).toHaveLength(2)
    Draft.appendSidecarAnnotations(file, session, [])
    expect(read()?.annotations).toBeUndefined()
  })

  it("setters keep other keys across calls", async () => {
    Draft.setSidecarWatermark(file, session, { text: "X", position: "top-center" })
    Draft.setSidecarMetadata(file, session, { title: "T" })
    Draft.setSidecarWatermark(file, session, null)
    const sc = read()
    expect(sc?.watermark).toBeUndefined()
    expect(sc?.metadata?.title).toBe("T")
  })

  it("effectiveMetadata = file properties overridden by pending sidecar", async () => {
    const base = await Draft.effectiveMetadata(file, session)
    Draft.setSidecarMetadata(file, session, { title: "PENDING-OVERRIDE" })
    const merged = await Draft.effectiveMetadata(file, session)
    expect(merged.title).toBe("PENDING-OVERRIDE")
    Draft.setSidecarMetadata(file, session, null)
    const reverted = await Draft.effectiveMetadata(file, session)
    expect(reverted.title).not.toBe("PENDING-OVERRIDE")
  })
})
