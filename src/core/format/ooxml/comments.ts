import { readFileSync, writeFileSync } from "node:fs";

import JSZip from "jszip";
import { parseStringPromise, Builder } from "xml2js";

import {
  SUGGESTED_TEXT_PREFIX,
  parseSuggestion,
  OPENOFFICE_NS,
  OO_XMLNS_ATTR,
  OO_STATUS_ATTR,
  OO_ORIG_ID_ATTR,
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

const childNode = (node: XmlNode, key: string): XmlNode | undefined =>
  asNode(node[key]);

const nodeText = (value: unknown): string =>
  typeof value === "string" ? value : "";

// ponytail: w:id must be integer for ECMA-376 — map "c2" → "2", keep orig in oo:origId for logical id
const numericWId = (id: string): string => {
  const m = id.match(/\d+/u);
  if (m) {
    return m[0];
  }
  return String(
    Math.abs([...id].reduce((a, c) => a + (c.codePointAt(0) ?? 0), 0)) % 10_000
  );
};
const isZipBuffer = (buf: Uint8Array): boolean =>
  buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;

const nextRelationshipId = (relsXml: string): number => {
  const matches = [...relsXml.matchAll(/Id="rId(?<rid>\d+)"/gu)];
  const nums = matches.map((x) => Math.trunc(Number(x.groups?.rid)));
  return nums.length > 0 ? Math.max(...nums) + 1 : 7;
};

const matchesCommentId = (
  node: XmlNode,
  commentId: string,
  nid: string
): boolean => {
  const attrs = asNode(node.$);
  return (
    attrs?.[OO_ORIG_ID_ATTR] === commentId ||
    attrs?.["w:id"] === commentId ||
    attrs?.["w:id"] === nid ||
    attrs?.id === commentId
  );
};

const commentBodyText = (elem: XmlNode): unknown =>
  childNode(childNode(elem, "w:p") ?? {}, "w:r")?.["w:t"];

const elemTimestamp = (elem: XmlNode): Date =>
  new Date(attrOf(elem, "w:date", "date"));

const markerMatches = (
  value: unknown,
  commentId: string,
  nid: string
): boolean => {
  const node = asNode(value);
  if (!node) {
    return false;
  }
  return matchesCommentId(node, commentId, nid);
};

export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: Date;
  rangeStart: { paragraph: number; offset: number };
  rangeEnd: { paragraph: number; offset: number };
  parentId: string | null;
  status: CommentStatus;
  suggestedText?: string | null;
}

export type ApproveResult = "applied" | "not-found" | "no-suggestion";

const loadCommentsTree = async (zip: JSZip): Promise<XmlNode> => {
  const commentsXml = zip.file("word/comments.xml");
  if (!commentsXml) {
    return {
      comments: {
        $: {
          "xmlns:w":
            "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        },
        "w:comment": [],
      },
    };
  }
  const content = await commentsXml.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });
  // files written by this plugin have root "w:comments"; accept either
  const root = asNode(parsed.comments) ?? asNode(parsed["w:comments"]) ?? {};
  const wList = nodeArray(root["w:comment"]);
  const legacyList = nodeArray(root.comment);
  // keep legacy key for compat: merge legacy items only when w:comment is empty, then drop the key
  const list = wList.length > 0 ? wList : [...wList, ...legacyList];
  const { comment: _legacy, ...rest } = root;
  void _legacy;
  return { comments: { ...rest, "w:comment": list } };
};

const COMMENT_PARTS = [
  {
    ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
    part: "/word/comments.xml",
    relTarget: "comments.xml",
    relType:
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  },
  {
    ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml",
    part: "/word/commentsExtended.xml",
    relTarget: "commentsExtended.xml",
    relType:
      "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
  },
  {
    ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml",
    part: "/word/commentsIds.xml",
    relTarget: "commentsIds.xml",
    relType:
      "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds",
  },
  {
    ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml",
    part: "/word/commentsExtensible.xml",
    relTarget: "commentsExtensible.xml",
    relType:
      "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible",
  },
];

