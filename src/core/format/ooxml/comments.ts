import JSZip from "jszip"
import { readFileSync, writeFileSync } from "fs"
import { parseStringPromise, Builder } from "xml2js"
import { SUGGESTED_TEXT_PREFIX, parseSuggestion, OPENOFFICE_NS, OO_XMLNS_ATTR, OO_STATUS_ATTR, OO_ORIG_ID_ATTR, openofficeStatusAttributes, parseStatus, type CommentStatus } from "@/core/format/ooxml/parts"

// ponytail: w:id must be integer for ECMA-376 — map "c2" → "2", keep orig in oo:origId for logical id
function numericWId(id: string): string {
  const m = id.match(/\d+/)
  return m ? m[0] : String(Math.abs([...id].reduce((a, c) => a + c.charCodeAt(0), 0)) % 10000)
}
function isZipBuffer(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b
}

export interface Comment {
  id: string
  author: string
  text: string
  timestamp: Date
  rangeStart: { paragraph: number; offset: number }
  rangeEnd: { paragraph: number; offset: number }
  parentId: string | null
  status: CommentStatus
  suggestedText?: string | null
}

export type ApproveResult = "applied" | "not-found" | "no-suggestion"

export async function writeComment(docPath: string, comment: Comment): Promise<void> {
  const data = readFileSync(docPath)
  const zip = await JSZip.loadAsync(data)

  // Read or create comments.xml
  let commentsXml = zip.file("word/comments.xml")
  let commentsObj: any

  if (commentsXml) {
    const content = await commentsXml.async("string")
    const parsed = await parseStringPromise(content, { explicitArray: false })
    // files written by this plugin have root "w:comments"; accept either
    const root = parsed.comments || parsed["w:comments"] || {}
    const existing = (root["w:comment"] ?? root.comment ?? []) as any
    commentsObj = { comments: { ...root, "w:comment": Array.isArray(existing) ? existing : existing ? [existing] : [] } }
    // keep legacy key for compat
    if (!commentsObj.comments["w:comment"]) commentsObj.comments["w:comment"] = []
    // normalize to w:comment
    if (commentsObj.comments.comment && !commentsObj.comments["w:comment"].length) {
      commentsObj.comments["w:comment"] = Array.isArray(commentsObj.comments.comment) ? commentsObj.comments.comment : [commentsObj.comments.comment]
      delete commentsObj.comments.comment
    }
    if (commentsObj.comments.comment) delete commentsObj.comments.comment
  } else {
    commentsObj = {
      comments: {
        $: {
          "xmlns:w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        },
        "w:comment": [],
      },
    }
  }

  // Add comment to comments.xml
  const storedText = comment.suggestedText
    ? `${SUGGESTED_TEXT_PREFIX}${comment.suggestedText}`
    : comment.text
  // resolved rides the standard w:done attribute; denied has no OOXML standard,
  // so it uses the plugin namespace declared locally on the element (parts.ts).
  const statusAttrs =
    comment.status === "resolved" ? { "w:done": "1" } : openofficeStatusAttributes(comment.status)
  const nid = numericWId(comment.id)
  const origAttr = nid !== comment.id ? { [OO_ORIG_ID_ATTR]: comment.id, [OO_XMLNS_ATTR]: OPENOFFICE_NS } : {}
  // ponytail: Word modern comments need w14:paraId/durableId linking — generate once, reuse for comment + extended files
  const paraId = Math.floor(Math.random() * 0x7ffffffe).toString(16).padStart(8, "0").toUpperCase()
  const durableId = Math.floor(Math.random() * 0x7ffffffe).toString(16).padStart(8, "0").toUpperCase()
  const commentElement = {
    $: {
      "w:id": nid,
      "w:author": comment.author,
      "w:date": comment.timestamp.toISOString(),
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
  }

  if (!Array.isArray(commentsObj.comments["w:comment"])) {
    const cur = commentsObj.comments["w:comment"] ?? commentsObj.comments.comment
    commentsObj.comments["w:comment"] = cur ? (Array.isArray(cur) ? cur : [cur]) : []
    if (commentsObj.comments.comment) delete commentsObj.comments.comment
  }
  commentsObj.comments["w:comment"].push(commentElement)

  // Write comments.xml back
  const builder = new Builder({
    rootName: "w:comments",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  })
  // Build from the inner structure, rootName will wrap it
  const commentsContent = commentsObj.comments
  const newCommentsXml = builder.buildObject(commentsContent)
  zip.file("word/comments.xml", newCommentsXml)

  // Ensure [Content_Types].xml and rels for all comment parts (Word modern comments need all 4)
  const ensureCtAndRels = async () => {
    const ctFile2 = zip.file("[Content_Types].xml")
    const relsFile2 = zip.file("word/_rels/document.xml.rels")
    const needed = [
      {
        part: "/word/comments.xml",
        ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
        relType: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
        relTarget: "comments.xml",
      },
      {
        part: "/word/commentsExtended.xml",
        ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml",
        relType: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
        relTarget: "commentsExtended.xml",
      },
      {
        part: "/word/commentsIds.xml",
        ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml",
        relType: "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds",
        relTarget: "commentsIds.xml",
      },
      {
        part: "/word/commentsExtensible.xml",
        ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml",
        relType: "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible",
        relTarget: "commentsExtensible.xml",
      },
    ]
    if (ctFile2) {
      let ct = await ctFile2.async("string")
      let changed = false
      for (const n of needed) {
        if (!ct.includes(`PartName="${n.part}"`)) {
          ct = ct.replace("</Types>", `<Override PartName="${n.part}" ContentType="${n.ct}"/></Types>`)
          changed = true
        }
      }
      if (changed) zip.file("[Content_Types].xml", ct)
    }
    if (relsFile2) {
      let rels = await relsFile2.async("string")
      let changed = false
      for (const n of needed) {
        if (!rels.includes(`Target="${n.relTarget}"`)) {
          const nextId = (() => {
            const m = [...rels.matchAll(/Id="rId(\d+)"/g)]
            const nums = m.map((x) => parseInt(x[1], 10))
            return nums.length ? Math.max(...nums) + 1 : 7
          })()
          rels = rels.replace(
            "</Relationships>",
            `<Relationship Id="rId${nextId}" Type="${n.relType}" Target="${n.relTarget}"/></Relationships>`
          )
          changed = true
        }
      }
      if (changed) zip.file("word/_rels/document.xml.rels", rels)
    }
    // ensure the 3 extended xml files exist (copy from template if missing) — Word needs them even if empty
    const templateMap: Record<string, string> = {
      "word/commentsExtended.xml": "skills/docx/scripts/templates/commentsExtended.xml",
      "word/commentsIds.xml": "skills/docx/scripts/templates/commentsIds.xml",
      "word/commentsExtensible.xml": "skills/docx/scripts/templates/commentsExtensible.xml",
    }
    for (const [zipPath, tmpl] of Object.entries(templateMap)) {
      if (!zip.file(zipPath)) {
        try {
          const tmplContent = readFileSync(tmpl, "utf-8")
          zip.file(zipPath, tmplContent)
        } catch {}
        // also try isolated-workspace path
        try {
          const tmpl2 = `tests/isolated-workspace/${tmpl}`
          const tmplContent2 = readFileSync(tmpl2, "utf-8")
          if (!zip.file(zipPath)) zip.file(zipPath, tmplContent2)
        } catch {}
      }
    }
  }
  await ensureCtAndRels()
  // also seed the extended comment files with an entry for this comment (Word modern comments need it) — reuse same paraId/durableId as comment
  try {
    const ts = new Date().toISOString()
    const ext = zip.file("word/commentsExtended.xml")
    if (ext) {
      let xml = await ext.async("string")
      if (!xml.includes(`w15:paraId="${paraId}"`)) {
        xml = xml.replace("</w15:commentsEx>", `<w15:commentEx w15:paraId="${paraId}" w15:done="0"/></w15:commentsEx>`)
        zip.file("word/commentsExtended.xml", xml)
      }
    }
    const ids = zip.file("word/commentsIds.xml")
    if (ids) {
      let xml = await ids.async("string")
      if (!xml.includes(`w16cid:paraId="${paraId}"`)) {
        xml = xml.replace(
          "</w16cid:commentsIds>",
          `<w16cid:commentId w16cid:paraId="${paraId}" w16cid:durableId="${durableId}"/></w16cid:commentsIds>`
        )
        zip.file("word/commentsIds.xml", xml)
      }
    }
    const extble = zip.file("word/commentsExtensible.xml")
    if (extble) {
      let xml = await extble.async("string")
      if (!xml.includes(`w16cex:durableId="${durableId}"`)) {
        xml = xml.replace(
          "</w16cex:commentsExtensible>",
          `<w16cex:commentExtensible w16cex:durableId="${durableId}"/></w16cex:commentsExtensible>`
        )
        zip.file("word/commentsExtensible.xml", xml)
      }
    }
  } catch {}

  // Read document.xml and add comment range markers — string-based to keep markers as direct w:p children (never inside w:r)
  const documentXml = zip.file("word/document.xml")
  if (documentXml) {
    let docContent = await documentXml.async("string")
    const wid = numericWId(comment.id)
    // Find nth w:p
    const paraRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
    let idx = 0
    let m: RegExpExecArray | null
    let lastIdx = 0
    let out = ""
    let found = false
    while ((m = paraRegex.exec(docContent)) !== null) {
      if (idx === comment.rangeStart.paragraph) {
        let para = m[0]
        const pPrEnd = para.indexOf("</w:pPr>")
        const insertPos = pPrEnd !== -1 ? pPrEnd + "</w:pPr>".length : para.indexOf(">") + 1
        const startMarker = `<w:commentRangeStart w:id="${wid}"/>`
        const endMarker = `<w:commentRangeEnd w:id="${wid}"/>`
        const refRun = `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${wid}"/></w:r>`
        para = para.slice(0, insertPos) + startMarker + para.slice(insertPos)
        const closeIdx = para.lastIndexOf("</w:p>")
        para = para.slice(0, closeIdx) + endMarker + refRun + para.slice(closeIdx)
        out += docContent.slice(lastIdx, m.index) + para
        lastIdx = paraRegex.lastIndex
        found = true
      }
      idx++
    }
    if (found) {
      out += docContent.slice(lastIdx)
      zip.file("word/document.xml", out)
    } else {
      // fallback: no para found, keep original
      zip.file("word/document.xml", docContent)
    }
  }

  // Write back to file
  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(docPath, buffer)
}

export async function readComments(docPath: string): Promise<Comment[]> {
  const data = readFileSync(docPath)
  // ponytail: edit after comment overwrites zip with markdown — not a zip, no comments
  if (data.length < 2 || data[0] !== 0x50 || data[1] !== 0x4b) return []
  const zip = await JSZip.loadAsync(data)

  const commentsXml = zip.file("word/comments.xml")
  if (!commentsXml) {
    return []
  }

  const content = await commentsXml.async("string")
  const commentsObj = await parseStringPromise(content, { explicitArray: false })

  // Handle namespace variations
  const commentsRoot = commentsObj.comments || commentsObj["w:comments"]
  const raw = commentsRoot?.["w:comment"] ?? commentsRoot?.comment
  if (!commentsRoot || !raw) {
    return []
  }

  const commentElements = Array.isArray(raw) ? raw : [raw]

  return commentElements.map((elem: any) => {
    const text = elem["w:p"]?.["w:r"]?.["w:t"] || ""
    return {
      id: elem.$[OO_ORIG_ID_ATTR] || elem.$["w:id"] || elem.$.id,
      author: elem.$["w:author"] || elem.$.author,
      text: typeof text === "string" ? text : "",
      timestamp: new Date(elem.$["w:date"] || elem.$.date),
      rangeStart: { paragraph: 0, offset: 0 }, // Simplified - real impl needs to parse markers
      rangeEnd: { paragraph: 0, offset: 0 },
      parentId: null,
      status: parseStatus(elem.$),
      suggestedText: parseSuggestion(typeof text === "string" ? text : "", SUGGESTED_TEXT_PREFIX),
    }
  })
}

export async function applyCommentSuggestion(docPath: string, commentId: string): Promise<ApproveResult> {
  const data = readFileSync(docPath)
  if (!isZipBuffer(data)) return "not-found"
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("word/comments.xml")
  if (!commentsFile) {
    return "not-found"
  }
  const commentsContent = await commentsFile.async("string")
  const commentsObj = await parseStringPromise(commentsContent, { explicitArray: false })
  const commentsRoot = commentsObj.comments || commentsObj["w:comments"]
  const rawEls = commentsRoot?.["w:comment"] ?? commentsRoot?.comment ?? []
  const commentElements = Array.isArray(rawEls) ? rawEls : rawEls ? [rawEls] : []
  const nid = numericWId(commentId)
  const target = commentElements.find(
    (c: any) =>
      c.$?.[OO_ORIG_ID_ATTR] === commentId ||
      c.$?.["w:id"] === commentId ||
      c.$?.["w:id"] === nid ||
      c.$?.id === commentId
  )
  if (!target) {
    return "not-found"
  }
  const commentText = target["w:p"]?.["w:r"]?.["w:t"] || ""
  const suggestion = parseSuggestion(commentText, SUGGESTED_TEXT_PREFIX)
  if (suggestion === null) {
    return "no-suggestion"
  }

  const documentXml = zip.file("word/document.xml")
  if (!documentXml) {
    throw new Error("document.xml not found in DOCX")
  }
  const docContent = await documentXml.async("string")
  const docObj = await parseStringPromise(docContent, { explicitArray: false })
  const root = docObj.document || docObj["w:document"]
  const body = root?.body || root?.["w:body"]
  const paragraphs = body?.["w:p"] ? (Array.isArray(body["w:p"]) ? body["w:p"] : [body["w:p"]]) : []
  const markerId = (m: any) => m?.$?.["w:id"] === commentId || m?.$?.id === commentId || m?.$?.["w:id"] === nid
  const hasStart = (para: any) => {
    const direct = para["w:commentRangeStart"]
    if (direct) {
      const arr = Array.isArray(direct) ? direct : [direct]
      if (arr.some(markerId)) return true
    }
    const runs = Array.isArray(para["w:r"]) ? para["w:r"] : para["w:r"] ? [para["w:r"]] : []
    return runs.some((r: any) => r["w:commentRangeStart"] && markerId(r["w:commentRangeStart"]))
  }
  const targetPara = paragraphs.find(hasStart)
  if (!targetPara) {
    return "not-found"
  }

  // ponytail: strip direct markers and reference runs (both old nested and new direct forms)
  if (targetPara["w:commentRangeStart"]) delete targetPara["w:commentRangeStart"]
  if (targetPara["w:commentRangeEnd"]) delete targetPara["w:commentRangeEnd"]
  const runs = Array.isArray(targetPara["w:r"]) ? targetPara["w:r"] : targetPara["w:r"] ? [targetPara["w:r"]] : []
  const filtered = runs.filter(
    (r: any) =>
      !r["w:commentRangeStart"] &&
      !r["w:commentRangeEnd"] &&
      !r["w:r"]?.["w:commentReference"] &&
      !r["w:commentReference"]
  )
  // find the run that held the original text (first with w:t) or create one
  let replaced = false
  for (const r of filtered) {
    if (r["w:t"] !== undefined && !replaced) {
      r["w:t"] = suggestion
      replaced = true
    }
  }
  if (!replaced) filtered.push({ "w:t": suggestion })
  targetPara["w:r"] = filtered.length === 1 ? filtered[0] : filtered
  const newDocXml = new Builder().buildObject(docObj)
  zip.file("word/document.xml", newDocXml)

  const filteredComments = commentElements.filter((c: any) => c !== target)
  if (commentsRoot["w:comment"] !== undefined) commentsRoot["w:comment"] = filteredComments
  else commentsRoot.comment = filteredComments
  if (filteredComments.length === 0) {
    if (commentsRoot["w:comment"] !== undefined) delete commentsRoot["w:comment"]
    if (commentsRoot.comment !== undefined) delete commentsRoot.comment
  }
  const newCommentsXml = new Builder({
    rootName: "w:comments",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(commentsRoot)
  zip.file("word/comments.xml", newCommentsXml)

  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(docPath, buffer)
  return "applied"
}


export async function updateComment(
  docPath: string,
  commentId: string,
  update: { text?: string; suggestedText?: string }
): Promise<"updated" | "not-found"> {
  const data = readFileSync(docPath)
  if (!isZipBuffer(data)) return "not-found"
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("word/comments.xml")
  if (!commentsFile) {
    return "not-found"
  }
  const commentsObj = await parseStringPromise(await commentsFile.async("string"), { explicitArray: false })
  const commentsRoot = commentsObj.comments || commentsObj["w:comments"]
  const rawU = commentsRoot?.["w:comment"] ?? commentsRoot?.comment
  const commentElements = rawU ? (Array.isArray(rawU) ? rawU : [rawU]) : []
  const nidU = numericWId(commentId)
  const target = commentElements.find(
    (c: any) =>
      c.$?.[OO_ORIG_ID_ATTR] === commentId ||
      c.$?.["w:id"] === commentId ||
      c.$?.["w:id"] === nidU ||
      c.$?.id === commentId
  )
  if (!target) {
    return "not-found"
  }
  // ponytail: a suggestion replaces the note text, same convention as writeComment
  const storedText =
    update.suggestedText !== undefined
      ? `${SUGGESTED_TEXT_PREFIX}${update.suggestedText}`
      : (update.text as string)
  target["w:p"] = { "w:r": { "w:t": storedText } }
  // normalize to w:comment for valid OOXML
  if (commentsRoot.comment && !commentsRoot["w:comment"]) {
    commentsRoot["w:comment"] = commentsRoot.comment
    delete commentsRoot.comment
  } else if (commentsRoot["w:comment"]) {
    if (commentsRoot.comment) delete commentsRoot.comment
    commentsRoot["w:comment"] = commentElements
  }
  const newCommentsXml = new Builder({
    rootName: "w:comments",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(commentsRoot)
  zip.file("word/comments.xml", newCommentsXml)

  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(docPath, buffer)
  return "updated"
}

export async function deleteComment(docPath: string, commentId: string): Promise<"deleted" | "not-found"> {
  const data = readFileSync(docPath)
  if (!isZipBuffer(data)) return "not-found"
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("word/comments.xml")
  if (!commentsFile) {
    return "not-found"
  }
  const commentsObj = await parseStringPromise(await commentsFile.async("string"), { explicitArray: false })
  const commentsRoot = commentsObj.comments || commentsObj["w:comments"]
  const rawD = commentsRoot?.["w:comment"] ?? commentsRoot?.comment
  const commentElements = rawD ? (Array.isArray(rawD) ? rawD : [rawD]) : []
  const nidD = numericWId(commentId)
  const isTarget = (c: any) =>
    c.$?.[OO_ORIG_ID_ATTR] === commentId ||
    c.$?.["w:id"] === commentId ||
    c.$?.["w:id"] === nidD ||
    c.$?.id === commentId
  if (!commentElements.some(isTarget)) {
    return "not-found"
  }
  const filtered = commentElements.filter((c: any) => !isTarget(c))
  if (commentsRoot["w:comment"] !== undefined || !commentsRoot.comment) {
    commentsRoot["w:comment"] = filtered
    if (commentsRoot.comment) delete commentsRoot.comment
  } else {
    commentsRoot.comment = filtered
  }
  if (filtered.length === 0) {
    if (commentsRoot["w:comment"] !== undefined) delete commentsRoot["w:comment"]
    if (commentsRoot.comment !== undefined) delete commentsRoot.comment
  }
  const newCommentsXml = new Builder({
    rootName: "w:comments",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(commentsRoot)
  zip.file("word/comments.xml", newCommentsXml)

  // Remove the range markers from document.xml (our writer nests them in the w:r array,
  // Word places them as direct children of w:p — handle both).
  const documentXml = zip.file("word/document.xml")
  if (documentXml) {
    const docObj = await parseStringPromise(await documentXml.async("string"), { explicitArray: false })
    const root = docObj.document || docObj["w:document"]
    const body = root?.body || root?.["w:body"]
    const paragraphs = body?.["w:p"]
      ? Array.isArray(body["w:p"])
        ? body["w:p"]
        : [body["w:p"]]
      : []
    for (const para of paragraphs) {
      const markerId = (m: any) => m?.$?.["w:id"] === commentId || m?.$?.["w:id"] === nidD || m?.$?.id === commentId
      for (const key of ["w:commentRangeStart", "w:commentRangeEnd"]) {
        const v = para[key]
        if (!v) continue
        if (Array.isArray(v)) {
          const keptM = v.filter((m: any) => !markerId(m))
          if (keptM.length === 0) delete para[key]
          else if (keptM.length === 1) para[key] = keptM[0]
          else para[key] = keptM
        } else if (markerId(v)) {
          delete para[key]
        }
      }
      const runs = para["w:r"]
        ? Array.isArray(para["w:r"])
          ? para["w:r"]
          : [para["w:r"]]
        : []
      const kept = runs.filter((r: any) => {
        if (r["w:commentRangeStart"] && markerId(r["w:commentRangeStart"])) {
          return false
        }
        if (r["w:commentRangeEnd"] && markerId(r["w:commentRangeEnd"])) {
          return false
        }
        const refNested = r["w:r"]?.["w:commentReference"]
        if (refNested && markerId(refNested)) return false
        const refDirect = r["w:commentReference"]
        if (refDirect && markerId(refDirect)) return false
        return true
      })
      if (kept.length > 0) {
        para["w:r"] = kept
      } else {
        delete para["w:r"]
      }
    }
    zip.file("word/document.xml", new Builder().buildObject(docObj))
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(docPath, buffer)
  return "deleted"
}

export async function setCommentStatus(
  docPath: string,
  commentId: string,
  status: CommentStatus
): Promise<"ok" | "not-found"> {
  const data = readFileSync(docPath)
  if (!isZipBuffer(data)) return "not-found"
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("word/comments.xml")
  if (!commentsFile) {
    return "not-found"
  }
  const commentsObj = await parseStringPromise(await commentsFile.async("string"), { explicitArray: false })
  const commentsRoot = commentsObj.comments || commentsObj["w:comments"]
  const rawS = commentsRoot?.["w:comment"] ?? commentsRoot?.comment
  const commentElements = rawS ? (Array.isArray(rawS) ? rawS : [rawS]) : []
  const nidS = numericWId(commentId)
  const target = commentElements.find(
    (c: any) =>
      c.$?.[OO_ORIG_ID_ATTR] === commentId ||
      c.$?.["w:id"] === commentId ||
      c.$?.["w:id"] === nidS ||
      c.$?.id === commentId
  )
  if (!target) {
    return "not-found"
  }
  const attrs = target.$ ?? (target.$ = {})
  delete attrs["w:done"]
  delete attrs.done
  delete attrs[OO_STATUS_ATTR]
  delete attrs[OO_XMLNS_ATTR]
  if (status === "resolved") {
    attrs["w:done"] = "1"
  } else if (status === "denied") {
    attrs[OO_XMLNS_ATTR] = OPENOFFICE_NS
    attrs[OO_STATUS_ATTR] = "denied"
  }
  // normalize to w:comment for OOXML validity
  if (commentsRoot.comment && !commentsRoot["w:comment"]) {
    commentsRoot["w:comment"] = commentsRoot.comment
    delete commentsRoot.comment
  } else if (commentsRoot["w:comment"]) {
    if (commentsRoot.comment) delete commentsRoot.comment
    commentsRoot["w:comment"] = commentElements
  }
  const newCommentsXml = new Builder({
    rootName: "w:comments",
    headless: false,
    xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
  }).buildObject(commentsRoot)
  zip.file("word/comments.xml", newCommentsXml)

  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(docPath, buffer)
  return "ok"
}
