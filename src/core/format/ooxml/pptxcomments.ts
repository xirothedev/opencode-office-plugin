import { readFileSync, writeFileSync } from "node:fs";

import JSZip from "jszip";
import { parseStringPromise, Builder } from "xml2js";

import {
  addRelationship,
  ensureContentType,
  partRelsPath,
  readRelationships,
  SUGGESTED_TEXT_PREFIX,
  OPENOFFICE_NS,
  OO_XMLNS_ATTR,
  OO_STATUS_ATTR,
  openofficeStatusAttributes,
  parseStatus,
} from "@/core/format/ooxml/parts";
import type { CommentStatus } from "@/core/format/ooxml/parts";

type XmlNode = Record<string, unknown>;

const asNode = (value: unknown): XmlNode | undefined =>
  typeof value === "object" && value !== null ? (value as XmlNode) : undefined;

const nodeArray = (value: unknown): XmlNode[] => {
  // ponytail: xml2js parses empty elements (<x/>) as "" — treat as absent, like the original falsy checks did
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return Array.isArray(value) ? (value as XmlNode[]) : [value as XmlNode];
};

const attrOf = (node: XmlNode, ...keys: string[]): string => {
  const attrs = asNode(node.$);
  if (!attrs) {
    return "";
  }
  for (const k of keys) {
    const v: unknown = attrs[k];
    if (typeof v === "string" && v !== "") {
      return v;
    }
  }
  return "";
};

const nodeText = (value: unknown): string =>
  typeof value === "string" ? value : "";

export interface PptxComment {
  id: string;
  author: string;
  text: string;
  timestamp: Date;
  slide: number;
  x: number;
  y: number;
  parentId: string | null;
  status: CommentStatus;
  suggestedText?: string | null;
  targetText?: string | null;
}

export type ApproveResult = "applied" | "not-found" | "no-suggestion";

const PRESENTATION_NS =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
const COMMENTS_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const COMMENTS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.comments+xml";
const COMMENT_AUTHORS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml";
const TARGET_TEXT_PREFIX = "Target text: ";

const COMMENT_ID_PATTERN = /^slide-(?<slide>\d+)-cm-(?<idx>\d+)$/u;

const splitSlideCommentId = (
  commentId: string
): { slideIndex: number; idx: string } | null => {
  const m = commentId.match(COMMENT_ID_PATTERN);
  const { slide = "", idx = "" } = m?.groups ?? {};
  if (idx === "") {
    return null;
  }
  return { idx, slideIndex: Math.trunc(Number(slide)) };
};

// ponytail: multi-line suggested text is truncated at the Target line; single-line covers real usage
const parseStoredSuggestion = (
  text: unknown
): { suggestedText: string | null; targetText: string | null } => {
  if (typeof text !== "string" || !text.startsWith(SUGGESTED_TEXT_PREFIX)) {
    return { suggestedText: null, targetText: null };
  }
  const sep = text.indexOf(`\n${TARGET_TEXT_PREFIX}`);
  if (sep === -1) {
    return {
      suggestedText: text.slice(SUGGESTED_TEXT_PREFIX.length),
      targetText: null,
    };
  }
  return {
    suggestedText: text.slice(SUGGESTED_TEXT_PREFIX.length, sep),
    targetText: text.slice(sep + TARGET_TEXT_PREFIX.length + 1),
  };
};

const normalizeForMatch = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/gu, " ").trim();

const shapeText = (shape: XmlNode): string => {
  const txBody = asNode(shape["p:txBody"]);
  if (!txBody) {
    return "";
  }
  const paras = nodeArray(txBody["a:p"]);
  const texts: string[] = [];
  for (const para of paras) {
    const runs = nodeArray(para["a:r"]);
    for (const run of runs) {
      if (typeof run["a:t"] === "string") {
        texts.push(run["a:t"]);
      }
    }
  }
  return texts.join(" ");
};

const matchesPptxIdx = (c: XmlNode, idx: string): boolean =>
  String(asNode(c.$)?.idx) === idx;