const ensureCtAndRels = async (zip: JSZip): Promise<void> => {
  const ctFile = zip.file("[Content_Types].xml");
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (ctFile) {
    let ct = await ctFile.async("string");
    let changed = false;
    for (const n of COMMENT_PARTS) {
      if (!ct.includes(`PartName="${n.part}"`)) {
        ct = ct.replace(
          "</Types>",
          `<Override PartName="${n.part}" ContentType="${n.ct}"/></Types>`
        );
        changed = true;
      }
    }
    if (changed) {
      zip.file("[Content_Types].xml", ct);
    }
  }
  if (relsFile) {
    let rels = await relsFile.async("string");
    let changed = false;
    for (const n of COMMENT_PARTS) {
      if (!rels.includes(`Target="${n.relTarget}"`)) {
        const nextId = nextRelationshipId(rels);
        rels = rels.replace(
          "</Relationships>",
          `<Relationship Id="rId${nextId}" Type="${n.relType}" Target="${n.relTarget}"/></Relationships>`
        );
        changed = true;
      }
    }
    if (changed) {
      zip.file("word/_rels/document.xml.rels", rels);
    }
  }
  // ensure the 3 extended xml files exist (copy from template if missing) — Word needs them even if empty
  const templateMap: Record<string, string> = {
    "word/commentsExtended.xml":
      "skills/docx/scripts/templates/commentsExtended.xml",
    "word/commentsExtensible.xml":
      "skills/docx/scripts/templates/commentsExtensible.xml",
    "word/commentsIds.xml": "skills/docx/scripts/templates/commentsIds.xml",
  };
  for (const [zipPath, tmpl] of Object.entries(templateMap)) {
    if (!zip.file(zipPath)) {
      try {
        const tmplContent = readFileSync(tmpl, "utf-8");
        zip.file(zipPath, tmplContent);
      } catch {
        // template is optional — skip when missing
      }
      // also try isolated-workspace path
      try {
        const tmpl2 = `tests/isolated-workspace/${tmpl}`;
        const tmplContent2 = readFileSync(tmpl2, "utf-8");
        if (!zip.file(zipPath)) {
          zip.file(zipPath, tmplContent2);
        }
      } catch {
        // template is optional — skip when missing
      }
    }
  }
};

const seedExtendedParts = async (
  zip: JSZip,
  paraId: string,
  durableId: string
): Promise<void> => {
  // also seed the extended comment files with an entry for this comment (Word modern comments need it) — reuse same paraId/durableId as comment
  try {
    const ext = zip.file("word/commentsExtended.xml");
    if (ext) {
      let xml = await ext.async("string");
      if (!xml.includes(`w15:paraId="${paraId}"`)) {
        xml = xml.replace(
          "</w15:commentsEx>",
          `<w15:commentEx w15:paraId="${paraId}" w15:done="0"/></w15:commentsEx>`
        );
        zip.file("word/commentsExtended.xml", xml);
      }
    }
    const ids = zip.file("word/commentsIds.xml");
    if (ids) {
      let xml = await ids.async("string");
      if (!xml.includes(`w16cid:paraId="${paraId}"`)) {
        xml = xml.replace(
          "</w16cid:commentsIds>",
          `<w16cid:commentId w16cid:paraId="${paraId}" w16cid:durableId="${durableId}"/></w16cid:commentsIds>`
        );
        zip.file("word/commentsIds.xml", xml);
      }
    }
    const extble = zip.file("word/commentsExtensible.xml");
    if (extble) {
      let xml = await extble.async("string");
      if (!xml.includes(`w16cex:durableId="${durableId}"`)) {
        xml = xml.replace(
          "</w16cex:commentsExtensible>",
          `<w16cex:commentExtensible w16cex:durableId="${durableId}"/></w16cex:commentsExtensible>`
        );
        zip.file("word/commentsExtensible.xml", xml);
      }
    }
  } catch {
    // best-effort seeding — skip when extended parts are absent
  }
};

