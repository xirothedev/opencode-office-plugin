import JSZip from "jszip";

const PLACEHOLDER_PATTERN = /\{\{\s*(?<key>[A-Za-z0-9_.-]+)\s*\}\}/gu;

const escapeXml = (str: string): string =>
  str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const unescapeXml = (str: string): string =>
  str
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");

// ponytail: \n → w:br inside same w:r (ponytail: w:br ceiling — for bullet/numbered lists, split w:p with same pPr/numPr if throughput matters)
const expandDocxNewlines = (xml: string, tag: string): string => {
  if (tag !== "w:t" || !xml.includes("\n")) {
    return xml;
  }
  // Replace literal \n inside <w:t> with w:br — keeps same w:p, inserts line break inside same w:r
  // ponytail: single w:br per \n; bullet lists need separate w:p — upgrade path is to split w:p with replicated pPr/numPr
  // ponytail: ':' is literal in regex (unicode mode forbids '\:'), so the tag interpolates unescaped
  const pattern = `<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`;
  return xml.replaceAll(new RegExp(pattern, "gu"), (match, attrs, inner) => {
    if (!inner.includes("\n")) {
      return match;
    }
    const a = attrs ?? "";
    const parts = inner.split("\n");
    // First part keeps original attrs; subsequent parts ensure preserve if needed
    let out = `<${tag}${a}>${parts[0]}</${tag}>`;
    for (let i = 1; i < parts.length; i += 1) {
      let ai = a;
      const part = parts[i];
      const needsPreserve =
        part.length > 0 && (part[0] === " " || part.at(-1) === " ");
      const hasPreserve = /xml:space\s*=\s*["']preserve["']/u.test(ai);
      if (needsPreserve && !hasPreserve) {
        ai += ' xml:space="preserve"';
      }
      out += `<w:br/><${tag}${ai}>${part}</${tag}>`;
    }
    return out;
  });
};

interface TagMatch {
  full: string;
  attrs: string;
  inner: string;
  decoded: string;
  start: number;
  end: number;
}

// ponytail: run-preserving replace keeps w:rPr/w:pPr intact — only w:t/a:t/t inner text changes
const collectTagMatches = (xml: string, tag: string): TagMatch[] => {
  // Match <tag ...>inner</tag> - tag may have attributes, inner is non-greedy
  // ponytail: ':' is literal in regex (unicode mode forbids '\:'), so the tag interpolates unescaped
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gu");
  const matches: TagMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const [full, rawAttrs, rawInner] = m;
    const attrs = rawAttrs ?? "";
    const inner = rawInner ?? "";
    const decoded = unescapeXml(inner);
    matches.push({
      attrs,
      decoded,
      end: m.index + full.length,
      full,
      inner,
      start: m.index,
    });
  }
  return matches;
};

interface Span {
  start: number;
  end: number;
  replacement: string;
  key?: string;
}

const placeholderSpans = (
  logicalText: string,
  data: Record<string, string | number>
): { spans: Span[]; missing: string[] } => {
  // Placeholder mode — find all {{key}} in logicalText
  const spans: Span[] = [];
  const missing: string[] = [];
  let pm: RegExpExecArray | null;
  const pat = new RegExp(PLACEHOLDER_PATTERN.source, "gu");
  // Reset regex
  while ((pm = pat.exec(logicalText)) !== null) {
    const [, key] = pm;
    if (key === undefined) {
      continue;
    }
    const start = pm.index;
    const end = start + pm[0].length;
    if (!Object.hasOwn(data, key)) {
      missing.push(key);
      continue;
    }
    spans.push({
      end,
      key,
      replacement: String(data[key]).replaceAll("\r\n", "\n"),
      start,
    });
  }
  return { missing, spans };
};

