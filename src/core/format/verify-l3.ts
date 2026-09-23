import { readFileSync } from "node:fs";

import JSZip from "jszip";

const stripTextNodes = (xmlInput: string): string => {
  // ponytail: L3 allows text diff only — normalize w:t/a:t/t/v to constant.
  // Keep tag but drop attrs variations like xml:space="preserve" for comparison
  let xml = xmlInput;
  xml = xml.replaceAll(/<w:t[^>]*>[\s\S]*?<\/w:t>/gu, "<w:t>TEXT</w:t>");
  xml = xml.replaceAll(/<a:t[^>]*>[\s\S]*?<\/a:t>/gu, "<a:t>TEXT</a:t>");
  // xlsx sharedStrings / inline t: careful not to replace <w:t> again — already done
  // generic <t> for xlsx: must not match <w:t> or <a:t> already normalized
  // Match <t> or <t ...> but not <w:t or <a:t — use negative lookbehind for : in tag prefix
  // Simpler: replace remaining <t> that are not part of w:t/a:t (which are gone)
  xml = xml.replaceAll(/<t[^>]*>[\s\S]*?<\/t>/gu, "<t>TEXT</t>");
  xml = xml.replaceAll(/<v[^>]*>[\s\S]*?<\/v>/gu, "<v>TEXT</v>");
  return xml;
};

export interface VerifyResult {
  pass: boolean;
  checkedFiles: number;
  textDiffs: number;
  details: string;
}

const isXmlPart = (name: string): boolean =>
  name.endsWith(".xml") ||
  name.endsWith(".rels") ||
  name === "[Content_Types].xml";

const firstDiffOffset = (a: string, b: string): number => {
  let off = 0;
  while (off < a.length && a[off] === b[off]) {
    off += 1;
  }
  return off;
};

const excerptLines = (strippedA: string, strippedB: string): string[] => {
  const out: string[] = [];
  const maxLen = 400;
  if (strippedA.length === strippedB.length) {
    const off = firstDiffOffset(strippedA, strippedB);
    out.push(
      `  first diff at offset ${off}: A="${strippedA.slice(off, off + 80).replaceAll("\n", "\\n")}" B="${strippedB.slice(off, off + 80).replaceAll("\n", "\\n")}"`
    );
  } else {
    out.push(
      `  length A stripped ${strippedA.length} vs B ${strippedB.length}`
    );
  }
  if (out.join("\n").length > maxLen * 5) {
    out.push("  (truncated)");
  }
  return out;
};

type ComparedXml =
  | { kind: "same" }
  | { kind: "text" }
  | { kind: "format"; lines: string[] };

const compareXmlStrings = (name: string, a: string, b: string): ComparedXml => {
  if (a === b) {
    return { kind: "same" };
  }
  const strippedA = stripTextNodes(a);
  const strippedB = stripTextNodes(b);
  if (strippedA === strippedB) {
    return { kind: "text" };
  }
  return {
    kind: "format",
    lines: [`Format diff in ${name}`, ...excerptLines(strippedA, strippedB)],
  };
};

const compareBinaryBytes = (
  name: string,
  a: Uint8Array,
  b: Uint8Array
): string | null => {
  if (a.length !== b.length || !a.every((v, i) => v === b[i])) {
    return `Binary diff in ${name} (${a.length} vs ${b.length} bytes)`;
  }
  return null;
};

const readPair = async (
  zipA: JSZip,
  zipB: JSZip,
  name: string
): Promise<
  | { kind: "missing"; line: string }
  | { kind: "xml"; a: string; b: string }
  | { kind: "binary"; a: Uint8Array; b: Uint8Array }
> => {
  const fa = zipA.file(name);
  const fb = zipB.file(name);
  if (!fa || !fb) {
    return {
      kind: "missing",
      line: `missing file: ${name} (${fa ? "B missing" : "A missing"})`,
    };
  }
  if (isXmlPart(name)) {
    const [a, b] = await Promise.all([fa.async("string"), fb.async("string")]);
    return { a, b, kind: "xml" };
  }
  const [a, b] = await Promise.all([
    fa.async("uint8array"),
    fb.async("uint8array"),
  ]);
  return { a, b, kind: "binary" };
};

export const verifyL3 = async (
  fileA: string,
  fileB: string
): Promise<VerifyResult> => {
  const bufA = readFileSync(fileA);
  const bufB = readFileSync(fileB);
  const isZipA = bufA.length >= 2 && bufA[0] === 0x50 && bufA[1] === 0x4b;
  const isZipB = bufB.length >= 2 && bufB[0] === 0x50 && bufB[1] === 0x4b;
  if (!isZipA || !isZipB) {
    throw new Error("verify-l3 only supports OOXML (docx/xlsx/pptx) files");
  }

  const zipA = await JSZip.loadAsync(bufA);
  const zipB = await JSZip.loadAsync(bufB);

  const namesA = new Set(
    Object.keys(zipA.files).filter((k) => !zipA.files[k]?.dir)
  );
  const namesB = new Set(
    Object.keys(zipB.files).filter((k) => !zipB.files[k]?.dir)
  );
  const names = [...new Set([...namesA, ...namesB])];
  // eslint-disable-next-line unicorn/no-array-sort -- names is freshly constructed; in-place sort is safe and keeps lib at ES2022 (toSorted needs ES2023)
  const sortedNames = names.sort();

  const pairs = await Promise.all(
    sortedNames.map((name) => readPair(zipA, zipB, name))
  );

  let checkedFiles = 0;
  let textDiffs = 0;
  const diffs: string[] = [];
  for (const [idx, pair] of pairs.entries()) {
    if (pair.kind === "missing") {
      diffs.push(pair.line);
      continue;
    }
    checkedFiles += 1;
    if (pair.kind === "xml") {
      const res = compareXmlStrings(sortedNames[idx] ?? "", pair.a, pair.b);
      if (res.kind === "text") {
        textDiffs += 1;
      }
      if (res.kind === "format") {
        diffs.push(...res.lines);
      }
    } else {
      const line = compareBinaryBytes(sortedNames[idx] ?? "", pair.a, pair.b);
      if (line) {
        diffs.push(line);
      }
    }
    if (diffs.join("\n").length > 2000) {
      break;
    }
  }

  const pass = diffs.length === 0;
  return {
    checkedFiles,
    details: pass ? "" : diffs.join("\n"),
    pass,
    textDiffs,
  };
};
