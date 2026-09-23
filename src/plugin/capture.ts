// Capture: one JSON record per officecli invoke (ADR 0014), same shape as test
// Captures plus `source`. Local-only, fire-and-forget: a failed write never fails an invoke.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";

import { getCapturesDir } from "@/core/storage/paths";

const MAX_KEEP = 200;
const MAX_FIELD = 4096;

const truncate = (v: unknown): { value: unknown; dropped: number } => {
  let s: string | undefined;
  if (typeof v === "string") {
    s = v;
  } else if (v === undefined) {
    s = "";
  } else {
    s = JSON.stringify(v);
  }
  if (s === undefined || s.length <= MAX_FIELD) {
    return { dropped: 0, value: v };
  }
  return { dropped: s.length - MAX_FIELD, value: s.slice(0, MAX_FIELD) };
};

const sweep = (dir: string): void => {
  // ponytail: lexicographic sort works because the epoch-ms prefix is fixed-width; switch to mtime if that ever breaks
  // ponytail: cap is global across projects in the shared dataDir; go per-project when eviction actually bites Skill Learning
  // ponytail: toSorted/toReversed need lib es2023 — assert the runtime shape so tsc (lib es2022) passes without a config change
  type SortedStrings = string[] & { toReversed: () => string[] };
  const files = (
    readdirSync(dir).filter((f) => f.endsWith(".json")) as unknown as {
      toSorted: () => SortedStrings;
    }
  )
    .toSorted()
    .toReversed();
  for (const f of files.slice(MAX_KEEP)) {
    unlinkSync(nodePath.join(dir, f));
  }
};

const writeCapture = (rec: Record<string, unknown>): void => {
  try {
    const dir = getCapturesDir();
    const a = truncate(rec.args);
    const o = truncate(rec.output);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(nodePath.join(dir, ".gitignore"))) {
      writeFileSync(nodePath.join(dir, ".gitignore"), "*\n");
    }
    const label = String(rec.label).replaceAll(/[^a-z0-9-]+/giu, "");
    let path = nodePath.join(dir, `${Date.now()}-${label}.json`);
    for (let i = 2; existsSync(path); i += 1) {
      path = nodePath.join(dir, `${Date.now()}-${label}-${i}.json`);
    }
    writeFileSync(
      path,
      JSON.stringify(
        {
          ...rec,
          args: a.value,
          output: o.value,
          truncatedBytes: a.dropped + o.dropped,
        },
        null,
        2
      )
    );
    sweep(dir);
  } catch {
    // fire-and-forget
  }
};

export const capture = async <T>(
  source: "agent" | "host",
  label: string,
  args: unknown,
  run: () => Promise<T>
): Promise<T> => {
  const start = Date.now();
  let output: T | null = null;
  let errorMessage: string | null = null;
  try {
    output = await run();
    return output;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    writeCapture({
      args,
      error: errorMessage,
      label,
      ms: Date.now() - start,
      output,
      source,
      ts: new Date(start).toISOString(),
    });
  }
};

export const captureQuiet = (
  source: "agent" | "host",
  label: string,
  args: unknown,
  error: unknown
): void => {
  writeCapture({
    args,
    error: error instanceof Error ? error.message : String(error),
    label,
    ms: 0,
    output: null,
    source,
    ts: new Date().toISOString(),
  });
};