const insertRangeMarkers = (
  docContent: string,
  wid: string,
  paraIndex: number
): string | null => {
  // Find nth w:p
  const paraRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/gu;
  let idx = 0;
  let m: RegExpExecArray | null;
  let lastIdx = 0;
  let out = "";
  let found = false;
  while ((m = paraRegex.exec(docContent)) !== null) {
    if (idx === paraIndex) {
      const [full] = m;
      let para = full ?? "";
      const pPrEnd = para.indexOf("</w:pPr>");
      const insertPos =
        pPrEnd === -1 ? para.indexOf(">") + 1 : pPrEnd + "</w:pPr>".length;
      const startMarker = `<w:commentRangeStart w:id="${wid}"/>`;
      const endMarker = `<w:commentRangeEnd w:id="${wid}"/>`;
      const refRun = `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${wid}"/></w:r>`;
      para = para.slice(0, insertPos) + startMarker + para.slice(insertPos);
      const closeIdx = para.lastIndexOf("</w:p>");
      para =
        para.slice(0, closeIdx) + endMarker + refRun + para.slice(closeIdx);
      out += docContent.slice(lastIdx, m.index) + para;
      lastIdx = paraRegex.lastIndex;
      found = true;
    }
    idx += 1;
  }
  if (!found) {
    return null;
  }
  out += docContent.slice(lastIdx);
  return out;
};

export const writeComment = async (
  docPath: string,
  comment: Comment
): Promise<void> => {
  const data = readFileSync(docPath);
  const zip = await JSZip.loadAsync(data);

  // Read or create comments.xml
  const commentsObj = await loadCommentsTree(zip);
  const comments = asNode(commentsObj.comments) ?? {};

  // Add comment to comments.xml
  const storedText = comment.suggestedText
    ? `${SUGGESTED_TEXT_PREFIX}${comment.suggestedText}`
    : comment.text;
  // resolved rides the standard w:done attribute; denied has no OOXML standard,
  // so it uses the plugin namespace declared locally on the element (parts.ts).
  const statusAttrs =
    comment.status === "resolved"
      ? { "w:done": "1" }
      : openofficeStatusAttributes(comment.status);
  const nid = numericWId(comment.id);
  const origAttr =
    nid === comment.id
      ? {}
      : { [OO_ORIG_ID_ATTR]: comment.id, [OO_XMLNS_ATTR]: OPENOFFICE_NS };
  // ponytail: Word modern comments need w14:paraId/durableId linking — generate once, reuse for comment + extended files
  const paraId = Math.floor(Math.random() * 0x7f_ff_ff_fe)
    .toString(16)
    .padStart(8, "0")
    .toUpperCase();
  const durableId = Math.floor(Math.random() * 0x7f_ff_ff_fe)
    .toString(16)
    .padStart(8, "0")
    .toUpperCase();
  const commentElement = {
    $: {
      "w:author": comment.author,
      "w:date": comment.timestamp.toISOString(),
      "w:id": nid,
      "w:initials": comment.author.charAt(0).toUpperCase(),
      ...origAttr,
      ...statusAttrs,
    },
    "w:p": {
      $: { "w14:paraId": paraId, "w14:textId": "77777777" },
      "w:r": {
        "w:t": storedText,
      },
    },
  };

  const list = comments["w:comment"];
  if (!Array.isArray(list)) {
    const cur = comments["w:comment"] ?? comments.comment;
    comments["w:comment"] = nodeArray(cur);
    if (comments.comment !== undefined) {
      delete comments.comment;
    }
  }
  nodeArray(comments["w:comment"]).push(commentElement);

  // Write comments.xml back
  const builder = new Builder({
    headless: false,
    rootName: "w:comments",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  });
  // Build from the inner structure, rootName will wrap it
  const commentsContent = commentsObj.comments;
  const newCommentsXml = builder.buildObject(commentsContent);
  zip.file("word/comments.xml", newCommentsXml);

  // Ensure [Content_Types].xml and rels for all comment parts (Word modern comments need all 4)
  await ensureCtAndRels(zip);
  await seedExtendedParts(zip, paraId, durableId);

  // Read document.xml and add comment range markers — string-based to keep markers as direct w:p children (never inside w:r)
  const documentXml = zip.file("word/document.xml");
  if (documentXml) {
    const docContent = await documentXml.async("string");
    const wid = numericWId(comment.id);
    const marked = insertRangeMarkers(
      docContent,
      wid,
      comment.rangeStart.paragraph
    );
    if (marked === null) {
      // fallback: no para found, keep original
      zip.file("word/document.xml", docContent);
    } else {
      zip.file("word/document.xml", marked);
    }
  }

  // Write back to file
  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(docPath, buffer);
};