const anchorSpans = (
  logicalText: string,
  data: Record<string, string | number>
): Span[] => {
  // Anchor mode — data keys are old text to find, values are new text
  // Find all occurrences of each key in logicalText
  const spans: Span[] = [];
  for (const [oldText, newVal] of Object.entries(data)) {
    if (oldText.trim() === "") {
      continue;
    }
    let idx = 0;
    while (true) {
      const pos = logicalText.indexOf(oldText, idx);
      if (pos === -1) {
        break;
      }
      spans.push({
        end: pos + oldText.length,
        key: oldText,
        replacement: String(newVal).replaceAll("\r\n", "\n"),
        start: pos,
      });
      idx = pos + oldText.length;
    }
  }
  // Sort descending so later spans don't shift earlier ones
  spans.sort((a, b) => b.start - a.start);
  return spans;
};

const dedupeSpans = (spans: Span[]): Span[] => {
  // Deduplicate overlapping spans: keep earliest in sorted order, skip overlapping
  const filtered: Span[] = [];
  let lastStart = Infinity;
  for (const s of spans) {
    if (s.end <= lastStart) {
      filtered.push(s);
      lastStart = s.start;
    }
  }
  return filtered;
};

const endAtLogicalEnd = (
  decodedInners: string[],
  cum: number[],
  logicalLength: number
): { endIdx: number; endOffset: number } | null => {
  // Edge: span at very end (end == logicalText.length) — find last non-empty run
  for (let i = decodedInners.length - 1; i >= 0; i -= 1) {
    const len = decodedInners[i]?.length ?? 0;
    if (len > 0 || (cum[i] ?? 0) + len === logicalLength) {
      return { endIdx: i, endOffset: len };
    }
  }
  return null;
};

const locateSpan = (
  decodedInners: string[],
  cum: number[],
  span: Span,
  logicalLength: number
): {
  startIdx: number;
  endIdx: number;
  startOffset: number;
  endOffset: number;
} | null => {
  const { start, end } = span;
  // Find startIdx
  let startIdx = -1;
  let endIdx = -1;
  let startOffset = 0;
  let endOffset = 0;
  for (let i = 0; i < decodedInners.length; i += 1) {
    const cs = cum[i] ?? 0;
    const ce = cs + (decodedInners[i]?.length ?? 0);
    if (startIdx === -1 && start >= cs && start < ce) {
      startIdx = i;
      startOffset = start - cs;
    }
    // end is exclusive, so find run containing end-1
    if (endIdx === -1 && end - 1 >= cs && end - 1 < ce) {
      endIdx = i;
      endOffset = end - cs;
    }
    // Edge: span ends exactly at boundary between runs (end == ce of previous)
    // Then endIdx is next run's start? but end-1 logic handles
    // Edge: empty decodedInners (length 0) - skip
  }
  // Edge: span at very end (end == logicalText.length)
  if (end === logicalLength && endIdx === -1) {
    const found = endAtLogicalEnd(decodedInners, cum, logicalLength);
    if (found) {
      ({ endIdx, endOffset } = found);
    }
  }
  // If start or end not found (empty runs), skip
  if (startIdx === -1 || endIdx === -1) {
    return null;
  }
  return { endIdx, endOffset, startIdx, startOffset };
};

const applyFilteredSpans = (
  decodedInners: string[],
  cum: number[],
  filtered: Span[],
  logicalLength: number
): void => {
  // Apply spans to decodedInners (run-preserving)
  // Process each span: map logical start/end to run indices
  for (const span of filtered) {
    const located = locateSpan(decodedInners, cum, span, logicalLength);
    if (!located) {
      continue;
    }
    const { startIdx, endIdx, startOffset, endOffset } = located;
    const { replacement } = span;
    // For single-run span
    if (startIdx === endIdx) {
      const inner = decodedInners[startIdx] ?? "";
      decodedInners[startIdx] =
        inner.slice(0, startOffset) + replacement + inner.slice(endOffset);
    } else {
      // Multi-run span
      const startInner = decodedInners[startIdx] ?? "";
      const endInner = decodedInners[endIdx] ?? "";
      decodedInners[startIdx] = startInner.slice(0, startOffset) + replacement;
      // clear middle runs
      for (let i = startIdx + 1; i < endIdx; i += 1) {
        decodedInners[i] = "";
      }
      decodedInners[endIdx] = endInner.slice(endOffset);
    }
    // Note: we do NOT recompute cum after each span because we processed descending order
    // and spans are non-overlapping and sorted descending, so earlier spans' cum remains valid
  }
};

