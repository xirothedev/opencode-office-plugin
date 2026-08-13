import JSZip from "jszip"
import { readFileSync, writeFileSync } from "fs"
import { parseStringPromise, Builder } from "xml2js"
import { addRelationship, ensureContentType, escapeXml, partRelsPath, readRelationships, resolveTarget } from "./parts.js"

export interface XlsxComment {
  id: string
  author: string
  text: string
  timestamp: Date
  cellRef: string
  parentId: string | null
  resolved: boolean
}

const SHEET_MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
const COMMENTS_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
const VML_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing"
const COMMENTS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"
const VML_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.vmlDrawing"

export async function writeComment(xlsxPath: string, comment: XlsxComment): Promise<void> {
  const data = readFileSync(xlsxPath)
  const zip = await JSZip.loadAsync(data)

  const authorId = await ensureAuthor(zip, comment.author)
  await appendCommentElement(zip, comment, authorId)

  const sheetPart = await resolveFirstSheetPart(zip)
  const sheetRelsPath = partRelsPath(sheetPart)
  await addRelationship(zip, sheetRelsPath, COMMENTS_REL_TYPE, "../comments1.xml")
  const vmlRelId = await addRelationship(zip, sheetRelsPath, VML_REL_TYPE, "../drawings/vmlDrawing1.vml")
  const vmlPath = await resolveVmlPath(zip, sheetPart, sheetRelsPath)
  await ensureLegacyDrawing(zip, sheetPart, vmlRelId)
  await appendVmlShape(zip, vmlPath, comment)
  await ensureContentType(zip, "/xl/comments1.xml", COMMENTS_CONTENT_TYPE)
  await ensureContentType(zip, `/${vmlPath}`, VML_CONTENT_TYPE)

  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(xlsxPath, buffer)
}

export async function readComments(xlsxPath: string): Promise<XlsxComment[]> {
  const data = readFileSync(xlsxPath)
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("xl/comments1.xml")
  if (!commentsFile) {
    return []
  }
  const content = await commentsFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const root = obj.comments || obj["x:comments"]
  if (!root || !root.commentList) {
    return []
  }
  const authors = root.authors?.author
  const authorList = authors ? (Array.isArray(authors) ? authors : [authors]) : []

  const comments = root.commentList.comment
  const commentList = comments ? (Array.isArray(comments) ? comments : [comments]) : []

  return commentList.map((elem: any) => {
    const authorId = parseInt(elem.$?.authorId ?? elem.$?.author, 10)
    return {
      id: elem.$.id || `${elem.$.ref}-${authorId}`,
      author: authorList[authorId] || "Unknown",
      text: extractCommentText(elem.text),
      timestamp: new Date(),
      cellRef: elem.$.ref || "",
      parentId: null,
      resolved: false,
    }
  })
}

function textOf(node: any): string {
  if (typeof node === "string") {
    return node
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join("")
  }
  if (node && typeof node === "object" && typeof node._ === "string") {
    return node._
  }
  return ""
}

function extractCommentText(textElem: any): string {
  if (!textElem || typeof textElem !== "object") {
    return ""
  }
  const runs = textElem.r ? (Array.isArray(textElem.r) ? textElem.r : [textElem.r]) : []
  if (runs.length > 0) {
    return runs.map((r: any) => textOf(r.t)).join("")
  }
  return textOf(textElem.t)
}