export const readComments = async (docPath: string): Promise<Comment[]> => {
  const data = readFileSync(docPath);
  // ponytail: edit after comment overwrites zip with markdown — not a zip, no comments
  if (data.length < 2 || data[0] !== 0x50 || data[1] !== 0x4b) {
    return [];
  }
  const zip = await JSZip.loadAsync(data);

  const commentsXml = zip.file("word/comments.xml");
  if (!commentsXml) {
    return [];
  }

  const content = await commentsXml.async("string");
  const parsed: XmlNode = await parseStringPromise(content, {
    explicitArray: false,
  });

  // Handle namespace variations
  const commentsRoot = asNode(parsed.comments) ?? asNode(parsed["w:comments"]);
  const raw = commentsRoot?.["w:comment"] ?? commentsRoot?.comment;
  if (!commentsRoot || !raw) {
    return [];
  }

  const commentElements = nodeArray(raw);

  return commentElements.map((elem) => {
    const text = commentBodyText(elem);
    const attrs = asNode(elem.$) ?? {};
    return {
      author: nodeText(attrs["w:author"] ?? attrs.author),
      id: nodeText(attrs[OO_ORIG_ID_ATTR] ?? attrs["w:id"] ?? attrs.id),
      parentId: null,
      rangeEnd: { offset: 0, paragraph: 0 },
      // Simplified - real impl needs to parse markers
      rangeStart: { offset: 0, paragraph: 0 },
      status: parseStatus(attrs),
      suggestedText: parseSuggestion(nodeText(text), SUGGESTED_TEXT_PREFIX),
      text: nodeText(text),
      timestamp: elemTimestamp(elem),
    };
  });
};

const loadCommentElements = async (
  zip: JSZip
): Promise<{ commentsRoot: XmlNode; commentElements: XmlNode[] } | null> => {
  const commentsFile = zip.file("word/comments.xml");
  if (!commentsFile) {
    return null;
  }
  const commentsContent = await commentsFile.async("string");
  const parsed: XmlNode = await parseStringPromise(commentsContent, {
    explicitArray: false,
  });
  const commentsRoot =
    asNode(parsed.comments) ?? asNode(parsed["w:comments"]) ?? {};
  const rawEls = commentsRoot["w:comment"] ?? commentsRoot.comment ?? [];
  const commentElements = nodeArray(rawEls);
  return { commentElements, commentsRoot };
};

const writeCommentsRoot = (zip: JSZip, commentsRoot: XmlNode): void => {
  const newCommentsXml = new Builder({
    headless: false,
    rootName: "w:comments",
    xmldec: { encoding: "utf-8", standalone: true, version: "1.0" },
  }).buildObject(commentsRoot);
  zip.file("word/comments.xml", newCommentsXml);
};

