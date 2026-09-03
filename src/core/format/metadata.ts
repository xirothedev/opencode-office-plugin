import JSZip from "jszip"
import { parseStringPromise } from "xml2js"
import { PDFDocument } from "pdf-lib"
import { readFileSync, writeFileSync } from "fs"
import { detectFormat } from "@/core/format/detect"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { ensureContentType, escapeXml } from "@/core/format/ooxml/parts"

export interface FileMetadata {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  description?: string
  created?: string
  modified?: string
  lastModifiedBy?: string
  creator?: string
  producer?: string
  custom?: Record<string, string>
}

const CORE_TAG_TO_FIELD: Record<string, keyof FileMetadata> = {
  "dc:title": "title",
  "dc:creator": "author",
  "cp:lastModifiedBy": "lastModifiedBy",
  "dc:subject": "subject",
  "dc:description": "description",
  "cp:keywords": "keywords",
  "dcterms:created": "created",
  "dcterms:modified": "modified",
}

const FIELD_TO_CORE_TAG: Record<string, string> = Object.fromEntries(
  Object.entries(CORE_TAG_TO_FIELD).map(([tag, field]) => [field, tag])
)

const CORE_XML_DEFAULT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title/>
  <dc:creator/>
  <cp:lastModifiedBy/>
  <dcterms:created xsi:type="dcterms:W3CDTF"/>
  <dcterms:modified xsi:type="dcterms:W3CDTF"/>
  <dc:subject/>
  <dc:description/>
  <cp:keywords/>
