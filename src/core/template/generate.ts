import { existsSync, readFileSync } from "fs"
import { detectFormat } from "@/core/format/detect"

export interface TemplateData {
  [key: string]: string | number
}

export interface GenerateEntry {
  filePath: string
  data: TemplateData
}

function isDataObject(value: unknown): value is TemplateData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every((v) => typeof v === "string" || typeof v === "number")
}

export function parseTemplateData(json: string): TemplateData {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error("invalid data JSON")
  }
  if (!isDataObject(parsed)) {
    throw new Error("data must be a JSON object with string or number values")
  }
  return parsed
}

export function assertTemplate(templatePath: string): void {
  if (!existsSync(templatePath)) {
    throw new Error(`template not found: ${templatePath}`)
  }
  const format = detectFormat(templatePath)
  if (format !== "text" && format !== "docx" && format !== "xlsx" && format !== "pptx") {
    throw new Error("template must be a text, docx, xlsx or pptx file")
  }
}

// Single source of truth for the generate action's data/dataArray + filePath/filePaths
// pairing. Throws the agent-facing message on any shape violation.
export function parseGenerateEntries(input: {
  data?: string
  filePath?: string
  dataArray?: string
  filePaths?: string
}): GenerateEntry[] {
  if (input.data && input.filePath) {
    return [{ data: parseTemplateData(input.data), filePath: input.filePath }]
  }
  if (input.dataArray && input.filePaths) {
    let dataArray: unknown
    let filePaths: unknown
    try {
      dataArray = JSON.parse(input.dataArray)
    } catch {
      throw new Error("invalid dataArray JSON")
    }
    try {
      filePaths = JSON.parse(input.filePaths)
    } catch {
      throw new Error("invalid filePaths JSON")
    }
    if (
      !Array.isArray(dataArray) ||
      !Array.isArray(filePaths) ||
      dataArray.length !== filePaths.length
    ) {
      throw new Error("dataArray and filePaths must be arrays of equal length")
    }
    const entries: GenerateEntry[] = []
    for (let i = 0; i < dataArray.length; i++) {
      if (!isDataObject(dataArray[i])) {
        throw new Error(`dataArray entry ${i} must be a JSON object with string or number values`)
      }
      if (typeof filePaths[i] !== "string") {
        throw new Error(`filePaths entry ${i} must be a string`)
      }
      entries.push({ data: dataArray[i], filePath: filePaths[i] })
    }
    return entries
  }
  throw new Error("generate requires data + filePath or dataArray + filePaths")
}

// ponytail: binary copy preserves 100% Format — validates the Reference ZIP once,
// the clone action and the L3 flow share these checks
export function readCloneSource(sourcePath: string, label: string): Buffer {
  if (!existsSync(sourcePath)) {
    throw new Error(`clone source not found: ${label}`)
  }
  const format = detectFormat(sourcePath)
  if (format !== "docx" && format !== "xlsx" && format !== "pptx") {
    throw new Error("clone only supported for DOCX, XLSX and PPTX files")
  }
  const buf = readFileSync(sourcePath)
  const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b
  if (!isZip) {
    throw new Error(`clone source is not a valid OOXML file: ${label}`)
  }
  return buf
}
