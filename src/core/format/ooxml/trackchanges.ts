import JSZip from "jszip"
import { readFileSync, writeFileSync } from "fs"
import { parseStringPromise, Builder } from "xml2js"

export interface TrackChange {
  id: string
  type: "insertion" | "deletion"
  author: string
  timestamp: Date
  text: string
  paragraph: number
  offset: number
}

export async function writeTrackChange(docPath: string, trackChange: TrackChange): Promise<void> {
  const data = readFileSync(docPath)
  const zip = await JSZip.loadAsync(data)

  // Read document.xml
  const documentXml = zip.file("word/document.xml")
  if (!documentXml) {
    throw new Error("document.xml not found in DOCX")
  }

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

  // Get target paragraph
  const paragraphs = body["w:p"] ? (Array.isArray(body["w:p"]) ? body["w:p"] : [body["w:p"]]) : []
  const targetPara = paragraphs[trackChange.paragraph]

  if (!targetPara) {
    throw new Error(`Paragraph ${trackChange.paragraph} not found`)
  }

  // Ensure runs array exists
  if (!targetPara["w:r"]) {
    targetPara["w:r"] = []
  }
  if (!Array.isArray(targetPara["w:r"])) {
    targetPara["w:r"] = [targetPara["w:r"]]
  }

  // Create track change element - OOXML: <w:ins>/<w:del> is sibling of <w:r> inside <w:p>, not child of <w:r>
  if (trackChange.type === "insertion") {
    const insElement = {
      $: {
        "w:id": trackChange.id,
        "w:author": trackChange.author,
        "w:date": trackChange.timestamp.toISOString(),
      },
      "w:r": {
        "w:t": trackChange.text,
      },
    }
    // Add as sibling of w:r at paragraph level
    targetPara["w:ins"] = insElement
  } else if (trackChange.type === "deletion") {
    const delElement = {
      $: {
        "w:id": trackChange.id,
        "w:author": trackChange.author,
        "w:date": trackChange.timestamp.toISOString(),
      },
      "w:r": {
        "w:delText": trackChange.text,
      },
    }
    targetPara["w:del"] = delElement
  }

  // Write back
  const builder = new Builder()
  const newDocXml = builder.buildObject(docObj)
  zip.file("word/document.xml", newDocXml)

  // Write back to file
  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  writeFileSync(docPath, buffer)
}

export async function readTrackChanges(docPath: string): Promise<TrackChange[]> {
  const data = readFileSync(docPath)
  const zip = await JSZip.loadAsync(data)

  const documentXml = zip.file("word/document.xml")
  if (!documentXml) {
    return []
  }

  const content = await documentXml.async("string")
  const docObj = await parseStringPromise(content, { explicitArray: false })

  const root = docObj.document || docObj["w:document"]
  if (!root) {
    return []
  }
  const body = root.body || root["w:body"]
  if (!body) {
    return []
  }

  const changes: TrackChange[] = []

  // Find all paragraphs
  const paragraphs = body["w:p"] ? (Array.isArray(body["w:p"]) ? body["w:p"] : [body["w:p"]]) : []

  paragraphs.forEach((para: any, paraIndex: number) => {
    // Check for insertion at paragraph level (sibling of w:r)
    if (para["w:ins"]) {
      const ins = para["w:ins"]
      const text = ins["w:r"]?.["w:t"] || ""
      changes.push({
        id: ins.$?.["w:id"] || ins.$?.id || "",
        type: "insertion",
        author: ins.$?.["w:author"] || ins.$?.author || "",
        timestamp: new Date(ins.$?.["w:date"] || ins.$?.date || new Date()),
        text: typeof text === "string" ? text : "",
        paragraph: paraIndex,
        offset: 0, // Simplified - real impl needs to parse position
      })
    }

    // Check for deletion at paragraph level (sibling of w:r)
    if (para["w:del"]) {
      const del = para["w:del"]
      const text = del["w:r"]?.["w:delText"] || ""
      changes.push({
        id: del.$?.["w:id"] || del.$?.id || "",
        type: "deletion",
        author: del.$?.["w:author"] || del.$?.author || "",
        timestamp: new Date(del.$?.["w:date"] || del.$?.date || new Date()),
        text: typeof text === "string" ? text : "",
        paragraph: paraIndex,
        offset: 0,
      })
    }
  })

  return changes
}