</cp:coreProperties>
`

const CUSTOM_PROPERTIES_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.custom-properties+xml"
const CORE_PROPERTIES_CONTENT_TYPE = "application/vnd.openxmlformats-package.core-properties+xml"

export const METADATA_EXTENSIONS = [".docx", ".xlsx", ".pptx", ".pdf"]

function elementText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as { _?: unknown }
    if (typeof obj._ === "string") {
      return obj._
    }
  }
  return undefined
}

async function readOfficeMetadata(zip: JSZip): Promise<FileMetadata> {
  const result: FileMetadata = {}
  const coreFile = zip.file("docProps/core.xml")
  if (coreFile) {
    const coreXml = await coreFile.async("string")
    const obj = await parseStringPromise(coreXml, { explicitArray: false })
    const root =
      obj["cp:coreProperties"] ?? obj["coreProperties"] ?? Object.values(obj).find((v) => v && typeof v === "object")
    if (root && typeof root === "object") {
      for (const [tag, field] of Object.entries(CORE_TAG_TO_FIELD)) {
        const value = elementText((root as Record<string, unknown>)[tag])
        if (value !== undefined && value !== "") {
          ;(result as Record<string, unknown>)[field] = value
        }
      }
    }
  }
  const customFile = zip.file("docProps/custom.xml")
  if (customFile) {
    const custom = await readCustomProps(zip)
    if (Object.keys(custom).length > 0) {
      result.custom = custom
    }
  }
  return result
}

async function readPdfMetadata(absolutePath: string): Promise<FileMetadata> {
  const buffer = readFileSync(absolutePath)
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
  const meta = await pdf.getMetadata()
  const info = (meta.info ?? {}) as Record<string, unknown>
  const result: FileMetadata = {}
  const map: Record<string, keyof FileMetadata> = {
    Title: "title",
    Author: "author",
    Subject: "subject",
    Keywords: "keywords",
    Creator: "creator",
    Producer: "producer",
    CreationDate: "created",
    ModDate: "modified",
  }
  for (const [infoKey, field] of Object.entries(map)) {
    const value = info[infoKey]
    if (typeof value === "string" && value !== "") {
      ;(result as Record<string, unknown>)[field] = value
    }
  }
  return result
}

export function parseMetadataProperties(propertiesJson: string): FileMetadata {
  let parsed: unknown
  try {
    parsed = JSON.parse(propertiesJson)
  } catch {
    throw new Error("invalid properties JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("properties must be a JSON object")
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key === "custom") {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        !Object.values(value as Record<string, unknown>).every((v) => typeof v === "string")
      ) {
        throw new Error("custom must be an object with string values")
      }
    } else if (typeof value !== "string") {
      throw new Error(`property "${key}" must be a string`)
    }
  }
  return parsed as FileMetadata
}

export async function readMetadata(absolutePath: string): Promise<FileMetadata> {
  const format = detectFormat(absolutePath)
  if (format === "pdf") {
    return await readPdfMetadata(absolutePath)
  }
  if (format === "docx" || format === "xlsx" || format === "pptx") {
    const zip = await JSZip.loadAsync(readFileSync(absolutePath))
    return await readOfficeMetadata(zip)
  }
  throw new Error(`metadata only supported for DOCX, XLSX, PPTX and PDF files`)
}

function setCoreElement(coreXml: string, tag: string, value: string): string {
  const escaped = escapeXml(value)
  const selfClose = new RegExp(`<${tag}[^>]*/>`)
  if (selfClose.test(coreXml)) {
    return coreXml.replace(selfClose, `<${tag}>${escaped}</${tag}>`)
  }
  const pair = new RegExp(`(<${tag}[^>]*>)[\\s\\S]*?(</${tag}>)`)
  if (pair.test(coreXml)) {
    return coreXml.replace(pair, `$1${escaped}$2`)
  }
  const insertPoint = coreXml.lastIndexOf("</")
  return coreXml.slice(0, insertPoint) + `<${tag}>${escaped}</${tag}>` + coreXml.slice(insertPoint)
}

function buildCustomXml(custom: Record<string, string>): string {
  const props = Object.entries(custom)
    .map(([name, value], i) => {
      return `  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${escapeXml(name)}"><vt:lpwstr>${escapeXml(value)}</vt:lpwstr></property>`
    })
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
${props}
</Properties>
`
}

async function readCustomProps(zip: JSZip): Promise<Record<string, string>> {
  const customFile = zip.file("docProps/custom.xml")
  if (!customFile) {
    return {}
  }
  const customXml = await customFile.async("string")
  const obj = await parseStringPromise(customXml, { explicitArray: false })
  const root = obj.Properties ?? obj["Properties"] ?? obj["x:Properties"]
  if (!root || typeof root !== "object") {
    return {}
  }
  let props = (root as { property?: unknown }).property
  if (!Array.isArray(props)) {
    props = props === undefined ? [] : [props]
  }
  const custom: Record<string, string> = {}
  for (const prop of props as Array<{ $?: { name?: string }; "vt:lpwstr"?: unknown }>) {
    const name = prop.$?.name
    const value = elementText(prop["vt:lpwstr"])
    if (name && value !== undefined) {
      custom[name] = value
    }
  }
  return custom
}

async function applyOfficeMetadata(absolutePath: string, props: FileMetadata): Promise<void> {
  const zip = await JSZip.loadAsync(readFileSync(absolutePath))
  const corePath = "docProps/core.xml"
  let coreXml = CORE_XML_DEFAULT
  const existingCore = zip.file(corePath)
  if (existingCore) {
    coreXml = await existingCore.async("string")
  }
  for (const [field, tag] of Object.entries(FIELD_TO_CORE_TAG)) {
    const value = props[field as keyof FileMetadata]
    if (typeof value === "string" && value !== "") {
      coreXml = setCoreElement(coreXml, tag, value)
    }
  }
  zip.file(corePath, coreXml)
  if (props.custom && Object.keys(props.custom).length > 0) {
    const mergedCustom = { ...(await readCustomProps(zip)), ...props.custom }
    zip.file("docProps/custom.xml", buildCustomXml(mergedCustom))
  }
  await ensureContentType(zip, "/docProps/core.xml", CORE_PROPERTIES_CONTENT_TYPE)
  if (props.custom && Object.keys(props.custom).length > 0) {
    await ensureContentType(zip, "/docProps/custom.xml", CUSTOM_PROPERTIES_CONTENT_TYPE)
  }
  writeFileSync(absolutePath, await zip.generateAsync({ type: "nodebuffer" }))
}

function parsePdfDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

async function applyPdfMetadata(absolutePath: string, props: FileMetadata): Promise<void> {
  const doc = await PDFDocument.load(readFileSync(absolutePath))
  if (props.title !== undefined) doc.setTitle(props.title)
  if (props.author !== undefined) doc.setAuthor(props.author)
  if (props.subject !== undefined) doc.setSubject(props.subject)
  if (props.keywords !== undefined) doc.setKeywords(props.keywords.split(/[;,]/).map((k) => k.trim()).filter(Boolean))
  if (props.creator !== undefined) doc.setCreator(props.creator)
  const created = parsePdfDate(props.created)
  if (created) doc.setCreationDate(created)
  const modified = parsePdfDate(props.modified)
  if (modified) doc.setModificationDate(modified)
  writeFileSync(absolutePath, await doc.save())
}

export async function applyMetadataToFile(absolutePath: string, props: FileMetadata): Promise<void> {
  const format = detectFormat(absolutePath)
  if (format === "pdf") {
    await applyPdfMetadata(absolutePath, props)
    return
  }
  if (format === "docx" || format === "xlsx" || format === "pptx") {
    await applyOfficeMetadata(absolutePath, props)
    return
  }
  throw new Error(`metadata only supported for DOCX, XLSX, PPTX and PDF files`)
}