const loadPptxCommentsRoot = async (
  zip: JSZip
): Promise<{ commentsRoot: XmlNode; commentElements: XmlNode[] } | null> => {
  const commentsFile = zip.file("ppt/comments/comment1.xml");
  if (!commentsFile) {
    return null;
  }
  const parsed: XmlNode = await parseStringPromise(
    await commentsFile.async("string"),
    { explicitArray: false }
  );
  const commentsRoot = asNode(parsed["p:cmLst"]) ?? asNode(parsed.cmLst) ?? {};
  return { commentElements: nodeArray(commentsRoot["p:cm"]), commentsRoot };
};

const writePptxCommentsRoot = (zip: JSZip, commentsRoot: XmlNode): void => {
  const newCommentsXml = new Builder({
    headless: false,
    rootName: "p:cmLst",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(commentsRoot);
  zip.file("ppt/comments/comment1.xml", newCommentsXml);
};

const ensureAuthorList = (root: XmlNode): XmlNode[] => {
  if (!root["p:cmAuthor"] || !Array.isArray(root["p:cmAuthor"])) {
    root["p:cmAuthor"] = nodeArray(root["p:cmAuthor"]);
  }
  return root["p:cmAuthor"] as XmlNode[];
};

const ensureAuthor = async (zip: JSZip, author: string): Promise<number> => {
  const authorsPath = "ppt/commentAuthors.xml";
  const authorsFile = zip.file(authorsPath);
  let root: XmlNode;
  if (authorsFile) {
    const content = await authorsFile.async("string");
    const parsed: XmlNode = await parseStringPromise(content, {
      explicitArray: false,
    });
    root = asNode(parsed["p:cmAuthorLst"]) ?? asNode(parsed.cmAuthorLst) ?? {};
  } else {
    root = { $: { "xmlns:p": PRESENTATION_NS }, "p:cmAuthor": [] };
  }
  const list = ensureAuthorList(root);
  const existing = list.find((a) => attrOf(a, "name", "Name") === author);
  if (existing) {
    return Math.trunc(Number(attrOf(existing, "id")));
  }
  const newId = list.length;
  list.push({
    // oxlint-disable-next-line sort-keys -- key order is XML attribute order; PowerPoint convention (id, name, ...) is pinned by tests
    $: {
      id: String(newId),
      name: author,
      initials: author.charAt(0).toUpperCase(),
      lastIdx: "0",
      clrIdx: String(newId % 7),
    },
  });
  const xml = new Builder({
    headless: false,
    rootName: "p:cmAuthorLst",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(root);
  zip.file(authorsPath, xml);
  return newId;
};

const bumpAuthorLastIdx = async (
  zip: JSZip,
  authorId: number,
  lastIdx: number
): Promise<void> => {
  const authorsPath = "ppt/commentAuthors.xml";
  const authorsFile = zip.file(authorsPath);
  if (!authorsFile) {
    return;
  }
  const content = await authorsFile.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });
  const root = asNode(parsed["p:cmAuthorLst"]) ?? asNode(parsed.cmAuthorLst);
  const list = nodeArray(root?.["p:cmAuthor"]);
  const author = list.find((a) => String(asNode(a.$)?.id) === String(authorId));
  if (!author) {
    return;
  }
  const attrs = asNode(author.$) ?? {};
  attrs.lastIdx = String(lastIdx);
  author.$ = attrs;
  const xml = new Builder({
    headless: false,
    rootName: "p:cmAuthorLst",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(root);
  zip.file(authorsPath, xml);
};

const appendCommentElement = async (
  zip: JSZip,
  comment: PptxComment,
  authorId: number,
  storedText: string
): Promise<void> => {
  const commentsPath = "ppt/comments/comment1.xml";
  const commentsFile = zip.file(commentsPath);
  let root: XmlNode;
  if (commentsFile) {
    const content = await commentsFile.async("string");
    const parsed: XmlNode = await parseStringPromise(content, {
      explicitArray: false,
    });
    root = asNode(parsed["p:cmLst"]) ?? asNode(parsed.cmLst) ?? {};
  } else {
    root = { $: { "xmlns:p": PRESENTATION_NS }, "p:cm": [] };
  }
  if (!root["p:cm"] || !Array.isArray(root["p:cm"])) {
    root["p:cm"] = nodeArray(root["p:cm"]);
  }
  const list = root["p:cm"] as XmlNode[];
  const authorComments = list.filter(
    (c) => String(asNode(c.$)?.authorId) === String(authorId)
  );
  const idx = authorComments.length + 1;
  list.push({
    $: {
      authorId: String(authorId),
      dt: comment.timestamp.toISOString(),
      idx: String(idx),
      ...openofficeStatusAttributes(comment.status),
    },
    "p:pos": { $: { x: String(comment.x), y: String(comment.y) } },
    "p:text": storedText,
  });
  const xml = new Builder({
    headless: false,
    rootName: "p:cmLst",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(root);
  zip.file(commentsPath, xml);
  await bumpAuthorLastIdx(zip, authorId, idx);
};

const resolveSlidePart = async (
  zip: JSZip,
  slideIndex: number
): Promise<string> => {
  const presentationFile = zip.file("ppt/presentation.xml");
  if (!presentationFile) {
    throw new Error("presentation.xml not found in PPTX");
  }
  const content = await presentationFile.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });
  const root = asNode(parsed["p:presentation"]) ?? asNode(parsed.presentation);
  const slides = nodeArray(asNode(root?.["p:sldIdLst"])?.["p:sldId"]);
  const [firstSlide] = slides;
  if (!firstSlide && slides.length === 0) {
    throw new Error("No slides found in presentation");
  }
  const target = slides[slideIndex];
  if (!target) {
    throw new Error(
      `Slide ${slideIndex} not found (presentation has ${slides.length} slides)`
    );
  }
  const rid = attrOf(target, "r:id");
  const relationships = await readRelationships(
    zip,
    "ppt/_rels/presentation.xml.rels"
  );
  const rel = relationships.find((r) => r.id === rid);
  if (!rel) {
    throw new Error(`Slide relationship ${rid} not found`);
  }
  return `ppt/${rel.target}`;
};

const findSlideIndexForCommentsPart = async (zip: JSZip): Promise<number> => {
  const presentationFile = zip.file("ppt/presentation.xml");
  if (!presentationFile) {
    return -1;
  }
  const content = await presentationFile.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });
  const root = asNode(parsed["p:presentation"]) ?? asNode(parsed.presentation);
  const slideIds = asNode(root?.["p:sldIdLst"])?.["p:sldId"];
  if (!slideIds) {
    return -1;
  }
  const slides = nodeArray(slideIds);
  const presentationRels = await readRelationships(
    zip,
    "ppt/_rels/presentation.xml.rels"
  );
  const checks = await Promise.all(
    slides.map(async (slide, i) => {
      const rid = attrOf(slide, "r:id");
      const slideRel = presentationRels.find((r) => r.id === rid);
      if (!slideRel) {
        return -1;
      }
      const slidePart = `ppt/${slideRel.target}`;
      const slideRelsPath = partRelsPath(slidePart);
      const slideRels = await readRelationships(zip, slideRelsPath);
      return slideRels.some((r) => r.type === COMMENTS_REL_TYPE) ? i : -1;
    })
  );
  return checks.find((i) => i !== -1) ?? -1;
};

const readAuthors = async (zip: JSZip): Promise<Record<string, string>> => {
  const authorsFile = zip.file("ppt/commentAuthors.xml");
  if (!authorsFile) {
    return {};
  }
  const content = await authorsFile.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });
  const root = asNode(parsed["p:cmAuthorLst"]) ?? asNode(parsed.cmAuthorLst);
  if (!root?.["p:cmAuthor"]) {
    return {};
  }
  const elements = nodeArray(root["p:cmAuthor"]);
  const map: Record<string, string> = {};
  for (const a of elements) {
    map[String(asNode(a.$)?.id)] = attrOf(a, "name") || "Unknown";
  }
  return map;
};

