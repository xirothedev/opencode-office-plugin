import JSZip from "jszip"
import { readFileSync, writeFileSync } from "fs"
import { parseStringPromise, Builder } from "xml2js"
import { SUGGESTED_TEXT_PREFIX, parseSuggestion, OPENOFFICE_NS, OO_XMLNS_ATTR, OO_STATUS_ATTR, openofficeStatusAttributes, parseStatus, type CommentStatus } from "@/core/format/ooxml/parts"

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
    commentsObj = { comments: parsed.comments || parsed["w:comments"] || { comment: [] } }
    if (!commentsObj.comments.comment) {
      commentsObj.comments.comment = []
    }
  } else {
    commentsObj = {
      comments: {
        $: {
          "xmlns:w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        },
        comment: [],
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
  const commentElement = {
    $: {
      "w:id": comment.id,
      "w:author": comment.author,
      "w:date": comment.timestamp.toISOString(),
      "w:initials": comment.author.charAt(0).toUpperCase(),
      ...statusAttrs,
    },
    "w:p": {
      "w:r": {
        "w:t": storedText,
      },
    },
  }

  if (!Array.isArray(commentsObj.comments.comment)) {
    commentsObj.comments.comment = commentsObj.comments.comment ? [commentsObj.comments.comment] : []
  }
  commentsObj.comments.comment.push(commentElement)

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

  // Read document.xml and add comment range markers
  const documentXml = zip.file("word/document.xml")
  if (documentXml) {
    const docContent = await documentXml.async("string")
    const docObj = await parseStringPromise(docContent, { explicitArray: false })

    // Find body - handle namespace variations
    const root = docObj.document || docObj["w:document"]
    if (!root) {
      throw new Error("Could not find document root element")
    }
    const body = root.body || root["w:body"]
    if (!body) {
      throw new Error("Could not find document body element")
    }

    // Add commentRangeStart and commentRangeEnd markers
    // For now, wrap entire paragraph (simplified - real implementation needs precise offset handling)
    const paragraphs = body["w:p"] ? (Array.isArray(body["w:p"]) ? body["w:p"] : [body["w:p"]]) : []
    const targetPara = paragraphs[comment.rangeStart.paragraph]

    if (targetPara) {
      // Add comment reference to paragraph
      if (!targetPara["w:r"]) {
        targetPara["w:r"] = []
      }
      if (!Array.isArray(targetPara["w:r"])) {
        targetPara["w:r"] = [targetPara["w:r"]]
      }

      // Add commentRangeStart
      targetPara["w:r"].unshift({
        "w:commentRangeStart": {
          $: { "w:id": comment.id },
        },
      })

      // Add commentRangeEnd and commentReference
      targetPara["w:r"].push({
        "w:commentRangeEnd": {
          $: { "w:id": comment.id },
        },
      })
      targetPara["w:r"].push({
        "w:r": {
          "w:rPr": {
            "w:rStyle": { $: { "w:val": "CommentReference" } },
          },
          "w:commentReference": {
            $: { "w:id": comment.id },
          },
        },
      })
    }

    const newDocXml = new Builder().buildObject(docObj)
    zip.file("word/document.xml", newDocXml)
  }

  // Write back to file
  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(docPath, buffer)
}

export async function readComments(docPath: string): Promise<Comment[]> {
  const data = readFileSync(docPath)
  const zip = await JSZip.loadAsync(data)

  const commentsXml = zip.file("word/comments.xml")
  if (!commentsXml) {
    return []
  }

  const content = await commentsXml.async("string")
  const commentsObj = await parseStringPromise(content, { explicitArray: false })

  // Handle namespace variations
  const commentsRoot = commentsObj.comments || commentsObj["w:comments"]
  if (!commentsRoot || !commentsRoot.comment) {
    return []
  }

  const commentElements = Array.isArray(commentsRoot.comment)
    ? commentsRoot.comment
    : [commentsRoot.comment]

  return commentElements.map((elem: any) => {
    const text = elem["w:p"]?.["w:r"]?.["w:t"] || ""
    return {
      id: elem.$.id || elem.$["w:id"],
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
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("word/comments.xml")
  if (!commentsFile) {
    return "not-found"
  }
  const commentsContent = await commentsFile.async("string")
  const commentsObj = await parseStringPromise(commentsContent, { explicitArray: false })
  const commentsRoot = commentsObj.comments || commentsObj["w:comments"]
  const commentElements = commentsRoot?.comment
    ? Array.isArray(commentsRoot.comment)
      ? commentsRoot.comment
      : [commentsRoot.comment]
    : []
  const target = commentElements.find(
    (c: any) => c.$?.["w:id"] === commentId || c.$?.id === commentId
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
  const targetPara = paragraphs.find((para: any) =>
    (Array.isArray(para["w:r"]) ? para["w:r"] : para["w:r"] ? [para["w:r"]] : []).some(
      (r: any) =>
        r["w:commentRangeStart"] &&
        (r["w:commentRangeStart"].$?.["w:id"] === commentId ||
          r["w:commentRangeStart"].$?.id === commentId)
    )
  )
  if (!targetPara) {
    return "not-found"
  }

  targetPara["w:r"] = { "w:r": { "w:t": suggestion } }
  const newDocXml = new Builder().buildObject(docObj)
  zip.file("word/document.xml", newDocXml)

  commentsRoot.comment = commentElements.filter(
    (c: any) => c !== target
  )
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
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("word/comments.xml")
  if (!commentsFile) {
    return "not-found"
  }
  const commentsObj = await parseStringPromise(await commentsFile.async("string"), { explicitArray: false })
  const commentsRoot = commentsObj.comments || commentsObj["w:comments"]
  const commentElements = commentsRoot?.comment
    ? Array.isArray(commentsRoot.comment)
      ? commentsRoot.comment
      : [commentsRoot.comment]
    : []
  const target = commentElements.find(
    (c: any) => c.$?.["w:id"] === commentId || c.$?.id === commentId
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
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("word/comments.xml")
  if (!commentsFile) {
    return "not-found"
  }
  const commentsObj = await parseStringPromise(await commentsFile.async("string"), { explicitArray: false })
  const commentsRoot = commentsObj.comments || commentsObj["w:comments"]
  const commentElements = commentsRoot?.comment
    ? Array.isArray(commentsRoot.comment)
      ? commentsRoot.comment
      : [commentsRoot.comment]
    : []
  const isTarget = (c: any) => c.$?.["w:id"] === commentId || c.$?.id === commentId
  if (!commentElements.some(isTarget)) {
    return "not-found"
  }
  commentsRoot.comment = commentElements.filter((c: any) => !isTarget(c))
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
      const markerId = (m: any) => m?.$?.["w:id"] === commentId || m?.$?.id === commentId
      for (const key of ["w:commentRangeStart", "w:commentRangeEnd"]) {
        if (para[key] && markerId(para[key])) {
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
        const ref = r["w:r"]?.["w:commentReference"]
        return !(ref && (ref.$?.["w:id"] === commentId || ref.$?.id === commentId))
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
  const zip = await JSZip.loadAsync(data)

  const commentsFile = zip.file("word/comments.xml")
  if (!commentsFile) {
    return "not-found"
  }
  const commentsObj = await parseStringPromise(await commentsFile.async("string"), { explicitArray: false })
  const commentsRoot = commentsObj.comments || commentsObj["w:comments"]
  const commentElements = commentsRoot?.comment
    ? Array.isArray(commentsRoot.comment)
      ? commentsRoot.comment
      : [commentsRoot.comment]
    : []
  const target = commentElements.find(
    (c: any) => c.$?.["w:id"] === commentId || c.$?.id === commentId
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
