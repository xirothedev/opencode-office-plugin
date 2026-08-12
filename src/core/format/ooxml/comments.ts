import JSZip from "jszip"
import { readFileSync, writeFileSync } from "fs"
import { parseStringPromise, Builder } from "xml2js"

export interface Comment {
  id: string
  author: string
  text: string
  timestamp: Date
  rangeStart: { paragraph: number; offset: number }
  rangeEnd: { paragraph: number; offset: number }
  parentId: string | null
  resolved: boolean
}

export async function writeComment(docPath: string, comment: Comment): Promise<void> {
  const data = readFileSync(docPath)
  const zip = await JSZip.loadAsync(data)

  // Read or create comments.xml
  let commentsXml = zip.file("word/comments.xml")
  let commentsObj: any

  if (commentsXml) {
    const content = await commentsXml.async("string")
    commentsObj = await parseStringPromise(content, { explicitArray: false })
    // Ensure comments array exists
    if (!commentsObj.comments) {
      commentsObj.comments = { comment: [] }
    }
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
  const commentElement = {
    $: {
      "w:id": comment.id,
      "w:author": comment.author,
      "w:date": comment.timestamp.toISOString(),
      "w:initials": comment.author.charAt(0).toUpperCase(),
    },
    "w:p": {
      "w:r": {
        "w:t": comment.text,
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

    const newDocXml = builder.buildObject(docObj)
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
      resolved: false,
    }
  })
}
