import { readFileSync, writeFileSync } from "node:fs";

import JSZip from "jszip";
import { parseStringPromise, Builder } from "xml2js";

import {
  addRelationship,
  ensureContentType,
  escapeXml,
  partRelsPath,
  parseSuggestion,
  readRelationships,
  resolveTarget,
  SUGGESTED_VALUE_PREFIX,
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

export interface XlsxComment {
  id: string;
  author: string;
  text: string;
  timestamp: Date;
  cellRef: string;
  parentId: string | null;
  status: CommentStatus;
  suggestedText?: string | null;
}

export type ApproveResult = "applied" | "not-found" | "no-suggestion";

const SHEET_MAIN_NS =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const COMMENTS_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const VML_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing";
const COMMENTS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml";
const VML_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.vmlDrawing";

const COMMENT_ID_PATTERN = /^(?<cell>[A-Z]+[0-9]+)-(?<author>\d+)$/u;

const splitCommentId = (
  commentId: string
): { cellRef: string; authorId: string } | null => {
  const m = commentId.match(COMMENT_ID_PATTERN);
  const { cell: cellRef = "", author: authorId = "" } = m?.groups ?? {};
  if (cellRef === "") {
    return null;
  }
  return { authorId, cellRef };
};

const matchesXlsxTarget = (
  c: XmlNode,
  cellRef: string,
  authorId: string
): boolean => {
  const attrs = asNode(c.$);
  return (
    (attrs?.ref ?? attrs?.cellRef) === cellRef &&
    String(attrs?.authorId) === authorId
  );
};

const textOf = (node: unknown): string => {
  if (typeof node === "string") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }
  const obj = asNode(node);
  if (obj && typeof obj._ === "string") {
    return obj._;
  }
  return "";
};

const extractCommentText = (textElem: unknown): string => {
  const elem = asNode(textElem);
  if (!elem) {
    return "";
  }
  const runs = nodeArray(elem.r);
  if (runs.length > 0) {
    return runs.map((r) => textOf(r.t)).join("");
  }
  return textOf(elem.t);
};

const cellRefToIndices = (cellRef: string): { row: number; col: number } => {
  const match = cellRef.match(/^(?<letters>[A-Z]+)(?<digits>\d+)$/u);
  const { letters = "", digits = "" } = match?.groups ?? {};
  if (letters === "" || digits === "") {
    return { col: 0, row: 0 };
  }
  let col = 0;
  for (const ch of letters) {
    col = col * 26 + ((ch.codePointAt(0) ?? 0) - 64);
  }
  return { col: col - 1, row: Math.trunc(Number(digits)) - 1 };
};

const loadXlsxCommentsRoot = async (
  zip: JSZip
): Promise<{ commentsRoot: XmlNode; commentElements: XmlNode[] } | null> => {
  const commentsFile = zip.file("xl/comments1.xml");
  if (!commentsFile) {
    return null;
  }
  const parsed: XmlNode = await parseStringPromise(
    await commentsFile.async("string"),
    { explicitArray: false }
  );
  const commentsRoot =
    asNode(parsed.comments) ?? asNode(parsed["x:comments"]) ?? {};
  const listNode = asNode(commentsRoot.commentList)?.comment;
  return { commentElements: nodeArray(listNode), commentsRoot };
};

