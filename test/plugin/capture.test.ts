import { describe, it, expect, beforeEach } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { configureOptions } from "@/core/options";
import { capture, captureQuiet } from "@/plugin/capture";

const captureFiles = (dir: string): string[] =>
  readdirSync(dir).filter((f) => f.endsWith(".json"));

const readCapture = (dir: string): Record<string, unknown> => {
  const files = captureFiles(dir);
  expect(files).toHaveLength(1);
  return JSON.parse(readFileSync(path.join(dir, files[0]), "utf-8"));
};

describe("capture", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "capture-test-"));
    configureOptions({ dataDir: path.join(dir, "data") });
    dir = path.join(dir, "data", ".capture");
  });

  it("writes one JSON Capture per successful invoke with input, output, error, ms, ts, source", async () => {
    const result = await capture(
      "agent",
      "read",
      { action: "read", filePath: "/tmp/a.docx" },
      () => "markdown out"
    );
    expect(result).toBe("markdown out");
    const rec = readCapture(dir);
    expect(rec.label).toBe("read");
    expect(rec.source).toBe("agent");
    expect(rec.args).toEqual({ action: "read", filePath: "/tmp/a.docx" });
    expect(rec.output).toBe("markdown out");
    expect(rec.error).toBeNull();
    expect(typeof rec.ms).toBe("number");
    expect(typeof rec.ts).toBe("string");
    expect(existsSync(path.join(dir, ".gitignore"))).toBe(true);
  });

  it("rethrows the invoke error and records it in the Capture", async () => {
    await expect(
      capture("host", "read", { action: "read" }, () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const rec = readCapture(dir);
    expect(rec.error).toBe("boom");
    expect(rec.output).toBeNull();
    expect(rec.source).toBe("host");
  });

  it("truncates args and output above 4 KB with a truncatedBytes count", async () => {
    const big = "x".repeat(5000);
    await capture("agent", "read", { action: "read", data: big }, () => big);
    const serialized = JSON.stringify(readCapture(dir));
    expect(serialized).not.toContain(big);
    expect((readCapture(dir).output as string).length).toBeLessThanOrEqual(
      4096
    );
    expect(readCapture(dir).truncatedBytes).toBeGreaterThan(0);
  });

  it("sweeps the captures dir to the newest 200 files", async () => {
    await Promise.all(
      Array.from({ length: 205 }, (_, i) =>
        capture("agent", `read-${i}`, {}, () => "ok")
      )
    );
    expect(captureFiles(dir).length).toBe(200);
  });

  it("never fails the invoke when the captures dir is unwritable", async () => {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o500);
    try {
      await expect(capture("agent", "read", {}, () => "ok")).resolves.toBe(
        "ok"
      );
      expect(() =>
        captureQuiet("agent", "read", {}, new Error("boom"))
      ).not.toThrow();
      expect(captureFiles(dir)).toHaveLength(0);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it("never fails the invoke when args cannot be serialized", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(capture("agent", "read", circular, () => "ok")).resolves.toBe(
      "ok"
    );
    expect(existsSync(dir) ? captureFiles(dir) : []).toEqual([]);
  });
});