const rebuildXml = (
  xml: string,
  tag: string,
  matches: TagMatch[],
  decodedInners: string[]
): string => {
  // Rebuild xml from modified decodedInners
  // Iterate original matches in order, replace inner with escaped decodedInners[i]
  let out = "";
  let last = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const ma = matches[i];
    if (!ma) {
      continue;
    }
    out += xml.slice(last, ma.start);
    const newDecoded = decodedInners[i] ?? "";
    const escaped = escapeXml(newDecoded);
    // Preserve original attrs, but ensure xml:space="preserve" if needed for leading/trailing spaces
    let { attrs } = ma;
    // Check preserve need on raw decoded (before escape) but after split? Use decoded without newlines for preserve check on first segment
    const preserveCheck = newDecoded.split("\n")[0] ?? newDecoded;
    const needsPreserve =
      preserveCheck.length > 0 &&
      (preserveCheck[0] === " " || preserveCheck.at(-1) === " ");
    // For multiline, preserve is handled per segment in expandDocxNewlines; here only first segment's attrs matters
    const hasPreserve = /xml:space\s*=\s*["']preserve["']/u.test(attrs);
    if (needsPreserve && !hasPreserve && !newDecoded.includes("\n")) {
      attrs += ' xml:space="preserve"';
    }
    // If empty and had preserve, we keep it (harmless)
    out += `<${tag}${attrs}>${escaped}</${tag}>`;
    last = ma.end;
  }
  out += xml.slice(last);
  return expandDocxNewlines(out, tag);
};

