import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Extract the `## <version>` section of CHANGELOG.md (version may be `v`-prefixed). Returns null when absent. */
export function extractReleaseNotes(changelog: string, version: string): string | null {
  const heading = `## ${version.replace(/^v/, "")}`
  const lines = changelog.split("\n")
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start === -1) return null
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break
    body.push(line)
  }
  const notes = body.join("\n").trim()
  return notes === "" ? null : notes
}

if (import.meta.main) {
  const version = process.argv[2]
  if (!version) {
    console.error("usage: bun scripts/release-notes.ts <version>")
    process.exit(2)
  }
  const changelog = readFileSync(join(import.meta.dir, "..", "CHANGELOG.md"), "utf8")
  const notes = extractReleaseNotes(changelog, version)
  if (notes === null) {
    console.error(`No CHANGELOG.md section found for ${version}`)
    process.exit(1)
  }
  console.log(notes)
}
