import { readFileSync, writeFileSync } from "node:fs";

import JSZip from "jszip";
import { parseStringPromise, Builder } from "xml2js";

export interface TrackChange {
  id: string;
  type: "insertion" | "deletion";
  author: string;
  timestamp: Date;
  text: string;
  paragraph: number;
  offset: number;
}

type XmlNode = Record<string, unknown>;

const toArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const childText = (node: XmlNode, key: string): string => {
  const v: unknown = node[key];
  return typeof v === "string" ? v : "";
};

const attrText = (node: XmlNode, ...keys: string[]): string => {
  const attrs = node.$ as Record<string, unknown> | undefined;
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

const attrDate = (node: XmlNode, ...keys: string[]): Date =>
  new Date(attrText(node, ...keys) || new Date());

const nestedText = (node: XmlNode, outer: string, inner: string): string => {
  const mid = node[outer] as XmlNode | undefined;
  if (!mid || typeof mid !== "object") {
    return "";
  }
  return childText(mid, inner);
};

const paragraphsOf = (docObj: XmlNode): XmlNode[] => {
  const root = (docObj.document ?? docObj["w:document"]) as XmlNode | undefined;
  if (!root) {
    throw new Error("Could not find document root element");
  }
  const body = (root.body ?? root["w:body"]) as XmlNode | undefined;
  if (!body) {
    throw new Error("Could not find document body element");
  }
  return toArray<XmlNode>(body["w:p"] as XmlNode | XmlNode[] | undefined);
};

const readParagraphs = (docObj: XmlNode): XmlNode[] => {
  const root = (docObj.document ?? docObj["w:document"]) as XmlNode | undefined;
  if (!root) {
    return [];
  }
  const body = (root.body ?? root["w:body"]) as XmlNode | undefined;
  if (!body) {
    return [];
  }
  return toArray<XmlNode>(body["w:p"] as XmlNode | XmlNode[] | undefined);
};

const collectInsertion = (
  para: XmlNode,
  paraIndex: number,
  changes: TrackChange[]
): void => {
  const ins = para["w:ins"] as XmlNode | undefined;
  if (!ins) {
    return;
  }
  changes.push({
    author: attrText(ins, "w:author", "author"),
    id: attrText(ins, "w:id", "id"),
    // Simplified - real impl needs to parse position
    offset: 0,
    paragraph: paraIndex,
    text: nestedText(ins, "w:r", "w:t"),
    timestamp: attrDate(ins, "w:date", "date"),
    type: "insertion",
  });
};

const collectDeletion = (
  para: XmlNode,
  paraIndex: number,
  changes: TrackChange[]
): void => {
  const del = para["w:del"] as XmlNode | undefined;
  if (!del) {
    return;
  }
  changes.push({
    author: attrText(del, "w:author", "author"),
    id: attrText(del, "w:id", "id"),
    offset: 0,
    paragraph: paraIndex,
    text: nestedText(del, "w:r", "w:delText"),
    timestamp: attrDate(del, "w:date", "date"),
    type: "deletion",
  });
};

export const writeTrackChange = async (
  docPath: string,
  trackChange: TrackChange
): Promise<void> => {
  const data = readFileSync(docPath);
  const zip = await JSZip.loadAsync(data);

  // Read document.xml
  const documentXml = zip.file("word/document.xml");
  if (!documentXml) {
    throw new Error("document.xml not found in DOCX");
  }

  const docContent = await documentXml.async("string");
  const docObj = await parseStringPromise(docContent, { explicitArray: false });

  // Get target paragraph
  const paragraphs = paragraphsOf(docObj as XmlNode);
  const targetPara = paragraphs[trackChange.paragraph];

  if (!targetPara) {
    throw new Error(`Paragraph ${trackChange.paragraph} not found`);
  }

  // Ensure runs array exists
  if (!targetPara["w:r"]) {
    targetPara["w:r"] = [];
  }
  if (!Array.isArray(targetPara["w:r"])) {
    targetPara["w:r"] = [targetPara["w:r"]];
  }

  // Create track change element - OOXML: <w:ins>/<w:del> is sibling of <w:r> inside <w:p>, not child of <w:r>
  if (trackChange.type === "insertion") {
    const insElement = {
      $: {
        "w:author": trackChange.author,
        "w:date": trackChange.timestamp.toISOString(),
        "w:id": trackChange.id,
      },
      "w:r": {
        "w:t": trackChange.text,
      },
    };
    // Add as sibling of w:r at paragraph level
    targetPara["w:ins"] = insElement;
  } else if (trackChange.type === "deletion") {
    const delElement = {
      $: {
        "w:author": trackChange.author,
        "w:date": trackChange.timestamp.toISOString(),
        "w:id": trackChange.id,
      },
      "w:r": {
        "w:delText": trackChange.text,
      },
    };
    targetPara["w:del"] = delElement;
  }

  // Write back
  const builder = new Builder();
  const newDocXml = builder.buildObject(docObj);
  zip.file("word/document.xml", newDocXml);

  // Write back to file
  const buffer = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(docPath, buffer);
};

export const readTrackChanges = async (
  docPath: string
): Promise<TrackChange[]> => {
  const data = readFileSync(docPath);
  const zip = await JSZip.loadAsync(data);

  const documentXml = zip.file("word/document.xml");
  if (!documentXml) {
    return [];
  }

  const content = await documentXml.async("string");
  const docObj = await parseStringPromise(content, { explicitArray: false });

  const changes: TrackChange[] = [];
  for (const [paraIndex, para] of readParagraphs(docObj as XmlNode).entries()) {
    collectInsertion(para, paraIndex, changes);
    collectDeletion(para, paraIndex, changes);
  }

  return changes;
};
