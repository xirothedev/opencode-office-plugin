import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { copyFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import * as Draft from "@/core/draft";
import { readSidecar } from "@/core/draft/sidecar";
import { getSidecarsDir, getFilePathHash } from "@/core/storage/paths";

const FIXTURE_DOCX = path.join(process.cwd(), "test/fixtures/sample.docx");

describe("Draft sidecar setters", () => {
  const file = "/tmp/sidecar-setters-test.docx";
  const session = "s1";
  const read = () => readSidecar(getFilePathHash(file), session);

  beforeEach(async () => {
    await mkdir(getSidecarsDir(), { recursive: true });
    copyFileSync(FIXTURE_DOCX, file);
  });

  afterEach(async () => {
    await rm(getSidecarsDir(), { force: true, recursive: true });
    await rm(file, { force: true });
  });

  it("setSidecarMetadata sets, overrides, and clears", () => {
    Draft.setSidecarMetadata(file, session, { title: "Pending" });
    expect(read()?.metadata?.title).toBe("Pending");
    Draft.setSidecarMetadata(file, session, { title: "Renamed" });
    expect(read()?.metadata?.title).toBe("Renamed");
    Draft.setSidecarMetadata(file, session, null);
    expect(read()?.metadata).toBeUndefined();
  });

  it("setSidecarWatermark replaces, then null removes", () => {
    Draft.setSidecarWatermark(file, session, {
      position: "top-center",
      text: "DRAFT",
    });
    expect(read()?.watermark?.text).toBe("DRAFT");
    Draft.setSidecarWatermark(file, session, {
      position: "bottom-center",
      text: "APPROVED",
    });
    expect(read()?.watermark?.text).toBe("APPROVED");
    Draft.setSidecarWatermark(file, session, null);
    expect(read()?.watermark).toBeUndefined();
  });

  it("appendSidecarAnnotations accumulates, empty array clears all", () => {
    Draft.appendSidecarAnnotations(file, session, [
      { position: { x: 0.1, y: 0.1 }, text: "a", type: "note" },
    ]);
    Draft.appendSidecarAnnotations(file, session, [
      { position: { x: 0.2, y: 0.2 }, text: "b", type: "note" },
    ]);
    expect(read()?.annotations).toHaveLength(2);
    Draft.appendSidecarAnnotations(file, session, []);
    expect(read()?.annotations).toBeUndefined();
  });

  it("setters keep other keys across calls", () => {
    Draft.setSidecarWatermark(file, session, {
      position: "top-center",
      text: "X",
    });
    Draft.setSidecarMetadata(file, session, { title: "T" });
    Draft.setSidecarWatermark(file, session, null);
    const sc = read();
    expect(sc?.watermark).toBeUndefined();
    expect(sc?.metadata?.title).toBe("T");
  });

  it("effectiveMetadata = file properties overridden by pending sidecar", async () => {
    await Draft.effectiveMetadata(file, session);
    Draft.setSidecarMetadata(file, session, { title: "PENDING-OVERRIDE" });
    const merged = await Draft.effectiveMetadata(file, session);
    expect(merged.title).toBe("PENDING-OVERRIDE");
    Draft.setSidecarMetadata(file, session, null);
    const reverted = await Draft.effectiveMetadata(file, session);
    expect(reverted.title).not.toBe("PENDING-OVERRIDE");
  });
});
