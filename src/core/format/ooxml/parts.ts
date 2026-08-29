import JSZip from "jszip"
import { parseStringPromise, Builder } from "xml2js"

export interface Relationship {
  id: string
  type: string
  target: string
}

export async function readRelationships(zip: JSZip, relsPath: string): Promise<Relationship[]> {
  const relsFile = zip.file(relsPath)
  if (!relsFile) {
    return []
  }
  const content = await relsFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const root = obj.Relationships || obj["x:Relationships"]
  if (!root || !root.Relationship) {
    return []
  }
  const rels = Array.isArray(root.Relationship) ? root.Relationship : [root.Relationship]
  return rels.map((rel: any) => ({
    id: rel.$.Id || rel.$["r:Id"] || "",
    type: rel.$.Type || "",
    target: rel.$.Target || "",
  }))
}

export async function addRelationship(
  zip: JSZip,
  relsPath: string,
  type: string,
  target: string
): Promise<string> {
  const existing = await readRelationships(zip, relsPath)
  const existingRel = existing.find((r) => r.type === type)
  if (existingRel) {
    return existingRel.id
  }
  const usedIds = new Set(existing.map((r) => r.id))
  let nextId = existing.length + 1
  while (usedIds.has(`rId${nextId}`)) {
    nextId += 1
  }
  const newId = `rId${nextId}`

  const root = {
    Relationships: {
      $: { xmlns: "http://schemas.openxmlformats.org/package/2006/relationships" },
      Relationship: existing.map((r) => ({ $: { Id: r.id, Type: r.type, Target: r.target } })),
    },
  }
  root.Relationships.Relationship.push({ $: { Id: newId, Type: type, Target: target } })

  const xml = new Builder({ rootName: "Relationships", headless: false, xmldec: { version: "1.0", encoding: "UTF-8" } }).buildObject(root.Relationships)
  zip.file(relsPath, xml)
  return newId
}

export async function ensureContentType(zip: JSZip, partName: string, contentType: string): Promise<void> {
  const typesPath = "[Content_Types].xml"
  const typesFile = zip.file(typesPath)
  if (!typesFile) {
    throw new Error("Content_Types.xml not found")
  }
  const content = await typesFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const root = obj.Types || obj["ct:Types"]
  if (!root) {
    throw new Error("Could not parse Content_Types.xml")
  }
  const overrides = root.Override
  const list = overrides ? (Array.isArray(overrides) ? overrides : [overrides]) : []
  if (list.some((o: any) => o.$ && o.$.PartName === partName)) {
    return
  }
  list.push({ $: { PartName: partName, ContentType: contentType } })
  root.Override = list

  const xml = new Builder({ rootName: "Types", headless: false, xmldec: { version: "1.0", encoding: "UTF-8" } }).buildObject(root)
  zip.file(typesPath, xml)
}

export function partRelsPath(partPath: string): string {
  const slash = partPath.lastIndexOf("/")
  const dir = slash >= 0 ? partPath.substring(0, slash) : ""
  const base = slash >= 0 ? partPath.substring(slash + 1) : partPath
  return dir ? `${dir}/_rels/${base}.rels` : `_rels/${base}.rels`
}

export function resolveTarget(dir: string, target: string): string {
  const parts = `${dir}/${target}`.split("/")
  const out: string[] = []
  for (const p of parts) {
    if (p === "..") {
      out.pop()
    } else if (p === "." || p === "") {
      continue
    } else {
      out.push(p)
    }
  }
  return out.join("/")
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export const SUGGESTED_TEXT_PREFIX = "Suggested text: "
export const SUGGESTED_VALUE_PREFIX = "Suggested value: "

export function parseSuggestion(text: any, prefix: string): string | null {
  if (typeof text !== "string" || !text.startsWith(prefix)) {
    return null
  }
  return text.slice(prefix.length)
}

// Plugin namespace for Comment status attributes (docs/CONTEXT.md "Comment status").
// OOXML has no standard "denied" state for comments, so the plugin persists status as a
// namespaced attribute declared locally on the comment element. Word preserves unknown
// attributes on recognized elements across save round-trips (it strips unknown child
// elements, not attributes), so this choice survives a Word round-trip.
export const OPENOFFICE_NS = "http://opencode.ai/openoffice-plugin"
export const OO_XMLNS_ATTR = "xmlns:oo"
export const OO_STATUS_ATTR = "oo:status"
export const OO_ORIG_ID_ATTR = "oo:origId"

export type CommentStatus = "open" | "resolved" | "denied"

export function openofficeStatusAttributes(status: CommentStatus): Record<string, string> {
  if (status === "open") {
    return {}
  }
  return { [OO_XMLNS_ATTR]: OPENOFFICE_NS, [OO_STATUS_ATTR]: status }
}

export function parseStatus(attrs: Record<string, unknown> | undefined): CommentStatus {
  if (!attrs) {
    return "open"
  }
  if (attrs["w:done"] === "1" || attrs.done === "1") {
    return "resolved"
  }
  if (attrs[OO_STATUS_ATTR] === "denied" || attrs[OO_STATUS_ATTR] === "resolved") {
    return attrs[OO_STATUS_ATTR] as CommentStatus
  }
  return "open"
}
