// Capture: one JSON record per officecli invoke (ADR 0014), same shape as test
// Captures plus `source`. Local-only, fire-and-forget: a failed write never fails an invoke.
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import { getCapturesDir } from "@/core/storage/paths"

const MAX_KEEP = 200
const MAX_FIELD = 4096

function truncate(v: unknown): { value: unknown; dropped: number } {
  const s = typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v)
  if (s === undefined || s.length <= MAX_FIELD) return { value: v, dropped: 0 }
  return { value: s.slice(0, MAX_FIELD), dropped: s.length - MAX_FIELD }
}

export async function capture<T>(
  source: "agent" | "host",
  label: string,
  args: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const start = Date.now()
  let output: T | null = null
  let error: string | null = null
  try {
    output = await run()
    return output
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    writeCapture({ label, source, args, output, error, ms: Date.now() - start, ts: new Date(start).toISOString() })
  }
}

export function captureQuiet(source: "agent" | "host", label: string, args: unknown, error: unknown): void {
  writeCapture({
    label,
    source,
    args,
    output: null,
    error: error instanceof Error ? error.message : String(error),
    ms: 0,
    ts: new Date().toISOString(),
  })
}

function writeCapture(rec: Record<string, unknown>): void {
  try {
    const dir = getCapturesDir()
    const a = truncate(rec.args)
    const o = truncate(rec.output)
    mkdirSync(dir, { recursive: true })
    if (!existsSync(join(dir, ".gitignore"))) {
      writeFileSync(join(dir, ".gitignore"), "*\n")
    }
    const label = String(rec.label).replace(/[^a-z0-9-]+/gi, "")
    let path = join(dir, `${Date.now()}-${label}.json`)
    for (let i = 2; existsSync(path); i++) {
      path = join(dir, `${Date.now()}-${label}-${i}.json`)
    }
    writeFileSync(path, JSON.stringify({ ...rec, args: a.value, output: o.value, truncatedBytes: a.dropped + o.dropped }, null, 2))
    sweep(dir)
  } catch {
    // fire-and-forget
  }
}

function sweep(dir: string): void {
  // ponytail: lexicographic sort works because the epoch-ms prefix is fixed-width; switch to mtime if that ever breaks
  // ponytail: cap is global across projects in the shared dataDir; go per-project when eviction actually bites Skill Learning
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
  for (const f of files.slice(MAX_KEEP)) {
    unlinkSync(join(dir, f))
  }
}