const findTargetBox = (
  textShapes: XmlNode[],
  targetText?: string | null
): XmlNode | undefined => {
  if (!targetText) {
    const [firstShape] = textShapes;
    return firstShape;
  }
  const needle = normalizeForMatch(targetText);
  const target = textShapes.find((s) =>
    normalizeForMatch(shapeText(s)).includes(needle)
  );
  if (!target) {
    const previews = textShapes.map((s) =>
      JSON.stringify(shapeText(s).slice(0, 60))
    );
    throw new Error(
      `No text box on slide matches target ${JSON.stringify(targetText)}. Text boxes: ${previews.join(", ") || "(none)"}`
    );
  }
  return target;
};

const replaceTextBox = async (
  zip: JSZip,
  slidePart: string,
  suggestion: string,
  targetText?: string | null
): Promise<void> => {
  const slideFile = zip.file(slidePart);
  if (!slideFile) {
    throw new Error(`Slide part ${slidePart} not found`);
  }
  const content = await slideFile.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });
  const root = asNode(parsed["p:sld"]) ?? asNode(parsed.sld);
  const spTree = asNode(asNode(root?.["p:cSld"])?.["p:spTree"]);
  // ponytail: top-level p:sp only; recurse into groups if real decks hit it
  const shapes = nodeArray(spTree?.["p:sp"]);
  const textShapes = shapes.filter((s) => s["p:txBody"] !== undefined);
  const target = findTargetBox(textShapes, targetText);
  if (!target) {
    throw new Error("No text box found on slide");
  }
  const txBody = asNode(target["p:txBody"]) ?? {};
  const paras = nodeArray(txBody["a:p"]);
  if (paras.length === 0) {
    txBody["a:p"] = { "a:r": { "a:t": suggestion } };
  } else {
    const [firstPara] = paras;
    if (!firstPara) {
      throw new Error("No text box found on slide");
    }
    const runs = nodeArray(firstPara["a:r"]);
    if (runs.length === 0) {
      firstPara["a:r"] = { "a:t": suggestion };
    } else {
      const [firstRun] = runs;
      if (!firstRun) {
        throw new Error("No text box found on slide");
      }
      firstRun["a:t"] = suggestion;
      firstPara["a:r"] = firstRun;
      txBody["a:p"] = firstPara;
    }
  }
  const xml = new Builder({
    headless: false,
    rootName: "p:sld",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(root);
  zip.file(slidePart, xml);
};

export const writeComment = async (
  pptxPath: string,
  comment: PptxComment
): Promise<void> => {
  const data = readFileSync(pptxPath);
  const zip = await JSZip.loadAsync(data);

  const authorId = await ensureAuthor(zip, comment.author);
  let storedText = comment.suggestedText
    ? `${SUGGESTED_TEXT_PREFIX}${comment.suggestedText}`
    : comment.text;
  if (comment.suggestedText && comment.targetText) {
    storedText += `\n${TARGET_TEXT_PREFIX}${comment.targetText}`;
  }
  await appendCommentElement(zip, comment, authorId, storedText);

  const slidePart = await resolveSlidePart(zip, comment.slide);
  const slideRelsPath = partRelsPath(slidePart);
  await addRelationship(
    zip,
    slideRelsPath,
    COMMENTS_REL_TYPE,
    "../comments/comment1.xml"
  );
  await ensureContentType(
    zip,
    "/ppt/comments/comment1.xml",
    COMMENTS_CONTENT_TYPE
  );
  await ensureContentType(
    zip,
    "/ppt/commentAuthors.xml",
    COMMENT_AUTHORS_CONTENT_TYPE
  );

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(pptxPath, buffer);
};

export const readComments = async (
  pptxPath: string
): Promise<PptxComment[]> => {
  const data = readFileSync(pptxPath);
  const zip = await JSZip.loadAsync(data);

  const slideOfComments = await findSlideIndexForCommentsPart(zip);
  const authors = await readAuthors(zip);
  const commentsFile = zip.file("ppt/comments/comment1.xml");
  if (!commentsFile) {
    return [];
  }
  const content = await commentsFile.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });
  const root = asNode(parsed["p:cmLst"]) ?? asNode(parsed.cmLst);
  if (!root?.["p:cm"]) {
    return [];
  }
  const elements = nodeArray(root["p:cm"]);

  return elements.map((elem) => {
    const attrs = asNode(elem.$) ?? {};
    const authorId = nodeText(attrs.authorId ?? "0");
    const pos = asNode(elem["p:pos"] ?? elem.pos);
    const posAttrs = asNode(pos?.$) ?? {};
    const text = nodeText(elem["p:text"] ?? elem.text);
    const xRaw = nodeText(posAttrs.x);
    const yRaw = nodeText(posAttrs.y);
    return {
      author: authors[authorId] || "Unknown",
      id: `slide-${slideOfComments}-cm-${nodeText(attrs.idx)}`,
      parentId: null,
      slide: slideOfComments,
      status: parseStatus(attrs),
      text,
      timestamp: new Date(attrOf(elem, "dt") || Date.now()),
      x: xRaw === "" ? 0 : Math.trunc(Number(xRaw)),
      y: yRaw === "" ? 0 : Math.trunc(Number(yRaw)),
      ...parseStoredSuggestion(text),
    };
  });
};

