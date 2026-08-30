import JSZip from "jszip"
import { readFileSync } from "fs"

function stripTextNodes(xml: string): string {
  // ponytail: L3 allows text diff only — normalize w:t/a:t/t/v to constant.
  // Keep tag but drop attrs variations like xml:space="preserve" for comparison
  xml = xml.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/g, "<w:t>TEXT</w:t>")
  xml = xml.replace(/<a:t[^>]*>[\s\S]*?<\/a:t>/g, "<a:t>TEXT</a:t>")
  // xlsx sharedStrings / inline t: careful not to replace <w:t> again — already done
  // generic <t> for xlsx: must not match <w:t> or <a:t> already normalized
  // Match <t> or <t ...> but not <w:t or <a:t — use negative lookbehind for : in tag prefix
  // Simpler: replace remaining <t> that are not part of w:t/a:t (which are gone)
  xml = xml.replace(/<t[^>]*>[\s\S]*?<\/t>/g, "<t>TEXT</t>")
  xml = xml.replace(/<v[^>]*>[\s\S]*?<\/v>/g, "<v>TEXT</v>")
  return xml
}

export interface VerifyResult {
  pass: boolean
  checkedFiles: number
  textDiffs: number
  details: string
}

export async function verifyL3(fileA: string, fileB: string): Promise<VerifyResult> {
  const bufA = readFileSync(fileA)
  const bufB = readFileSync(fileB)
  const isZipA = bufA.length >= 2 && bufA[0] === 0x50 && bufA[1] === 0x4b
  const isZipB = bufB.length >= 2 && bufB[0] === 0x50 && bufB[1] === 0x4b
  if (!isZipA || !isZipB) throw new Error("verify-l3 only supports OOXML (docx/xlsx/pptx) files")

  const zipA = await JSZip.loadAsync(bufA)
  const zipB = await JSZip.loadAsync(bufB)

  const namesA = new Set(Object.keys(zipA.files).filter((k) => !zipA.files[k].dir))
  const namesB = new Set(Object.keys(zipB.files).filter((k) => !zipB.files[k].dir))
  const all = new Set([...namesA, ...namesB])

  let checkedFiles = 0
  let textDiffs = 0
  const diffs: string[] = []

  for (const name of [...all].sort()) {
    const fa = zipA.file(name)
    const fb = zipB.file(name)
    if (!fa || !fb) {
      diffs.push(`missing file: ${name} (${!fa ? "A missing" : "B missing"})`)
      continue
    }
    checkedFiles++
    const isXml = name.endsWith(".xml") || name.endsWith(".rels") || name === "[Content_Types].xml"
    if (isXml) {
      const a = await fa.async("string")
      const b = await fb.async("string")
      if (a === b) continue
      // Check if diff is only text nodes
      const strippedA = stripTextNodes(a)
      const strippedB = stripTextNodes(b)
      if (strippedA === strippedB) {
        textDiffs++
        continue
      }
      // Strict diff: still different after stripping → Format diff
      diffs.push(`Format diff in ${name}`)
      // Provide small excerpt of diff (first 200 chars)
      const maxLen = 400
      if (strippedA.length !== strippedB.length) {
        diffs.push(`  length A stripped ${strippedA.length} vs B ${strippedB.length}`)
      } else {
        // find first differing offset
        let off = 0
        while (off < strippedA.length && strippedA[off] === strippedB[off]) off++
        diffs.push(`  first diff at offset ${off}: A="${strippedA.slice(off, off + 80).replace(/\n/g, "\\n")}" B="${strippedB.slice(off, off + 80).replace(/\n/g, "\\n")}"`)
      }
      if (diffs.join("\n").length > maxLen * 5) break
    } else {
      // binary compare
      const a = await fa.async("nodebuffer")
      const b = await fb.async("nodebuffer")
      if (a.length !== b.length || !a.equals(b as Buffer)) {
        diffs.push(`Binary diff in ${name} (${a.length} vs ${(b as Buffer).length} bytes)`)
      }
    }
  }

  const pass = diffs.length === 0
  return {
    pass,
    checkedFiles,
    textDiffs,
    details: pass ? "" : diffs.join("\n"),
  }
}
