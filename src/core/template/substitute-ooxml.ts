import JSZip from "jszip"

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function unescapeXml(str: string): string {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
}

// ponytail: \n → w:br inside same w:r (ponytail: w:br ceiling — for bullet/numbered lists, split w:p with same pPr/numPr if throughput matters)
function expandDocxNewlines(xml: string, tag: string): string {
  if (tag !== "w:t" || !xml.includes("\n")) return xml
  // Replace literal \n inside <w:t> with w:br — keeps same w:p, inserts line break inside same w:r
  // ponytail: single w:br per \n; bullet lists need separate w:p — upgrade path is to split w:p with replicated pPr/numPr
  return xml.replace(new RegExp(`<${tag.replace(/:/g, "\\:")}(\\s[^>]*)?>([\\s\\S]*?)</${tag.replace(/:/g, "\\:")}>`, "g"), (match, attrs, inner) => {
    if (!inner.includes("\n")) return match
    const a = attrs ?? ""
    const parts = inner.split("\n")
    // First part keeps original attrs; subsequent parts ensure preserve if needed
    let out = `<${tag}${a}>${parts[0]}</${tag}>`
    for (let i = 1; i < parts.length; i++) {
      let ai = a
      const part = parts[i]
      const needsPreserve = part.length > 0 && (part[0] === " " || part[part.length - 1] === " ")
      const hasPreserve = /xml:space\s*=\s*["']preserve["']/.test(ai)
      if (needsPreserve && !hasPreserve) ai = ai + ' xml:space="preserve"'
      out += `<w:br/><${tag}${ai}>${part}</${tag}>`
    }
    return out
  })
}

// ponytail: run-preserving replace keeps w:rPr/w:pPr intact — only w:t/a:t/t inner text changes
function replaceInXml(
  xml: string,
  tag: string,
  data: Record<string, string | number>,
): { xml: string; replaced: number; missing: string[] } {
  // Collect all <tag> inner texts with positions
  const escapedTag = tag.replace(/:/g, "\\:")
  // Match <tag ...>inner</tag> - tag may have attributes, inner is non-greedy
  const re = new RegExp(`<${escapedTag}(\\s[^>]*)?>([\\s\\S]*?)</${escapedTag}>`, "g")
  type Match = { full: string; attrs: string; inner: string; decoded: string; start: number; end: number }
  const matches: Match[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const full = m[0]
    const attrs = m[1] ?? ""
    const inner = m[2] ?? ""
    const decoded = unescapeXml(inner)
    matches.push({ full, attrs, inner, decoded, start: m.index, end: m.index + full.length })
  }
  if (matches.length === 0) return { xml, replaced: 0, missing: [] }

  // Build logical text and cumulative lengths
  const decodedInners = matches.map((x) => x.decoded)
  const logicalText = decodedInners.join("")
  const cum: number[] = []
  let acc = 0
  for (const d of decodedInners) {
    cum.push(acc)
    acc += d.length
  }

  // Detect mode: placeholder present? else anchor mode
  const hasPlaceholder = /\{\{/.test(logicalText)
  type Span = { start: number; end: number; replacement: string; key?: string }
  const spans: Span[] = []
  const missing: string[] = []

  if (hasPlaceholder) {
    // Placeholder mode — find all {{key}} in logicalText
    let pm: RegExpExecArray | null
    const pat = new RegExp(PLACEHOLDER_PATTERN.source, "g")
    // Reset regex
    while ((pm = pat.exec(logicalText)) !== null) {
      const key = pm[1]
      const start = pm.index
      const end = start + pm[0].length
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        missing.push(key)
        continue
      }
      spans.push({ start, end, replacement: String(data[key]).replace(/\r\n/g, "\n"), key })
    }
    if (missing.length > 0) return { xml, replaced: 0, missing: [...new Set(missing)] }
  } else {
    // Anchor mode — data keys are old text to find, values are new text
    // Find all occurrences of each key in logicalText
    for (const [oldText, newVal] of Object.entries(data)) {
      if (oldText.trim() === "") continue
      let idx = 0
      while (true) {
        const pos = logicalText.indexOf(oldText, idx)
        if (pos === -1) break
        spans.push({ start: pos, end: pos + oldText.length, replacement: String(newVal).replace(/\r\n/g, "\n"), key: oldText })
        idx = pos + oldText.length
      }
    }
    // Sort descending so later spans don't shift earlier ones
    spans.sort((a, b) => b.start - a.start)
    if (spans.length === 0) return { xml, replaced: 0, missing: [] }
  }

  if (spans.length === 0) return { xml, replaced: 0, missing: [] }

  // For placeholder mode, sort descending to process from end
  if (hasPlaceholder) spans.sort((a, b) => b.start - a.start)

  // Deduplicate overlapping spans: keep earliest in sorted order, skip overlapping
  const filtered: Span[] = []
  let lastStart = Infinity
  for (const s of spans) {
    if (s.end <= lastStart) {
      filtered.push(s)
      lastStart = s.start
    }
  }

  // Apply spans to decodedInners (run-preserving)
  // Process each span: map logical start/end to run indices
  for (const span of filtered) {
    const { start, end, replacement } = span
    // Find startIdx
    let startIdx = -1
    let endIdx = -1
    let startOffset = 0
    let endOffset = 0
    for (let i = 0; i < decodedInners.length; i++) {
      const cs = cum[i]
      const ce = cs + decodedInners[i].length
      if (startIdx === -1 && start >= cs && start < ce) {
        startIdx = i
        startOffset = start - cs
      }
      // end is exclusive, so find run containing end-1
      if (endIdx === -1 && end - 1 >= cs && end - 1 < ce) {
        endIdx = i
        endOffset = end - cs
      }
      // Edge: span ends exactly at boundary between runs (end == ce of previous)
      // Then endIdx is next run's start? but end-1 logic handles
      // Edge: empty decodedInners (length 0) - skip
    }
    // Edge: span at very end (end == logicalText.length)
    if (end === logicalText.length && endIdx === -1) {
      // find last non-empty run
      for (let i = decodedInners.length - 1; i >= 0; i--) {
        if (decodedInners[i].length > 0 || cum[i] + decodedInners[i].length === logicalText.length) {
          endIdx = i
          endOffset = decodedInners[i].length
          break
        }
      }
    }
    // If start or end not found (empty runs), skip
    if (startIdx === -1 || endIdx === -1) continue

    // For single-run span
    if (startIdx === endIdx) {
      const inner = decodedInners[startIdx]
      decodedInners[startIdx] = inner.slice(0, startOffset) + replacement + inner.slice(endOffset)
    } else {
      // Multi-run span
      const startInner = decodedInners[startIdx]
      const endInner = decodedInners[endIdx]
      decodedInners[startIdx] = startInner.slice(0, startOffset) + replacement
      // clear middle runs
      for (let i = startIdx + 1; i < endIdx; i++) decodedInners[i] = ""
      decodedInners[endIdx] = endInner.slice(endOffset)
    }
    // Note: we do NOT recompute cum after each span because we processed descending order
    // and spans are non-overlapping and sorted descending, so earlier spans' cum remains valid
  }

  // Rebuild xml from modified decodedInners
  // Iterate original matches in order, replace inner with escaped decodedInners[i]
  let out = ""
  let last = 0
  for (let i = 0; i < matches.length; i++) {
    const ma = matches[i]
    out += xml.slice(last, ma.start)
    const newDecoded = decodedInners[i]
    const escaped = escapeXml(newDecoded)
    // Preserve original attrs, but ensure xml:space="preserve" if needed for leading/trailing spaces
    let attrs = ma.attrs
    // Check preserve need on raw decoded (before escape) but after split? Use decoded without newlines for preserve check on first segment
    const preserveCheck = newDecoded.split("\n")[0] ?? newDecoded
    const needsPreserve = preserveCheck.length > 0 && (preserveCheck[0] === " " || preserveCheck[preserveCheck.length - 1] === " ")
    // For multiline, preserve is handled per segment in expandDocxNewlines; here only first segment's attrs matters
    const hasPreserve = /xml:space\s*=\s*["']preserve["']/.test(attrs)
    if (needsPreserve && !hasPreserve && !newDecoded.includes("\n")) {
      attrs = attrs + ' xml:space="preserve"'
    }
    // If empty and had preserve, we keep it (harmless)
    out += `<${tag}${attrs}>${escaped}</${tag}>`
    last = ma.end
  }
  out += xml.slice(last)
  out = expandDocxNewlines(out, tag)
  return { xml: out, replaced: filtered.length, missing: [] }
}

function targetFilesForFormat(zip: JSZip, format: string): { file: string; tag: string }[] {
  const all = Object.keys(zip.files)
  const res: { file: string; tag: string }[] = []
  if (format === "docx") {
    for (const f of all) {
      if (/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(f)) {
        res.push({ file: f, tag: "w:t" })
      }
    }
    // also include word/document.xml variations like word/document.xml handled, but header/footer already covers
    if (res.length === 0) {
      // fallback: any word/*.xml containing w:t
      for (const f of all) if (f.startsWith("word/") && f.endsWith(".xml")) res.push({ file: f, tag: "w:t" })
    }
  } else if (format === "xlsx") {
    for (const f of all) {
      if (f === "xl/sharedStrings.xml") res.push({ file: f, tag: "t" })
      else if (/^xl\/worksheets\/sheet\d+\.xml$/.test(f)) res.push({ file: f, tag: "t" })
    }
    // also include t in sharedStrings? already. Inline sheets may have t inside is
  } else if (format === "pptx") {
    for (const f of all) {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(f) || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)) {
        res.push({ file: f, tag: "a:t" })
      }
    }
  }
  return res
}

function detectFormatFromZip(zip: JSZip): "docx" | "xlsx" | "pptx" | null {
  const files = Object.keys(zip.files)
  if (files.some((f) => f === "word/document.xml")) return "docx"
  if (files.some((f) => f === "xl/workbook.xml")) return "xlsx"
  if (files.some((f) => f === "ppt/presentation.xml")) return "pptx"
  return null
}

export async function substituteOoxml(
  buffer: Buffer,
  data: Record<string, string | number>,
): Promise<{ buffer: Buffer; replaced: number; format: string }> {
  const zip = await JSZip.loadAsync(buffer)
  const format = detectFormatFromZip(zip)
  if (!format) throw new Error("not an OOXML file (docx/xlsx/pptx)")
  const targets = targetFilesForFormat(zip, format)
  if (targets.length === 0) throw new Error(`no target parts found for ${format}`)

  let totalReplaced = 0
  const allMissing: string[] = []
  for (const { file, tag } of targets) {
    const entry = zip.file(file)
    if (!entry) continue
    const xml = await entry.async("string")
    // ponytail: quick skip if no placeholder or anchor text present
    const hasAnyKey = Object.keys(data).some((k) => xml.includes(k) || xml.includes("{{"))
    // Also check logical placeholder presence? but quick check on raw xml for {{ is enough
    if (!xml.includes("{{") && !hasAnyKey) continue
    const { xml: newXml, replaced, missing } = replaceInXml(xml, tag, data)
    if (missing.length > 0) allMissing.push(...missing)
    if (replaced > 0) {
      zip.file(file, newXml)
      totalReplaced += replaced
    }
  }
  if (allMissing.length > 0) {
    const uniq = [...new Set(allMissing)]
    throw new Error(`missing template keys: ${uniq.join(", ")}`)
  }
  if (totalReplaced === 0) {
    // ponytail: no placeholder matched — try anchor mode already handled inside replaceInXml,
    // but if still 0, surface helpful error
    throw new Error(`no placeholders replaced — check {{keys}} in Template and data keys: ${Object.keys(data).join(", ")}`)
  }
  const out = await zip.generateAsync({ type: "nodebuffer" })
  return { buffer: out as Buffer, replaced: totalReplaced, format }
}

// For testing: expose helpers