// ponytail: run-preserving replace keeps w:rPr/w:pPr intact — only w:t/a:t/t inner text changes
const replaceInXml = (
  xml: string,
  tag: string,
  data: Record<string, string | number>
): { xml: string; replaced: number; missing: string[] } => {
  // Collect all <tag> inner texts with positions
  const matches = collectTagMatches(xml, tag);
  if (matches.length === 0) {
    return { missing: [], replaced: 0, xml };
  }

  // Build logical text and cumulative lengths
  const decodedInners = matches.map((x) => x.decoded);
  const logicalText = decodedInners.join("");
  const cum: number[] = [];
  let acc = 0;
  for (const d of decodedInners) {
    cum.push(acc);
    acc += d.length;
  }

  // Detect mode: placeholder present? else anchor mode
  const hasPlaceholder = /\{\{/u.test(logicalText);

  if (hasPlaceholder) {
    const { spans, missing } = placeholderSpans(logicalText, data);
    if (missing.length > 0) {
      return { missing: [...new Set(missing)], replaced: 0, xml };
    }
    if (spans.length === 0) {
      return { missing: [], replaced: 0, xml };
    }
    // For placeholder mode, sort descending to process from end
    spans.sort((a, b) => b.start - a.start);
    const filtered = dedupeSpans(spans);
    applyFilteredSpans(decodedInners, cum, filtered, logicalText.length);
    return {
      missing: [],
      replaced: filtered.length,
      xml: rebuildXml(xml, tag, matches, decodedInners),
    };
  }

  const spans = anchorSpans(logicalText, data);
  if (spans.length === 0) {
    return { missing: [], replaced: 0, xml };
  }
  const filtered = dedupeSpans(spans);
  applyFilteredSpans(decodedInners, cum, filtered, logicalText.length);
  return {
    missing: [],
    replaced: filtered.length,
    xml: rebuildXml(xml, tag, matches, decodedInners),
  };
};

const docxTargets = (all: string[]): { file: string; tag: string }[] => {
  const res: { file: string; tag: string }[] = [];
  for (const f of all) {
    if (
      /^word\/(?<part>document|header\d*|footer\d*|footnotes|endnotes)\.xml$/u.test(
        f
      )
    ) {
      res.push({ file: f, tag: "w:t" });
    }
  }
  // also include word/document.xml variations like word/document.xml handled, but header/footer already covers
  if (res.length === 0) {
    // fallback: any word/*.xml containing w:t
    for (const f of all) {
      if (f.startsWith("word/") && f.endsWith(".xml")) {
        res.push({ file: f, tag: "w:t" });
      }
    }
  }
  return res;
};

const xlsxTargets = (all: string[]): { file: string; tag: string }[] => {
  const res: { file: string; tag: string }[] = [];
  for (const f of all) {
    if (f === "xl/sharedStrings.xml") {
      res.push({ file: f, tag: "t" });
    } else if (/^xl\/worksheets\/sheet\d+\.xml$/u.test(f)) {
      res.push({ file: f, tag: "t" });
    }
  }
  // also include t in sharedStrings? already. Inline sheets may have t inside is
  return res;
};

const pptxTargets = (all: string[]): { file: string; tag: string }[] => {
  const res: { file: string; tag: string }[] = [];
  for (const f of all) {
    if (
      /^ppt\/slides\/slide\d+\.xml$/u.test(f) ||
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(f)
    ) {
      res.push({ file: f, tag: "a:t" });
    }
  }
  return res;
};

const targetFilesForFormat = (
  zip: JSZip,
  format: string
): { file: string; tag: string }[] => {
  const all = Object.keys(zip.files);
  if (format === "docx") {
    return docxTargets(all);
  }
  if (format === "xlsx") {
    return xlsxTargets(all);
  }
  if (format === "pptx") {
    return pptxTargets(all);
  }
  return [];
};

const detectFormatFromZip = (zip: JSZip): "docx" | "xlsx" | "pptx" | null => {
  const files = Object.keys(zip.files);
  if (files.some((f) => f === "word/document.xml")) {
    return "docx";
  }
  if (files.some((f) => f === "xl/workbook.xml")) {
    return "xlsx";
  }
  if (files.some((f) => f === "ppt/presentation.xml")) {
    return "pptx";
  }
  return null;
};

export const substituteOoxml = async (
  buffer: Uint8Array,
  data: Record<string, string | number>
): Promise<{ buffer: Uint8Array; replaced: number; format: string }> => {
  const zip = await JSZip.loadAsync(buffer);
  const format = detectFormatFromZip(zip);
  if (!format) {
    throw new Error("not an OOXML file (docx/xlsx/pptx)");
  }
  const targets = targetFilesForFormat(zip, format);
  if (targets.length === 0) {
    throw new Error(`no target parts found for ${format}`);
  }

  const loaded = await Promise.all(
    targets.map(async ({ file, tag }) => {
      const entry = zip.file(file);
      if (!entry) {
        return null;
      }
      return { file, tag, xml: await entry.async("string") };
    })
  );
  let totalReplaced = 0;
  const allMissing: string[] = [];
  for (const item of loaded) {
    if (!item) {
      continue;
    }
    const { file, tag, xml } = item;
    // ponytail: quick skip if no placeholder or anchor text present
    const hasAnyKey = Object.keys(data).some(
      (k) => xml.includes(k) || xml.includes("{{")
    );
    // Also check logical placeholder presence? but quick check on raw xml for {{ is enough
    if (!xml.includes("{{") && !hasAnyKey) {
      continue;
    }
    const { xml: newXml, replaced, missing } = replaceInXml(xml, tag, data);
    if (missing.length > 0) {
      allMissing.push(...missing);
    }
    if (replaced > 0) {
      zip.file(file, newXml);
      totalReplaced += replaced;
    }
  }
  if (allMissing.length > 0) {
    const uniq = [...new Set(allMissing)];
    throw new Error(`missing template keys: ${uniq.join(", ")}`);
  }
  if (totalReplaced === 0) {
    // ponytail: no placeholder matched — try anchor mode already handled inside replaceInXml,
    // but if still 0, surface helpful error
    throw new Error(
      `no placeholders replaced — check {{keys}} in Template and data keys: ${Object.keys(data).join(", ")}`
    );
  }
  const out = await zip.generateAsync({ type: "uint8array" });
  return { buffer: out, format, replaced: totalReplaced };
};

// For testing: expose helpers