async function ensureAuthor(zip: JSZip, author: string): Promise<number> {
  const commentsFile = zip.file("xl/comments1.xml")
  let root: any
  if (commentsFile) {
    const content = await commentsFile.async("string")
    root = await parseStringPromise(content, { explicitArray: false })
    root = root.comments || root["x:comments"]
  } else {
    root = {
      $: { xmlns: SHEET_MAIN_NS },
      authors: { author: [] },
      commentList: { comment: [] },
    }
  }
  if (!root.authors) {
    root.authors = { author: [] }
  }
  if (!Array.isArray(root.authors.author)) {
    root.authors.author = root.authors.author ? [root.authors.author] : []
  }
  const existingIndex = root.authors.author.indexOf(author)
  if (existingIndex >= 0) {
    return existingIndex
  }
  root.authors.author.push(author)
  const newIndex = root.authors.author.length - 1
  const xml = new Builder({
    rootName: "comments",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(root)
  zip.file("xl/comments1.xml", xml)
  return newIndex
}

async function appendCommentElement(zip: JSZip, comment: XlsxComment, authorId: number): Promise<void> {
  const commentsFile = zip.file("xl/comments1.xml")
  let root: any
  if (commentsFile) {
    const content = await commentsFile.async("string")
    root = await parseStringPromise(content, { explicitArray: false })
    root = root.comments || root["x:comments"]
  } else {
    root = {
      $: { xmlns: SHEET_MAIN_NS },
      authors: { author: [] },
      commentList: { comment: [] },
    }
  }
  if (!root.commentList) {
    root.commentList = { comment: [] }
  }
  if (!Array.isArray(root.commentList.comment)) {
    root.commentList.comment = root.commentList.comment ? [root.commentList.comment] : []
  }
  root.commentList.comment.push({
    $: { ref: comment.cellRef, authorId: String(authorId) },
    text: { t: comment.text },
  })
  const xml = new Builder({
    rootName: "comments",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(root)
  zip.file("xl/comments1.xml", xml)
}

async function resolveFirstSheetPart(zip: JSZip): Promise<string> {
  const workbookFile = zip.file("xl/workbook.xml")
  if (!workbookFile) {
    throw new Error("workbook.xml not found in XLSX")
  }
  const content = await workbookFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const workbook = obj.workbook || obj["x:workbook"]
  if (!workbook?.sheets?.sheet) {
    throw new Error("No sheets found in workbook")
  }
  const firstSheet = Array.isArray(workbook.sheets.sheet) ? workbook.sheets.sheet[0] : workbook.sheets.sheet
  const rid = firstSheet.$?.["r:id"] || firstSheet.$?.id
  const relationships = await readRelationships(zip, "xl/_rels/workbook.xml.rels")
  const rel = relationships.find((r) => r.id === rid)
  if (!rel) {
    throw new Error(`Sheet relationship ${rid} not found`)
  }
  return `xl/${rel.target}`
}

async function ensureLegacyDrawing(zip: JSZip, sheetPart: string, vmlRelId: string): Promise<void> {
  const sheetFile = zip.file(sheetPart)
  if (!sheetFile) {
    throw new Error(`Sheet part ${sheetPart} not found`)
  }
  const content = await sheetFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const root = obj.worksheet || obj["x:worksheet"]
  if (!root) {
    throw new Error("Could not find worksheet root element")
  }
  if (root.legacyDrawing) {
    return
  }
  const legacyDrawing = { $: { "r:id": vmlRelId } }
  const ordered: any = {}
  let inserted = false
  for (const key of Object.keys(root)) {
    if (!inserted && (key === "drawing" || key === "extLst")) {
      ordered.legacyDrawing = legacyDrawing
      inserted = true
    }
    ordered[key] = root[key]
  }
  if (!inserted) {
    ordered.legacyDrawing = legacyDrawing
  }
  const xml = new Builder({
    rootName: "worksheet",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(ordered)
  zip.file(sheetPart, xml)
}

async function resolveVmlPath(
  zip: JSZip,
  sheetPart: string,
  sheetRelsPath: string
): Promise<string> {
  const sheetFile = zip.file(sheetPart)
  if (sheetFile) {
    const content = await sheetFile.async("string")
    const obj = await parseStringPromise(content, { explicitArray: false })
    const root = obj.worksheet || obj["x:worksheet"]
    const legacyDrawing = root?.legacyDrawing
    if (legacyDrawing?.$?.["r:id"]) {
      const relationships = await readRelationships(zip, sheetRelsPath)
      const rel = relationships.find((r) => r.id === legacyDrawing.$["r:id"])
      if (rel) {
        const dir = sheetPart.substring(0, sheetPart.lastIndexOf("/"))
        return resolveTarget(dir, rel.target)
      }
    }
  }
  return `xl/drawings/vmlDrawing1.vml`
}

async function appendVmlShape(zip: JSZip, vmlPath: string, comment: XlsxComment): Promise<void> {
  const existing = zip.file(vmlPath)
  let body = existing ? await existing.async("string") : ""
  const shapeCount = (body.match(/<v:shape /g) || []).length
  const ids = [...body.matchAll(/_x0000_s(\d+)/g)].map((m) => parseInt(m[1], 10))
  const shapeId = `_x0000_s${ids.length > 0 ? Math.max(...ids) + 1 : 1025}`
  const { row, col } = cellRefToIndices(comment.cellRef)
  const shape = `<v:shape id="${shapeId}" type="#_x0000_t202" style="position:absolute;margin-left:0;margin-top:0;width:96pt;height:55.5pt;z-index:${shapeCount + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left">${escapeXml(comment.text)}</div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>1, 15, ${row}, 2, 3, 15, ${row + 4}, 16</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${row}</x:Row><x:Column>${col}</x:Column></x:ClientData></v:shape>`
  if (!body) {
    body = `<?xml version="1.0" encoding="UTF-8"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">${shape}</xml>`
  } else {
    body = body.replace("</xml>", `${shape}</xml>`)
  }
  zip.file(vmlPath, body)
}

function cellRefToIndices(cellRef: string): { row: number; col: number } {
  const match = cellRef.match(/^([A-Z]+)(\d+)$/)
  if (!match) {
    return { row: 0, col: 0 }
  }
  const letters = match[1]
  let col = 0
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - 64)
  }
  return { row: parseInt(match[2], 10) - 1, col: col - 1 }
}
