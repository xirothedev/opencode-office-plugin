import { describe, it, expect } from "vitest"
import { parseRules } from "@/core/format/validate"
import { parseTemplateData, parseGenerateEntries } from "@/core/template/generate"
import { parseAnnotationOps } from "@/core/format/annotate"
import { parseMetadataProperties } from "@/core/format/metadata"

// Agent-visible contract: exact error strings. Happy paths are covered by tool tests.

describe("parseRules errors", () => {
  const cases: Array<[string, string]> = [
    ["{not json", "invalid rules JSON"],
    ['{"type":"regex"}', "rules must be an array"],
    ['[{"type":"glob","pattern":"x"}]', "rule 0 has unknown type glob"],
    ['[{"type":"regex","pattern":5}]', "rule 0 must have a string pattern"],
  ]
  for (const [input, message] of cases) {
    it(`rejects ${input}`, () => expect(() => parseRules(input)).toThrow(message))
  }
})

describe("parseTemplateData + parseGenerateEntries errors", () => {
  it("parseTemplateData rejects malformed input", () => {
    expect(() => parseTemplateData("{oops")).toThrow("invalid data JSON")
    expect(() => parseTemplateData('{"a":[]}')).toThrow("data must be a JSON object with string or number values")
  })

  it("parseGenerateEntries rejects malformed batches", () => {
    expect(() => parseGenerateEntries({ dataArray: "[", filePaths: "[]" })).toThrow("invalid dataArray JSON")
    expect(() => parseGenerateEntries({ dataArray: "[]", filePaths: "{" })).toThrow("invalid filePaths JSON")
    expect(() => parseGenerateEntries({ dataArray: '[{"a":1}]', filePaths: "[]" })).toThrow(
      "dataArray and filePaths must be arrays of equal length",
    )
    expect(() => parseGenerateEntries({ dataArray: '[{"a":[]}]', filePaths: '["x"]' })).toThrow(
      "dataArray entry 0 must be a JSON object with string or number values",
    )
    expect(() => parseGenerateEntries({ dataArray: '[{"a":1}]', filePaths: '[5]' })).toThrow(
      "filePaths entry 0 must be a string",
    )
    expect(() => parseGenerateEntries({})).toThrow("generate requires data + filePath or dataArray + filePaths")
  })
})

describe("parseAnnotationOps errors", () => {
  it("rejects unsupported ext and malformed ops", () => {
    expect(() => parseAnnotationOps(".txt", "[]")).toThrow("annotate only supported for PNG and JPG images")
    expect(() => parseAnnotationOps(".png", "[" )).toThrow("invalid annotations JSON")
    expect(() => parseAnnotationOps(".png", "{}")).toThrow("annotations must be an array")
    expect(() => parseAnnotationOps(".png", '[{"type":"arrow"}]')).toThrow("annotation 0 has unknown type arrow")
    expect(() => parseAnnotationOps(".png", '[{"type":"note","text":"x","position":{"x":2,"y":0}}]')).toThrow(
      "note 0 requires text and position {x, y} between 0 and 1",
    )
    expect(() => parseAnnotationOps(".png", '[{"type":"highlight","rect":{"x":0,"y":0}}]')).toThrow(
      "highlight 0 requires rect {x, y, width, height} between 0 and 1",
    )
    expect(() => parseAnnotationOps(".png", '[{"type":"stamp","text":"MAYBE","position":{"x":0.5,"y":0.5}}]')).toThrow(
      "stamp 0 text must be one of: DRAFT, APPROVED, CONFIDENTIAL",
    )
  })
})

describe("parseMetadataProperties errors", () => {
  it("rejects malformed properties", () => {
    expect(() => parseMetadataProperties("[")).toThrow("invalid properties JSON")
    expect(() => parseMetadataProperties("[]")).toThrow("properties must be a JSON object")
    expect(() => parseMetadataProperties('{"title":5}')).toThrow('property "title" must be a string')
    expect(() => parseMetadataProperties('{"custom":{"a":1}}')).toThrow("custom must be an object with string values")
  })
})