const dropCommentElement = (commentsRoot: XmlNode, target: XmlNode): void => {
  const remaining = nodeArray(
    commentsRoot["w:comment"] ?? commentsRoot.comment
  ).filter((c) => c !== target);
  if (commentsRoot["w:comment"] === undefined) {
    commentsRoot.comment = remaining;
  } else {
    commentsRoot["w:comment"] = remaining;
  }
  if (remaining.length === 0) {
    if (commentsRoot["w:comment"] !== undefined) {
      delete commentsRoot["w:comment"];
    }
    if (commentsRoot.comment !== undefined) {
      delete commentsRoot.comment;
    }
  }
};

const paraHasStart = (
  para: XmlNode,
  commentId: string,
  nid: string
): boolean => {
  const direct = para["w:commentRangeStart"];
  if (
    direct !== undefined &&
    nodeArray(direct).some((m) => markerMatches(m, commentId, nid))
  ) {
    return true;
  }
  const runs = nodeArray(para["w:r"]);
  return runs.some((r) => {
    const marker = childNode(r, "w:commentRangeStart");
    return marker !== undefined && markerMatches(marker, commentId, nid);
  });
};

const stripSuggestionMarkers = (targetPara: XmlNode): XmlNode[] => {
  const runs = nodeArray(targetPara["w:r"]);
  return runs.filter((r) => {
    if (r["w:commentRangeStart"] !== undefined) {
      return false;
    }
    if (r["w:commentRangeEnd"] !== undefined) {
      return false;
    }
    if (
      childNode(childNode(r, "w:r") ?? {}, "w:commentReference") !== undefined
    ) {
      return false;
    }
    if (r["w:commentReference"] !== undefined) {
      return false;
    }
    return true;
  });
};

const applySuggestionToRuns = (
  targetPara: XmlNode,
  suggestion: string
): void => {
  const filtered = stripSuggestionMarkers(targetPara);
  // find the run that held the original text (first with w:t) or create one
  let replaced = false;
  for (const r of filtered) {
    if (r["w:t"] !== undefined && !replaced) {
      r["w:t"] = suggestion;
      replaced = true;
    }
  }
  if (!replaced) {
    filtered.push({ "w:t": suggestion });
  }
  targetPara["w:r"] = filtered.length === 1 ? filtered[0] : filtered;
};

