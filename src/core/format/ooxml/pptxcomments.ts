import JSZip from "jszip"
import { readFileSync, writeFileSync } from "fs"
import { parseStringPromise, Builder } from "xml2js"
import { addRelationship, ensureContentType, partRelsPath, parseSuggestion, readRelationships, SUGGESTED_TEXT_PREFIX } from "./parts.js"

export interface PptxComment {
  id: string
  author: string
  text: string
  timestamp: Date
  slide: number
  x: number
  y: number
  parentId: string | null
  resolved: boolean
  suggestedText?: string | null
}

export type ApproveResult = "applied" | "not-found" | "no-suggestion"

const PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
const COMMENTS_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
const COMMENTS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.comments+xml"
const COMMENT_AUTHORS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml"

export async function writeComment(pptxPath: string, comment: PptxComment): Promise<void> {
  const data = readFileSync(pptxPath)
  const zip = await JSZip.loadAsync(data)

  const authorId = await ensureAuthor(zip, comment.author)
  const storedText = comment.suggestedText
    ? `${SUGGESTED_TEXT_PREFIX}${comment.suggestedText}`
    : comment.text
  await appendCommentElement(zip, comment, authorId, storedText)

  const slidePart = await resolveSlidePart(zip, comment.slide)
  const slideRelsPath = partRelsPath(slidePart)
  await addRelationship(zip, slideRelsPath, COMMENTS_REL_TYPE, "../comments/comment1.xml")
  await ensureContentType(zip, "/ppt/comments/comment1.xml", COMMENTS_CONTENT_TYPE)
  await ensureContentType(zip, "/ppt/commentAuthors.xml", COMMENT_AUTHORS_CONTENT_TYPE)

  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(pptxPath, buffer)
}

export async function readComments(pptxPath: string): Promise<PptxComment[]> {
  const data = readFileSync(pptxPath)
  const zip = await JSZip.loadAsync(data)

  const slideOfComments = await findSlideIndexForCommentsPart(zip)
  const authors = await readAuthors(zip)
  const commentsFile = zip.file("ppt/comments/comment1.xml")
  if (!commentsFile) {
    return []
  }
  const content = await commentsFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const root = obj["p:cmLst"] || obj.cmLst
  if (!root || !root["p:cm"]) {
    return []
  }
  const elements = Array.isArray(root["p:cm"]) ? root["p:cm"] : [root["p:cm"]]

  return elements.map((elem: any) => {
    const authorId = elem.$?.authorId ?? "0"
    const pos = elem["p:pos"] || elem.pos
    const text = elem["p:text"] || elem.text || ""
    return {
      id: `slide-${slideOfComments}-cm-${elem.$.idx}`,
      author: authors[authorId] || "Unknown",
      text,
      timestamp: new Date(elem.$.dt || Date.now()),
      slide: slideOfComments,
      x: pos?.$?.x ? parseInt(pos.$.x, 10) : 0,
      y: pos?.$?.y ? parseInt(pos.$.y, 10) : 0,
      parentId: null,
      resolved: false,
      suggestedText: parseSuggestion(text, SUGGESTED_TEXT_PREFIX),
    }
  })
}

