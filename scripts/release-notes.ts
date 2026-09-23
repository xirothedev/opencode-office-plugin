import { readFileSync } from "node:fs";
import path from "node:path";

/** Extract the `## <version>` section of CHANGELOG.md (version may be `v`-prefixed). Returns null when absent. */
export const extractReleaseNotes = (
  changelog: string,
  version: string
): string | null => {
  const heading = `## ${version.replace(/^v/u, "")}`;
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return null;
  }
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/u.test(line)) {
      break;
    }
    body.push(line);
  }
  const notes = body.join("\n").trim();
  return notes === "" ? null : notes;
};

if (import.meta.main) {
  const version = process.argv.at(2);
  if (!version) {
    console.error("usage: bun scripts/release-notes.ts <version>");
    process.exit(2);
  }
  const changelog = readFileSync(
    path.join(import.meta.dir, "..", "CHANGELOG.md"),
    "utf-8"
  );
  const notes = extractReleaseNotes(changelog, version);
  if (notes === null) {
    console.error(`No CHANGELOG.md section found for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
