import { describe, expect, it } from "vitest"
import { extractReleaseNotes } from "../../scripts/release-notes"

const changelog = `# Changelog

All notable changes to this project are documented in this file.

## 0.3.0

### Minor Changes

- Added a thing.

### Patch Changes

- Fixed a thing.

## 0.2.1

### Patch Changes

- Old fix.
`

describe("extractReleaseNotes", () => {
  it("extracts the section for a version", () => {
    const notes = extractReleaseNotes(changelog, "0.3.0")
    expect(notes).toContain("Added a thing.")
    expect(notes).toContain("Fixed a thing.")
    expect(notes).not.toContain("Old fix.")
  })

  it("accepts a v-prefixed tag", () => {
    expect(extractReleaseNotes(changelog, "v0.2.1")).toBe("### Patch Changes\n\n- Old fix.")
  })

  it("does not break on deeper headings inside a section", () => {
    expect(extractReleaseNotes(changelog, "v0.3.0")).toBe(
      "### Minor Changes\n\n- Added a thing.\n\n### Patch Changes\n\n- Fixed a thing.",
    )
  })

  it("ignores a version mentioned inside an entry body", () => {
    const tricky = `# Changelog

## 0.4.0

- Mentions 0.3.0 in prose, but not as a heading.

## 0.3.0

- Old.
`
    expect(extractReleaseNotes(tricky, "0.4.0")).toBe("- Mentions 0.3.0 in prose, but not as a heading.")
  })

  it("returns null when the version is missing", () => {
    expect(extractReleaseNotes(changelog, "9.9.9")).toBeNull()
  })

  it("returns null for an empty section", () => {
    const empty = "# Changelog\n\n## 0.3.0\n\n## 0.2.1\n\n- Old.\n"
    expect(extractReleaseNotes(empty, "0.3.0")).toBeNull()
  })
})