async function ensureAuthor(zip: JSZip, author: string): Promise<number> {
  const authorsPath = "ppt/commentAuthors.xml"
  const authorsFile = zip.file(authorsPath)
  let root: any
  if (authorsFile) {
    const content = await authorsFile.async("string")
    root = await parseStringPromise(content, { explicitArray: false })
    root = root["p:cmAuthorLst"] || root.cmAuthorLst
  } else {
    root = { $: { "xmlns:p": PRESENTATION_NS }, "p:cmAuthor": [] }
  }
  if (!root["p:cmAuthor"]) {
    root["p:cmAuthor"] = []
  }
  if (!Array.isArray(root["p:cmAuthor"])) {
    root["p:cmAuthor"] = [root["p:cmAuthor"]]
  }
  const existing = root["p:cmAuthor"].find((a: any) => (a.$.name || a.$.Name) === author)
  if (existing) {
    return parseInt(existing.$.id, 10)
  }
  const newId = root["p:cmAuthor"].length
  root["p:cmAuthor"].push({
    $: {
      id: String(newId),
      name: author,
      initials: author.charAt(0).toUpperCase(),
      lastIdx: "0",
      clrIdx: String(newId % 7),
    },
  })
  const xml = new Builder({
    rootName: "p:cmAuthorLst",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(root)
  zip.file(authorsPath, xml)
  return newId
}

async function appendCommentElement(
  zip: JSZip,
  comment: PptxComment,
  authorId: number,
  storedText: string
): Promise<void> {
  const commentsPath = "ppt/comments/comment1.xml"
  const commentsFile = zip.file(commentsPath)
  let root: any
  if (commentsFile) {
    const content = await commentsFile.async("string")
    root = await parseStringPromise(content, { explicitArray: false })
    root = root["p:cmLst"] || root.cmLst
  } else {
    root = { $: { "xmlns:p": PRESENTATION_NS }, "p:cm": [] }
  }
  if (!root["p:cm"]) {
    root["p:cm"] = []
  }
  if (!Array.isArray(root["p:cm"])) {
    root["p:cm"] = [root["p:cm"]]
  }
  const authorComments = root["p:cm"].filter(
    (c: any) => String(c.$?.authorId) === String(authorId)
  )
  const idx = authorComments.length + 1
  root["p:cm"].push({
    $: {
      authorId: String(authorId),
      dt: comment.timestamp.toISOString(),
      idx: String(idx),
    },
    "p:pos": { $: { x: String(comment.x), y: String(comment.y) } },
    "p:text": storedText,
  })
  const xml = new Builder({
    rootName: "p:cmLst",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(root)
  zip.file(commentsPath, xml)
  await bumpAuthorLastIdx(zip, authorId, idx)
}

async function bumpAuthorLastIdx(zip: JSZip, authorId: number, lastIdx: number): Promise<void> {
  const authorsPath = "ppt/commentAuthors.xml"
  const authorsFile = zip.file(authorsPath)
  if (!authorsFile) {
    return
  }
  const content = await authorsFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const root = obj["p:cmAuthorLst"] || obj.cmAuthorLst
  const authors = root?.["p:cmAuthor"]
  const list = authors ? (Array.isArray(authors) ? authors : [authors]) : []
  const author = list.find((a: any) => String(a.$.id) === String(authorId))
  if (!author) {
    return
  }
  author.$.lastIdx = String(lastIdx)
  const xml = new Builder({
    rootName: "p:cmAuthorLst",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(root)
  zip.file(authorsPath, xml)
}

async function resolveSlidePart(zip: JSZip, slideIndex: number): Promise<string> {
  const presentationFile = zip.file("ppt/presentation.xml")
  if (!presentationFile) {
    throw new Error("presentation.xml not found in PPTX")
  }
  const content = await presentationFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const root = obj["p:presentation"] || obj.presentation
  if (!root?.["p:sldIdLst"]?.["p:sldId"]) {
    throw new Error("No slides found in presentation")
  }
  const slides = Array.isArray(root["p:sldIdLst"]["p:sldId"])
    ? root["p:sldIdLst"]["p:sldId"]
    : [root["p:sldIdLst"]["p:sldId"]]
  const target = slides[slideIndex]
  if (!target) {
    throw new Error(`Slide ${slideIndex} not found (presentation has ${slides.length} slides)`)
  }
  const rid = target.$?.["r:id"]
  const relationships = await readRelationships(zip, "ppt/_rels/presentation.xml.rels")
  const rel = relationships.find((r) => r.id === rid)
  if (!rel) {
    throw new Error(`Slide relationship ${rid} not found`)
  }
  return `ppt/${rel.target}`
}

async function findSlideIndexForCommentsPart(zip: JSZip): Promise<number> {
  const presentationFile = zip.file("ppt/presentation.xml")
  if (!presentationFile) {
    return -1
  }
  const content = await presentationFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const root = obj["p:presentation"] || obj.presentation
  const slideIds = root?.["p:sldIdLst"]?.["p:sldId"]
  if (!slideIds) {
    return -1
  }
  const slides = Array.isArray(slideIds) ? slideIds : [slideIds]
  const presentationRels = await readRelationships(zip, "ppt/_rels/presentation.xml.rels")
  for (let i = 0; i < slides.length; i += 1) {
    const rid = slides[i].$?.["r:id"]
    const slideRel = presentationRels.find((r) => r.id === rid)
    if (!slideRel) {
      continue
    }
    const slidePart = `ppt/${slideRel.target}`
    const slideRelsPath = partRelsPath(slidePart)
    const slideRels = await readRelationships(zip, slideRelsPath)
    if (slideRels.some((r) => r.type === COMMENTS_REL_TYPE)) {
      return i
    }
  }
  return -1
}

async function readAuthors(zip: JSZip): Promise<Record<string, string>> {
  const authorsFile = zip.file("ppt/commentAuthors.xml")
  if (!authorsFile) {
    return {}
  }
  const content = await authorsFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const root = obj["p:cmAuthorLst"] || obj.cmAuthorLst
  if (!root?.["p:cmAuthor"]) {
    return {}
  }
  const elements = Array.isArray(root["p:cmAuthor"]) ? root["p:cmAuthor"] : [root["p:cmAuthor"]]
  const map: Record<string, string> = {}
  for (const a of elements) {
    map[String(a.$.id)] = a.$.name || "Unknown"
  }
  return map
}

export async function applySlideSuggestion(pptxPath: string, commentId: string): Promise<ApproveResult> {
  const match = commentId.match(/^slide-(\d+)-cm-(\d+)$/)
  if (!match) {
    return "not-found"
  }
  const slideIndex = parseInt(match[1], 10)
  const idx = parseInt(match[2], 10)

  const data = readFileSync(pptxPath)
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("ppt/comments/comment1.xml")
  if (!commentsFile) {
    return "not-found"
  }
  const commentsContent = await commentsFile.async("string")
  const commentsObj = await parseStringPromise(commentsContent, { explicitArray: false })
  const commentsRoot = commentsObj["p:cmLst"] || commentsObj.cmLst
  const commentElements = commentsRoot?.["p:cm"]
    ? Array.isArray(commentsRoot["p:cm"])
      ? commentsRoot["p:cm"]
      : [commentsRoot["p:cm"]]
    : []
  const target = commentElements.find((c: any) => String(c.$?.idx) === String(idx))
  if (!target) {
    return "not-found"
  }
  const text = target["p:text"] || target.text || ""
  const suggestion = parseSuggestion(text, SUGGESTED_TEXT_PREFIX)
  if (suggestion === null) {
    return "no-suggestion"
  }

  const slidePart = await resolveSlidePart(zip, slideIndex)
  await replaceFirstTextBox(zip, slidePart, suggestion)

  commentsRoot["p:cm"] = commentElements.filter((c: any) => c !== target)
  const newCommentsXml = new Builder({
    rootName: "p:cmLst",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(commentsRoot)
  zip.file("ppt/comments/comment1.xml", newCommentsXml)

  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(pptxPath, buffer)
  return "applied"
}

async function replaceFirstTextBox(zip: JSZip, slidePart: string, suggestion: string): Promise<void> {
  const slideFile = zip.file(slidePart)
  if (!slideFile) {
    throw new Error(`Slide part ${slidePart} not found`)
  }
  const content = await slideFile.async("string")
  const obj = await parseStringPromise(content, { explicitArray: false })
  const root = obj["p:sld"] || obj.sld
  const spTree = root?.["p:cSld"]?.["p:spTree"]
  const shapes = spTree?.["p:sp"] ? (Array.isArray(spTree["p:sp"]) ? spTree["p:sp"] : [spTree["p:sp"]]) : []
  const target = shapes.find((s: any) => s["p:txBody"])
  if (!target) {
    throw new Error("No text box found on slide")
  }
  const txBody = target["p:txBody"]
  const paras = txBody["a:p"] ? (Array.isArray(txBody["a:p"]) ? txBody["a:p"] : [txBody["a:p"]]) : []
  if (paras.length === 0) {
    txBody["a:p"] = { "a:r": { "a:t": suggestion } }
  } else {
    const firstPara = paras[0]
    const runs = firstPara["a:r"]
      ? Array.isArray(firstPara["a:r"])
        ? firstPara["a:r"]
        : [firstPara["a:r"]]
      : []
    if (runs.length === 0) {
      firstPara["a:r"] = { "a:t": suggestion }
    } else {
      const firstRun = runs[0]
      firstRun["a:t"] = suggestion
      firstPara["a:r"] = firstRun
      txBody["a:p"] = firstPara
    }
  }
  const xml = new Builder({
    rootName: "p:sld",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(root)
  zip.file(slidePart, xml)
}