export const applyCommentSuggestion = async (
  docPath: string,
  commentId: string
): Promise<ApproveResult> => {
  const data = readFileSync(docPath);
  if (!isZipBuffer(data)) {
    return "not-found";
  }
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadCommentElements(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const nid = numericWId(commentId);
  const target = commentElements.find((c) =>
    matchesCommentId(c, commentId, nid)
  );
  if (!target) {
    return "not-found";
  }
  const commentText = commentBodyText(target);
  const suggestion = parseSuggestion(
    nodeText(commentText),
    SUGGESTED_TEXT_PREFIX
  );
  if (suggestion === null) {
    return "no-suggestion";
  }

  const documentXml = zip.file("word/document.xml");
  if (!documentXml) {
    throw new Error("document.xml not found in DOCX");
  }
  const docContent = await documentXml.async("string");
  const docObj: XmlNode = await parseStringPromise(docContent, {
    explicitArray: false,
  });
  const root = asNode(docObj.document) ?? asNode(docObj["w:document"]);
  const body =
    root === undefined
      ? undefined
      : (asNode(root.body) ?? asNode(root["w:body"]));
  const paragraphs = nodeArray(body?.["w:p"]);
  const targetPara = paragraphs.find((para) =>
    paraHasStart(para, commentId, nid)
  );
  if (!targetPara) {
    return "not-found";
  }

  // ponytail: strip direct markers and reference runs (both old nested and new direct forms)
  if (targetPara["w:commentRangeStart"] !== undefined) {
    delete targetPara["w:commentRangeStart"];
  }
  if (targetPara["w:commentRangeEnd"] !== undefined) {
    delete targetPara["w:commentRangeEnd"];
  }
  applySuggestionToRuns(targetPara, suggestion);
  const newDocXml = new Builder().buildObject(docObj);
  zip.file("word/document.xml", newDocXml);

  dropCommentElement(commentsRoot, target);
  writeCommentsRoot(zip, commentsRoot);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(docPath, buffer);
  return "applied";
};

export const updateComment = async (
  docPath: string,
  commentId: string,
  update: { text?: string; suggestedText?: string }
): Promise<"updated" | "not-found"> => {
  const data = readFileSync(docPath);
  if (!isZipBuffer(data)) {
    return "not-found";
  }
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadCommentElements(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const nid = numericWId(commentId);
  const target = commentElements.find((c) =>
    matchesCommentId(c, commentId, nid)
  );
  if (!target) {
    return "not-found";
  }
  // ponytail: a suggestion replaces the note text, same convention as writeComment
  const storedText =
    update.suggestedText === undefined
      ? (update.text ?? "")
      : `${SUGGESTED_TEXT_PREFIX}${update.suggestedText}`;
  target["w:p"] = { "w:r": { "w:t": storedText } };
  // normalize to w:comment for valid OOXML
  if (
    commentsRoot.comment !== undefined &&
    commentsRoot["w:comment"] === undefined
  ) {
    commentsRoot["w:comment"] = commentsRoot.comment;
    delete commentsRoot.comment;
  } else if (commentsRoot["w:comment"] !== undefined) {
    if (commentsRoot.comment !== undefined) {
      delete commentsRoot.comment;
    }
    commentsRoot["w:comment"] = commentElements;
  }
  writeCommentsRoot(zip, commentsRoot);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(docPath, buffer);
  return "updated";
};

type RangeMarkerKey = "w:commentRangeStart" | "w:commentRangeEnd";

const stripRangeMarkerKey = (
  para: XmlNode,
  key: RangeMarkerKey,
  markerId: (m: XmlNode) => boolean
): void => {
  const v: unknown = para[key];
  if (v === undefined || v === null) {
    return;
  }
  if (Array.isArray(v)) {
    const keptM = (v as XmlNode[]).filter((m) => !markerId(m));
    if (keptM.length === 0) {
      if (key === "w:commentRangeStart") {
        delete para["w:commentRangeStart"];
      } else {
        delete para["w:commentRangeEnd"];
      }
    } else if (keptM.length === 1) {
      const [first] = keptM;
      para[key] = first;
    } else {
      para[key] = keptM;
    }
  } else {
    const node = asNode(v);
    if (node !== undefined && markerId(node)) {
      if (key === "w:commentRangeStart") {
        delete para["w:commentRangeStart"];
      } else {
        delete para["w:commentRangeEnd"];
      }
    }
  }
};

const stripParaMarkers = (
  para: XmlNode,
  commentId: string,
  nid: string
): void => {
  const markerId = (m: XmlNode): boolean => markerMatches(m, commentId, nid);
  stripRangeMarkerKey(para, "w:commentRangeStart", markerId);
  stripRangeMarkerKey(para, "w:commentRangeEnd", markerId);
  const runs = nodeArray(para["w:r"]);
  const kept = runs.filter((r) => {
    if (
      r["w:commentRangeStart"] !== undefined &&
      markerMatches(r["w:commentRangeStart"], commentId, nid)
    ) {
      return false;
    }
    if (
      r["w:commentRangeEnd"] !== undefined &&
      markerMatches(r["w:commentRangeEnd"], commentId, nid)
    ) {
      return false;
    }
    const refNested = childNode(
      childNode(r, "w:r") ?? {},
      "w:commentReference"
    );
    if (refNested !== undefined && markerMatches(refNested, commentId, nid)) {
      return false;
    }
    const refDirect = r["w:commentReference"];
    if (refDirect !== undefined && markerMatches(refDirect, commentId, nid)) {
      return false;
    }
    return true;
  });
  if (kept.length > 0) {
    para["w:r"] = kept;
  } else {
    delete para["w:r"];
  }
};

export const deleteComment = async (
  docPath: string,
  commentId: string
): Promise<"deleted" | "not-found"> => {
  const data = readFileSync(docPath);
  if (!isZipBuffer(data)) {
    return "not-found";
  }
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadCommentElements(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const nid = numericWId(commentId);
  const isTarget = (c: XmlNode): boolean => matchesCommentId(c, commentId, nid);
  if (!commentElements.some(isTarget)) {
    return "not-found";
  }
  const filtered = commentElements.filter((c) => !isTarget(c));
  if (
    commentsRoot["w:comment"] !== undefined ||
    commentsRoot.comment === undefined
  ) {
    commentsRoot["w:comment"] = filtered;
    if (commentsRoot.comment !== undefined) {
      delete commentsRoot.comment;
    }
  } else {
    commentsRoot.comment = filtered;
  }
  if (filtered.length === 0) {
    if (commentsRoot["w:comment"] !== undefined) {
      delete commentsRoot["w:comment"];
    }
    if (commentsRoot.comment !== undefined) {
      delete commentsRoot.comment;
    }
  }
  writeCommentsRoot(zip, commentsRoot);

  // Remove the range markers from document.xml (our writer nests them in the w:r array,
  // Word places them as direct children of w:p — handle both).
  const documentXml = zip.file("word/document.xml");
  if (documentXml) {
    const parsed: XmlNode = await parseStringPromise(
      await documentXml.async("string"),
      { explicitArray: false }
    );
    const root = asNode(parsed.document) ?? asNode(parsed["w:document"]);
    const body =
      root === undefined
        ? undefined
        : (asNode(root.body) ?? asNode(root["w:body"]));
    const paragraphs = nodeArray(body?.["w:p"]);
    for (const para of paragraphs) {
      stripParaMarkers(para, commentId, nid);
    }
    zip.file("word/document.xml", new Builder().buildObject(parsed));
  }

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(docPath, buffer);
  return "deleted";
};

export const setCommentStatus = async (
  docPath: string,
  commentId: string,
  status: CommentStatus
): Promise<"ok" | "not-found"> => {
  const data = readFileSync(docPath);
  if (!isZipBuffer(data)) {
    return "not-found";
  }
  const zip = await JSZip.loadAsync(data);

  const loaded = await loadCommentElements(zip);
  if (!loaded) {
    return "not-found";
  }
  const { commentsRoot, commentElements } = loaded;
  const nid = numericWId(commentId);
  const target = commentElements.find((c) =>
    matchesCommentId(c, commentId, nid)
  );
  if (!target) {
    return "not-found";
  }
  const currentAttrs = asNode(target.$) ?? {};
  const nextAttrs: XmlNode = {};
  for (const [k, v] of Object.entries(currentAttrs)) {
    if (
      k === "w:done" ||
      k === "done" ||
      k === OO_STATUS_ATTR ||
      k === OO_XMLNS_ATTR
    ) {
      continue;
    }
    nextAttrs[k] = v;
  }
  if (status === "resolved") {
    nextAttrs["w:done"] = "1";
  } else if (status === "denied") {
    nextAttrs[OO_XMLNS_ATTR] = OPENOFFICE_NS;
    nextAttrs[OO_STATUS_ATTR] = "denied";
  }
  target.$ = nextAttrs;
  // normalize to w:comment for OOXML validity
  if (
    commentsRoot.comment !== undefined &&
    commentsRoot["w:comment"] === undefined
  ) {
    commentsRoot["w:comment"] = commentsRoot.comment;
    delete commentsRoot.comment;
  } else if (commentsRoot["w:comment"] !== undefined) {
    if (commentsRoot.comment !== undefined) {
      delete commentsRoot.comment;
    }
    commentsRoot["w:comment"] = commentElements;
  }
  writeCommentsRoot(zip, commentsRoot);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(docPath, buffer);
  return "ok";
};