const writeXlsxCommentsRoot = (zip: JSZip, commentsRoot: XmlNode): void => {
  const xml = new Builder({
    headless: false,
    rootName: "comments",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(commentsRoot);
  zip.file("xl/comments1.xml", xml);
};

const ensureAuthor = async (zip: JSZip, author: string): Promise<number> => {
  const commentsFile = zip.file("xl/comments1.xml");
  let root: XmlNode;
  if (commentsFile) {
    const content = await commentsFile.async("string");
    const parsed: XmlNode = await parseStringPromise(content, {
      explicitArray: false,
    });
    root = asNode(parsed.comments) ?? asNode(parsed["x:comments"]) ?? {};
  } else {
    root = {
      $: { xmlns: SHEET_MAIN_NS },
      authors: { author: [] },
      commentList: { comment: [] },
    };
  }
  const authorsNode = asNode(root.authors) ?? {};
  if (!asNode(root.authors)) {
    root.authors = authorsNode;
  }
  let authors = authorsNode.author;
  if (!Array.isArray(authors)) {
    authors = authors === undefined ? [] : [authors];
    authorsNode.author = authors;
  }
  const authorList = authors as unknown[];
  const existingIndex = authorList.indexOf(author);
  if (existingIndex !== -1) {
    return existingIndex;
  }
  authorList.push(author);
  const newIndex = authorList.length - 1;
  const xml = new Builder({
    headless: false,
    rootName: "comments",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(root);
  zip.file("xl/comments1.xml", xml);
  return newIndex;
};

const appendCommentElement = async (
  zip: JSZip,
  comment: XlsxComment,
  authorId: number,
  storedText: string
): Promise<void> => {
  const commentsFile = zip.file("xl/comments1.xml");
  let root: XmlNode;
  if (commentsFile) {
    const content = await commentsFile.async("string");
    const parsed: XmlNode = await parseStringPromise(content, {
      explicitArray: false,
    });
    root = asNode(parsed.comments) ?? asNode(parsed["x:comments"]) ?? {};
  } else {
    root = {
      $: { xmlns: SHEET_MAIN_NS },
      authors: { author: [] },
      commentList: { comment: [] },
    };
  }
  const listNode = asNode(root.commentList) ?? {};
  if (!asNode(root.commentList)) {
    root.commentList = listNode;
  }
  const list = nodeArray(listNode.comment);
  listNode.comment = list;
  list.push({
    $: {
      authorId: String(authorId),
      ref: comment.cellRef,
      ...openofficeStatusAttributes(comment.status),
    },
    text: { t: storedText },
  });
  const xml = new Builder({
    headless: false,
    rootName: "comments",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(root);
  zip.file("xl/comments1.xml", xml);
};

const resolveFirstSheetPart = async (zip: JSZip): Promise<string> => {
  const workbookFile = zip.file("xl/workbook.xml");
  if (!workbookFile) {
    throw new Error("workbook.xml not found in XLSX");
  }
  const content = await workbookFile.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });
  const workbook = asNode(parsed.workbook) ?? asNode(parsed["x:workbook"]);
  const sheets = nodeArray(asNode(workbook?.sheets)?.sheet);
  const [firstSheet] = sheets;
  if (!firstSheet) {
    throw new Error("No sheets found in workbook");
  }
  const rid = attrOf(firstSheet, "r:id", "id");
  const relationships = await readRelationships(
    zip,
    "xl/_rels/workbook.xml.rels"
  );
  const rel = relationships.find((r) => r.id === rid);
  if (!rel) {
    throw new Error(`Sheet relationship ${rid} not found`);
  }
  return `xl/${rel.target}`;
};

const ensureLegacyDrawing = async (
  zip: JSZip,
  sheetPart: string,
  vmlRelId: string
): Promise<void> => {
  const sheetFile = zip.file(sheetPart);
  if (!sheetFile) {
    throw new Error(`Sheet part ${sheetPart} not found`);
  }
  const content = await sheetFile.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });
  const root = asNode(parsed.worksheet) ?? asNode(parsed["x:worksheet"]);
  if (!root) {
    throw new Error("Could not find worksheet root element");
  }
  if (root.legacyDrawing !== undefined) {
    return;
  }
  const legacyDrawing = { $: { "r:id": vmlRelId } };
  const ordered: XmlNode = {};
  let inserted = false;
  for (const key of Object.keys(root)) {
    if (!inserted && (key === "drawing" || key === "extLst")) {
      ordered.legacyDrawing = legacyDrawing;
      inserted = true;
    }
    ordered[key] = root[key];
  }
  if (!inserted) {
    ordered.legacyDrawing = legacyDrawing;
  }
  const xml = new Builder({
    headless: false,
    rootName: "worksheet",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(ordered);
  zip.file(sheetPart, xml);
};

const resolveVmlPath = async (
  zip: JSZip,
  sheetPart: string,
  sheetRelsPath: string
): Promise<string> => {
  const sheetFile = zip.file(sheetPart);
  if (sheetFile) {
    const content = await sheetFile.async("string");
    const parsed: XmlNode = await parseStringPromise(content, {
      explicitArray: false,
    });
    const root = asNode(parsed.worksheet) ?? asNode(parsed["x:worksheet"]);
    const legacyDrawing = asNode(root?.legacyDrawing);
    const relId = attrOf(legacyDrawing ?? {}, "r:id");
    if (relId !== "") {
      const relationships = await readRelationships(zip, sheetRelsPath);
      const rel = relationships.find((r) => r.id === relId);
      if (rel) {
        const dir = sheetPart.slice(0, sheetPart.lastIndexOf("/"));
        return resolveTarget(dir, rel.target);
      }
    }
  }
  return `xl/drawings/vmlDrawing1.vml`;
};

const appendVmlShape = async (
  zip: JSZip,
  vmlPath: string,
  comment: XlsxComment,
  storedText: string
): Promise<void> => {
  const existing = zip.file(vmlPath);
  let body = existing ? await existing.async("string") : "";
  const shapeCount = (body.match(/<v:shape /gu) || []).length;
  const ids = [...body.matchAll(/_x0000_s(?<num>\d+)/gu)].map((m) =>
    Math.trunc(Number(m.groups?.num))
  );
  const shapeId = `_x0000_s${ids.length > 0 ? Math.max(...ids) + 1 : 1025}`;
  const { row, col } = cellRefToIndices(comment.cellRef);
  const shape = `<v:shape id="${shapeId}" type="#_x0000_t202" style="position:absolute;margin-left:0;margin-top:0;width:96pt;height:55.5pt;z-index:${shapeCount + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left">${escapeXml(storedText)}</div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>1, 15, ${row}, 2, 3, 15, ${row + 4}, 16</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${row}</x:Row><x:Column>${col}</x:Column></x:ClientData></v:shape>`;
  body = body
    ? body.replace("</xml>", `${shape}</xml>`)
    : `<?xml version="1.0" encoding="UTF-8"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">${shape}</xml>`;
  zip.file(vmlPath, body);
};

const writeCellValue = async (
  zip: JSZip,
  sheetPart: string,
  cellRef: string,
  value: string
): Promise<void> => {
  const sheetFile = zip.file(sheetPart);
  if (!sheetFile) {
    throw new Error(`Sheet part ${sheetPart} not found`);
  }
  const content = await sheetFile.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });
  const root = asNode(parsed.worksheet) ?? asNode(parsed["x:worksheet"]);
  if (!root) {
    throw new Error("Could not find worksheet root element");
  }
  const sheetData = asNode(root.sheetData) ?? {};
  if (!asNode(root.sheetData)) {
    root.sheetData = sheetData;
  }
  const rowList = nodeArray(sheetData.row);
  sheetData.row = rowList;
  const { row } = cellRefToIndices(cellRef);
  let targetRow = rowList.find(
    (r) => nodeText(asNode(r.$)?.r) === String(row + 1)
  );
  if (!targetRow) {
    targetRow = { $: { r: String(row + 1) }, c: [] };
    rowList.push(targetRow);
  }
  const cellList = nodeArray(targetRow.c);
  targetRow.c = cellList;
  const existingIndex = cellList.findIndex((c) => attrOf(c, "r") === cellRef);
  const isNumeric = /^-?\d+(?<frac>\.\d+)?$/u.test(value);
  const newCell = isNumeric
    ? { $: { r: cellRef }, v: value }
    : { $: { r: cellRef, t: "inlineStr" }, is: { t: value } };
  if (existingIndex === -1) {
    cellList.push(newCell);
  } else {
    cellList.splice(existingIndex, 1, newCell);
  }

  const xml = new Builder({
    headless: false,
    rootName: "worksheet",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(root);
  zip.file(sheetPart, xml);
};

const removeVmlShapeForCell = async (
  zip: JSZip,
  cellRef: string,
  commentText: string
): Promise<void> => {
  const vmlPath = "xl/drawings/vmlDrawing1.vml";
  const existing = zip.file(vmlPath);
  if (!existing) {
    return;
  }
  const { row, col } = cellRefToIndices(cellRef);
  const body = await existing.async("string");
  const escapedText = escapeXml(commentText);
  const kept = body
    .split(/(?=<v:shape )/u)
    .filter((block: string) => {
      if (!block.startsWith("<v:shape ")) {
        return true;
      }
      const hasRow = block.includes(`<x:Row>${row}</x:Row>`);
      const hasCol = block.includes(`<x:Column>${col}</x:Column>`);
      const hasText = block.includes(escapedText);
      return !(hasRow && hasCol && hasText);
    })
    .join("");
  if (kept !== body) {
    zip.file(vmlPath, kept);
  }
};

export const writeComment = async (
  xlsxPath: string,
  comment: XlsxComment
): Promise<void> => {
  const data = readFileSync(xlsxPath);
  const zip = await JSZip.loadAsync(data);

  const authorId = await ensureAuthor(zip, comment.author);
  const storedText = comment.suggestedText
    ? `${SUGGESTED_VALUE_PREFIX}${comment.suggestedText}`
    : comment.text;
  await appendCommentElement(zip, comment, authorId, storedText);

  const sheetPart = await resolveFirstSheetPart(zip);
  const sheetRelsPath = partRelsPath(sheetPart);
  await addRelationship(
    zip,
    sheetRelsPath,
    COMMENTS_REL_TYPE,
    "../comments1.xml"
  );
  const vmlRelId = await addRelationship(
    zip,
    sheetRelsPath,
    VML_REL_TYPE,
    "../drawings/vmlDrawing1.vml"
  );
  const vmlPath = await resolveVmlPath(zip, sheetPart, sheetRelsPath);
  await ensureLegacyDrawing(zip, sheetPart, vmlRelId);
  await appendVmlShape(zip, vmlPath, comment, storedText);
  await ensureContentType(zip, "/xl/comments1.xml", COMMENTS_CONTENT_TYPE);
  await ensureContentType(zip, `/${vmlPath}`, VML_CONTENT_TYPE);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(xlsxPath, buffer);
};

export const readComments = async (
  xlsxPath: string
): Promise<XlsxComment[]> => {
  const data = readFileSync(xlsxPath);
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadXlsxCommentsRoot(zip);
  if (!loaded) {
    return [];
  }
  const { commentsRoot, commentElements } = loaded;
  const authorsNode = asNode(commentsRoot.authors)?.author;
  const authorList = nodeArray(authorsNode).map(nodeText);

  return commentElements.map((elem) => {
    const attrs = asNode(elem.$) ?? {};
    const authorId = Math.trunc(Number(attrs.authorId ?? attrs.author));
    const text = extractCommentText(elem.text);
    return {
      author: authorList[authorId] || "Unknown",
      cellRef: nodeText(attrs.ref),
      id: nodeText(attrs.id) || `${nodeText(attrs.ref)}-${authorId}`,
      parentId: null,
      status: parseStatus(attrs),
      suggestedText: parseSuggestion(text, SUGGESTED_VALUE_PREFIX),
      text,
      timestamp: new Date(),
    };
  });
};

export const applyCellSuggestion = async (
  xlsxPath: string,
  commentId: string
): Promise<ApproveResult> => {
  const parts = splitCommentId(commentId);
  if (!parts) {
    return "not-found";
  }
  const { cellRef, authorId } = parts;

  const data = readFileSync(xlsxPath);
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadXlsxCommentsRoot(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const target = commentElements.find((c) =>
    matchesXlsxTarget(c, cellRef, authorId)
  );
  if (!target) {
    return "not-found";
  }
  const text = extractCommentText(target.text);
  const suggestion = parseSuggestion(text, SUGGESTED_VALUE_PREFIX);
  if (suggestion === null) {
    return "no-suggestion";
  }

  const sheetPart = await resolveFirstSheetPart(zip);
  await writeCellValue(zip, sheetPart, cellRef, suggestion);

  const listNode = asNode(commentsRoot.commentList) ?? {};
  listNode.comment = commentElements.filter((c) => c !== target);
  writeXlsxCommentsRoot(zip, commentsRoot);

  await removeVmlShapeForCell(zip, cellRef, text);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(xlsxPath, buffer);
  return "applied";
};

export const updateComment = async (
  xlsxPath: string,
  commentId: string,
  update: { text?: string; suggestedText?: string }
): Promise<"updated" | "not-found"> => {
  const parts = splitCommentId(commentId);
  if (!parts) {
    return "not-found";
  }
  const { cellRef, authorId } = parts;

  const data = readFileSync(xlsxPath);
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadXlsxCommentsRoot(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const target = commentElements.find((c) =>
    matchesXlsxTarget(c, cellRef, authorId)
  );
  if (!target) {
    return "not-found";
  }
  // ponytail: a suggestion replaces the note text, same convention as writeComment
  const storedText =
    update.suggestedText === undefined
      ? (update.text ?? "")
      : `${SUGGESTED_VALUE_PREFIX}${update.suggestedText}`;
  target.text = { t: storedText };
  writeXlsxCommentsRoot(zip, commentsRoot);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(xlsxPath, buffer);
  return "updated";
};

export const deleteComment = async (
  xlsxPath: string,
  commentId: string
): Promise<"deleted" | "not-found"> => {
  const parts = splitCommentId(commentId);
  if (!parts) {
    return "not-found";
  }
  const { cellRef } = parts;

  const data = readFileSync(xlsxPath);
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadXlsxCommentsRoot(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const target = commentElements.find((c) =>
    matchesXlsxTarget(c, cellRef, parts.authorId)
  );
  if (!target) {
    return "not-found";
  }
  const text = extractCommentText(target.text);
  const listNode = asNode(commentsRoot.commentList) ?? {};
  listNode.comment = commentElements.filter((c) => c !== target);
  writeXlsxCommentsRoot(zip, commentsRoot);
  await removeVmlShapeForCell(zip, cellRef, text);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(xlsxPath, buffer);
  return "deleted";
};

export const setCommentStatus = async (
  xlsxPath: string,
  commentId: string,
  status: CommentStatus
): Promise<"ok" | "not-found"> => {
  const parts = splitCommentId(commentId);
  if (!parts) {
    return "not-found";
  }
  const { cellRef, authorId } = parts;

  const data = readFileSync(xlsxPath);
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadXlsxCommentsRoot(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const target = commentElements.find((c) =>
    matchesXlsxTarget(c, cellRef, authorId)
  );
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
  writeXlsxCommentsRoot(zip, commentsRoot);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(xlsxPath, buffer);
  return "ok";
};
