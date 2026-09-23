import type JSZip from "jszip";
import { parseStringPromise, Builder } from "xml2js";

export interface Relationship {
  id: string;
  type: string;
  target: string;
}

export const readRelationships = async (
  zip: JSZip,
  relsPath: string
): Promise<Relationship[]> => {
  const relsFile = zip.file(relsPath);
  if (!relsFile) {
    return [];
  }
  const content = await relsFile.async("string");
  const obj = await parseStringPromise(content, { explicitArray: false });
  const root = obj.Relationships || obj["x:Relationships"];
  if (!root || !root.Relationship) {
    return [];
  }
  const rels = Array.isArray(root.Relationship)
    ? root.Relationship
    : [root.Relationship];
  return rels.map((rel: { $?: Record<string, string> }) => ({
    id: rel.$?.Id ?? rel.$?.["r:Id"] ?? "",
    target: rel.$?.Target ?? "",
    type: rel.$?.Type ?? "",
  }));
};

export const addRelationship = async (
  zip: JSZip,
  relsPath: string,
  type: string,
  target: string
): Promise<string> => {
  const existing = await readRelationships(zip, relsPath);
  const existingRel = existing.find((r) => r.type === type);
  if (existingRel) {
    return existingRel.id;
  }
  const usedIds = new Set(existing.map((r) => r.id));
  let nextId = existing.length + 1;
  while (usedIds.has(`rId${nextId}`)) {
    nextId += 1;
  }
  const newId = `rId${nextId}`;

  const root = {
    Relationships: {
      $: {
        xmlns: "http://schemas.openxmlformats.org/package/2006/relationships",
      },
      Relationship: existing.map((r) => ({
        $: { Id: r.id, Target: r.target, Type: r.type },
      })),
    },
  };
  root.Relationships.Relationship.push({
    $: { Id: newId, Target: target, Type: type },
  });

  const xml = new Builder({
    headless: false,
    rootName: "Relationships",
    xmldec: { encoding: "utf-8", version: "1.0" },
  }).buildObject(root.Relationships);
  zip.file(relsPath, xml);
  return newId;
};

export const ensureContentType = async (
  zip: JSZip,
  partName: string,
  contentType: string
): Promise<void> => {
  const typesPath = "[Content_Types].xml";
  const typesFile = zip.file(typesPath);
  if (!typesFile) {
    throw new Error("Content_Types.xml not found");
  }
  const content = await typesFile.async("string");
  const obj = await parseStringPromise(content, { explicitArray: false });
  const root = obj.Types || obj["ct:Types"];
  if (!root) {
    throw new Error("Could not parse Content_Types.xml");
  }
  const overrides = root.Override;
  let list: { $?: Record<string, string> }[];
  if (!overrides) {
    list = [];
  } else if (Array.isArray(overrides)) {
    list = overrides;
  } else {
    list = [overrides];
  }
  if (list.some((o) => o.$ && o.$.PartName === partName)) {
    return;
  }
  list.push({ $: { ContentType: contentType, PartName: partName } });
  root.Override = list;

  const xml = new Builder({
    headless: false,
    rootName: "Types",
    xmldec: { encoding: "utf-8", version: "1.0" },
  }).buildObject(root);
  zip.file(typesPath, xml);
};

export const partRelsPath = (partPath: string): string => {
  const slash = partPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : partPath.slice(0, slash);
  const base = slash === -1 ? partPath : partPath.slice(slash + 1);
  return dir ? `${dir}/_rels/${base}.rels` : `_rels/${base}.rels`;
};

export const resolveTarget = (dir: string, target: string): string => {
  const parts = `${dir}/${target}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") {
      out.pop();
    } else if (p === "." || p === "") {
      continue;
    } else {
      out.push(p);
    }
  }
  return out.join("/");
};

export const escapeXml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const SUGGESTED_TEXT_PREFIX = "Suggested text: ";
export const SUGGESTED_VALUE_PREFIX = "Suggested value: ";

export const parseSuggestion = (
  text: unknown,
  prefix: string
): string | null => {
  if (typeof text !== "string" || !text.startsWith(prefix)) {
    return null;
  }
  return text.slice(prefix.length);
};

// Plugin namespace for Comment status attributes (docs/CONTEXT.md "Comment status").
// OOXML has no standard "denied" state for comments, so the plugin persists status as a
// namespaced attribute declared locally on the comment element. Word preserves unknown
// attributes on recognized elements across save round-trips (it strips unknown child
// elements, not attributes), so this choice survives a Word round-trip.
export const OPENOFFICE_NS = "http://opencode.ai/openoffice-plugin";
export const OO_XMLNS_ATTR = "xmlns:oo";
export const OO_STATUS_ATTR = "oo:status";
export const OO_ORIG_ID_ATTR = "oo:origId";

export type CommentStatus = "open" | "resolved" | "denied";

export const openofficeStatusAttributes = (
  status: CommentStatus
): Record<string, string> => {
  if (status === "open") {
    return {};
  }
  return { [OO_XMLNS_ATTR]: OPENOFFICE_NS, [OO_STATUS_ATTR]: status };
};

export const parseStatus = (
  attrs: Record<string, unknown> | undefined
): CommentStatus => {
  if (!attrs) {
    return "open";
  }
  if (attrs["w:done"] === "1" || attrs.done === "1") {
    return "resolved";
  }
  if (
    attrs[OO_STATUS_ATTR] === "denied" ||
    attrs[OO_STATUS_ATTR] === "resolved"
  ) {
    return attrs[OO_STATUS_ATTR] as CommentStatus;
  }
  return "open";
};