export const applySlideSuggestion = async (
  pptxPath: string,
  commentId: string
): Promise<ApproveResult> => {
  const parts = splitSlideCommentId(commentId);
  if (!parts) {
    return "not-found";
  }
  const { slideIndex, idx } = parts;

  const data = readFileSync(pptxPath);
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadPptxCommentsRoot(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const target = commentElements.find((c) => matchesPptxIdx(c, idx));
  if (!target) {
    return "not-found";
  }
  const text = nodeText(target["p:text"] ?? target.text);
  const { suggestedText, targetText } = parseStoredSuggestion(text);
  if (suggestedText === null) {
    return "no-suggestion";
  }

  const slidePart = await resolveSlidePart(zip, slideIndex);
  await replaceTextBox(zip, slidePart, suggestedText, targetText);

  commentsRoot["p:cm"] = commentElements.filter((c) => c !== target);
  writePptxCommentsRoot(zip, commentsRoot);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(pptxPath, buffer);
  return "applied";
};

export const updateComment = async (
  pptxPath: string,
  commentId: string,
  update: { text?: string; suggestedText?: string }
): Promise<"updated" | "not-found"> => {
  const parts = splitSlideCommentId(commentId);
  if (!parts) {
    return "not-found";
  }
  const { idx } = parts;

  const data = readFileSync(pptxPath);
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadPptxCommentsRoot(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const target = commentElements.find((c) => matchesPptxIdx(c, idx));
  if (!target) {
    return "not-found";
  }
  // Keep the existing Target text line so approve still picks the right box.
  const current = parseStoredSuggestion(
    nodeText(target["p:text"] ?? target.text)
  );
  let storedText: string;
  if (update.suggestedText === undefined) {
    storedText = update.text ?? "";
  } else {
    storedText = `${SUGGESTED_TEXT_PREFIX}${update.suggestedText}`;
    if (current.targetText) {
      storedText += `\n${TARGET_TEXT_PREFIX}${current.targetText}`;
    }
  }
  if (target["p:text"] === undefined) {
    target.text = storedText;
  } else {
    target["p:text"] = storedText;
  }
  writePptxCommentsRoot(zip, commentsRoot);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(pptxPath, buffer);
  return "updated";
};

export const deleteComment = async (
  pptxPath: string,
  commentId: string
): Promise<"deleted" | "not-found"> => {
  const parts = splitSlideCommentId(commentId);
  if (!parts) {
    return "not-found";
  }
  const { idx } = parts;

  const data = readFileSync(pptxPath);
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadPptxCommentsRoot(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const target = commentElements.find((c) => matchesPptxIdx(c, idx));
  if (!target) {
    return "not-found";
  }
  commentsRoot["p:cm"] = commentElements.filter((c) => c !== target);
  writePptxCommentsRoot(zip, commentsRoot);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(pptxPath, buffer);
  return "deleted";
};

export const setCommentStatus = async (
  pptxPath: string,
  commentId: string,
  status: CommentStatus
): Promise<"ok" | "not-found"> => {
  const parts = splitSlideCommentId(commentId);
  if (!parts) {
    return "not-found";
  }
  const { idx } = parts;

  const data = readFileSync(pptxPath);
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadPptxCommentsRoot(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const target = commentElements.find((c) => matchesPptxIdx(c, idx));
  if (!target) {
    return "not-found";
  }
  const currentAttrs = asNode(target.$) ?? {};
  const nextAttrs: XmlNode = {};
  for (const [k, v] of Object.entries(currentAttrs)) {
    if (k === OO_STATUS_ATTR || k === OO_XMLNS_ATTR) {
      continue;
    }
    nextAttrs[k] = v;
  }
  if (status !== "open") {
    nextAttrs[OO_XMLNS_ATTR] = OPENOFFICE_NS;
    nextAttrs[OO_STATUS_ATTR] = status;
  }
  target.$ = nextAttrs;
  writePptxCommentsRoot(zip, commentsRoot);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(pptxPath, buffer);
  return "ok";
};
