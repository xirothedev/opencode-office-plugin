import JSZip from "jszip"
import { readFileSync, writeFileSync } from "fs"
import { parseStringPromise, Builder } from "xml2js"
import { addRelationship, ensureContentType, escapeXml, partRelsPath, parseSuggestion, readRelationships, resolveTarget, SUGGESTED_VALUE_PREFIX } from "@/core/format/ooxml/parts"

export interface XlsxComment {
  id: string
  author: string
  text: string
  timestamp: Date
  cellRef: string
  parentId: string | null
  resolved: boolean
  suggestedText?: string | null
}

export type ApproveResult = "applied" | "not-found" | "no-suggestion"

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
  const storedText = comment.suggestedText
    ? `${SUGGESTED_VALUE_PREFIX}${comment.suggestedText}`
    : comment.text
  await appendCommentElement(zip, comment, authorId, storedText)

  const sheetPart = await resolveFirstSheetPart(zip)
  const sheetRelsPath = partRelsPath(sheetPart)
  await addRelationship(zip, sheetRelsPath, COMMENTS_REL_TYPE, "../comments1.xml")
  const vmlRelId = await addRelationship(zip, sheetRelsPath, VML_REL_TYPE, "../drawings/vmlDrawing1.vml")
  const vmlPath = await resolveVmlPath(zip, sheetPart, sheetRelsPath)
  await ensureLegacyDrawing(zip, sheetPart, vmlRelId)
  await appendVmlShape(zip, vmlPath, comment, storedText)
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
    const text = extractCommentText(elem.text)
    return {
      id: elem.$.id || `${elem.$.ref}-${authorId}`,
      author: authorList[authorId] || "Unknown",
      text,
      timestamp: new Date(),
      cellRef: elem.$.ref || "",
      parentId: null,
      resolved: false,
      suggestedText: parseSuggestion(text, SUGGESTED_VALUE_PREFIX),
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

async function appendCommentElement(
  zip: JSZip,
  comment: XlsxComment,
  authorId: number,
  storedText: string
): Promise<void> {
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
    text: { t: storedText },
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

async function appendVmlShape(
  zip: JSZip,
  vmlPath: string,
  comment: XlsxComment,
  storedText: string
): Promise<void> {
  const existing = zip.file(vmlPath)
  let body = existing ? await existing.async("string") : ""
  const shapeCount = (body.match(/<v:shape /g) || []).length
  const ids = [...body.matchAll(/_x0000_s(\d+)/g)].map((m) => parseInt(m[1], 10))
  const shapeId = `_x0000_s${ids.length > 0 ? Math.max(...ids) + 1 : 1025}`
  const { row, col } = cellRefToIndices(comment.cellRef)
  const shape = `<v:shape id="${shapeId}" type="#_x0000_t202" style="position:absolute;margin-left:0;margin-top:0;width:96pt;height:55.5pt;z-index:${shapeCount + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left">${escapeXml(storedText)}</div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>1, 15, ${row}, 2, 3, 15, ${row + 4}, 16</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${row}</x:Row><x:Column>${col}</x:Column></x:ClientData></v:shape>`
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

export async function applyCellSuggestion(xlsxPath: string, commentId: string): Promise<ApproveResult> {
  const match = commentId.match(/^([A-Z]+[0-9]+)-(\d+)$/)
  if (!match) {
    return "not-found"
  }
  const cellRef = match[1]
  const authorId = parseInt(match[2], 10)

  const data = readFileSync(xlsxPath)
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("xl/comments1.xml")
  if (!commentsFile) {
    return "not-found"
  }
  const commentsContent = await commentsFile.async("string")
  const commentsObj = await parseStringPromise(commentsContent, { explicitArray: false })
  const commentsRoot = commentsObj.comments || commentsObj["x:comments"]
  const commentElements = commentsRoot?.commentList?.comment
    ? Array.isArray(commentsRoot.commentList.comment)
      ? commentsRoot.commentList.comment
      : [commentsRoot.commentList.comment]
    : []
  const target = commentElements.find(
    (c: any) =>
      (c.$?.ref ?? c.$?.cellRef) === cellRef && String(c.$?.authorId) === String(authorId)
  )
  if (!target) {
    return "not-found"
  }
  const text = extractCommentText(target.text)
  const suggestion = parseSuggestion(text, SUGGESTED_VALUE_PREFIX)
  if (suggestion === null) {
    return "no-suggestion"
  }

  const sheetPart = await resolveFirstSheetPart(zip)
  await writeCellValue(zip, sheetPart, cellRef, suggestion)

  commentsRoot.commentList.comment = commentElements.filter((c: any) => c !== target)
  const newCommentsXml = new Builder({
    rootName: "comments",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(commentsRoot)
  zip.file("xl/comments1.xml", newCommentsXml)

  await removeVmlShapeForCell(zip, cellRef, text)

  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(xlsxPath, buffer)
  return "applied"
}

async function writeCellValue(zip: JSZip, sheetPart: string, cellRef: string, value: string): Promise<void> {
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
  if (!root.sheetData) {
    root.sheetData = { row: [] }
  }
  const rows = root.sheetData.row
  const rowList = rows ? (Array.isArray(rows) ? rows : [rows]) : []
  const { row } = cellRefToIndices(cellRef)
  let targetRow = rowList.find((r: any) => String(r.$.r) === String(row + 1))
  if (!targetRow) {
    targetRow = { $: { r: String(row + 1) }, c: [] }
    rowList.push(targetRow)
    root.sheetData.row = rowList
  }
  const cells = targetRow.c
  const cellList = cells ? (Array.isArray(cells) ? cells : [cells]) : []
  const existingIndex = cellList.findIndex((c: any) => c.$.r === cellRef)
  const isNumeric = /^-?\d+(\.\d+)?$/.test(value)
  const newCell = isNumeric
    ? { $: { r: cellRef }, v: value }
    : { $: { r: cellRef, t: "inlineStr" }, is: { t: value } }
  if (existingIndex >= 0) {
    cellList.splice(existingIndex, 1, newCell)
  } else {
    cellList.push(newCell)
  }
  targetRow.c = cellList

  const xml = new Builder({
    rootName: "worksheet",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(root)
  zip.file(sheetPart, xml)
}

async function removeVmlShapeForCell(zip: JSZip, cellRef: string, commentText: string): Promise<void> {
  const vmlPath = "xl/drawings/vmlDrawing1.vml"
  const existing = zip.file(vmlPath)
  if (!existing) {
    return
  }
  const { row, col } = cellRefToIndices(cellRef)
  const body = await existing.async("string")
  const escapedText = escapeXml(commentText)
  const kept = body
    .split(/(?=<v:shape )/)
    .filter((block: string) => {
      if (!block.startsWith("<v:shape ")) {
        return true
      }
      const hasRow = block.includes(`<x:Row>${row}</x:Row>`)
      const hasCol = block.includes(`<x:Column>${col}</x:Column>`)
      const hasText = block.includes(escapedText)
      return !(hasRow && hasCol && hasText)
    })
    .join("")
  if (kept !== body) {
    zip.file(vmlPath, kept)
  }
}
