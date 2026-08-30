import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { tmpdir } from "os"
import JSZip from "jszip"
import { substituteOoxml } from "@/core/template/substitute-ooxml"
import { verifyL3 } from "@/core/format/verify-l3"

function tmpPath(name: string): string {
  const dir = join(tmpdir(), "openoffice-l3-test")
  mkdirSync(dir, { recursive: true })
  return join(dir, name)
}

// ponytail: minimal run-preserving L3 test — clone + substitute keeps Format, verifyL3 passes
describe("L3 Fidelity — clone + substitute", () => {
  const sampleDocx = "test/fixtures/sample.docx"
  const sampleXlsx = "test/fixtures/sample.xlsx"
  const samplePptx = "test/fixtures/sample.pptx"

  it("docx: placeholder substitute is run-preserving and L3 PASS vs Reference", async () => {
    const buf = readFileSync(sampleDocx)
    const zip = await JSZip.loadAsync(buf)
    let xml = await zip.file("word/document.xml")!.async("string")
    // Inject placeholder {{greeting}} where "Hello DOCX" sits
    xml = xml.replace("Hello DOCX", "{{greeting}}")
    zip.file("word/document.xml", xml)
    const templateBuf = (await zip.generateAsync({ type: "nodebuffer" })) as Buffer

    const { buffer: substituted } = await substituteOoxml(templateBuf, { greeting: "Hello L3" })

    const tplPath = tmpPath("tpl.docx")
    const outPath = tmpPath("out.docx")
    writeFileSync(tplPath, templateBuf)
    writeFileSync(outPath, substituted)

    const res = await verifyL3(outPath, tplPath)
    expect(res.pass).toBe(true)
    expect(res.textDiffs).toBeGreaterThan(0)
  })

  it("docx: split placeholder across runs is handled", async () => {
    // Simulate Word splitting {{greeting}} across two w:r/w:t runs
    const buf = readFileSync(sampleDocx)
    const zip = await JSZip.loadAsync(buf)
    let xml = await zip.file("word/document.xml")!.async("string")
    // Replace single run with two runs containing split placeholder
    xml = xml.replace(
      '<w:t xml:space="preserve">Hello DOCX</w:t>',
      '<w:t>{{greet</w:t></w:r><w:r><w:t>ing}}</w:t>',
    )
    zip.file("word/document.xml", xml)
    const templateBuf = (await zip.generateAsync({ type: "nodebuffer" })) as Buffer

    const { buffer: out } = await substituteOoxml(templateBuf, { greeting: "Hi Split" })
    const tplPath = tmpPath("tpl-split.docx")
    const outPath = tmpPath("out-split.docx")
    writeFileSync(tplPath, templateBuf)
    writeFileSync(outPath, out)

    const res = await verifyL3(outPath, tplPath)
    expect(res.pass).toBe(true)
  })

  it("xlsx: sharedStrings placeholder substitute L3 PASS", async () => {
    const buf = readFileSync(sampleXlsx)
    const zip = await JSZip.loadAsync(buf)
    let xml = await zip.file("xl/sharedStrings.xml")!.async("string")
    xml = xml.replace("Widgets", "{{item}}")
    zip.file("xl/sharedStrings.xml", xml)
    const templateBuf = (await zip.generateAsync({ type: "nodebuffer" })) as Buffer

    const { buffer: out } = await substituteOoxml(templateBuf, { item: "Gadgets-2" })
    const tplPath = tmpPath("tpl.xlsx")
    const outPath = tmpPath("out.xlsx")
    writeFileSync(tplPath, templateBuf)
    writeFileSync(outPath, out)

    const res = await verifyL3(outPath, tplPath)
    expect(res.pass).toBe(true)
  })

  it("pptx: slide placeholder substitute L3 PASS", async () => {
    const buf = readFileSync(samplePptx)
    const zip = await JSZip.loadAsync(buf)
    let xml = await zip.file("ppt/slides/slide1.xml")!.async("string")
    xml = xml.replace("Hello from slide 1", "{{title}}")
    zip.file("ppt/slides/slide1.xml", xml)
    const templateBuf = (await zip.generateAsync({ type: "nodebuffer" })) as Buffer

    const { buffer: out } = await substituteOoxml(templateBuf, { title: "New Slide Title" })
    const tplPath = tmpPath("tpl.pptx")
    const outPath = tmpPath("out.pptx")
    writeFileSync(tplPath, templateBuf)
    writeFileSync(outPath, out)

    const res = await verifyL3(outPath, tplPath)
    expect(res.pass).toBe(true)
  })

  it("verifyL3 fails when Format differs (styles.xml changed)", async () => {
    const buf = readFileSync(sampleDocx)
    const zip = await JSZip.loadAsync(buf)
    let styles = await zip.file("word/styles.xml")!.async("string")
    styles = styles.replace("Heading1", "Heading9")
    zip.file("word/styles.xml", styles)
    const alteredBuf = (await zip.generateAsync({ type: "nodebuffer" })) as Buffer

    const aPath = tmpPath("a.docx")
    const bPath = tmpPath("b.docx")
    writeFileSync(aPath, buf)
    writeFileSync(bPath, alteredBuf)

    const res = await verifyL3(aPath, bPath)
    expect(res.pass).toBe(false)
    expect(res.details).toContain("styles.xml")
  })

  it("anchor mode: replaces old text when no placeholder present", async () => {
    const buf = readFileSync(sampleDocx)
    const zip = await JSZip.loadAsync(buf)
    // No placeholder, just old text "Hello DOCX"
    const templateBuf = buf
    const { buffer: out } = await substituteOoxml(templateBuf, { "Hello DOCX": "Hello Anchor" })
    const tplPath = tmpPath("tpl-anchor.docx")
    const outPath = tmpPath("out-anchor.docx")
    writeFileSync(tplPath, templateBuf)
    writeFileSync(outPath, out)
    const res = await verifyL3(outPath, tplPath)
    expect(res.pass).toBe(true)
  })

  it("docx: newline in replacement becomes w:br (Verify Loop fix)", async () => {
    const buf = readFileSync(sampleDocx)
    const zip = await JSZip.loadAsync(buf)
    let xml = await zip.file("word/document.xml")!.async("string")
    xml = xml.replace("Hello DOCX", "{{content}}")
    zip.file("word/document.xml", xml)
    const templateBuf = (await zip.generateAsync({ type: "nodebuffer" })) as Buffer
    const { buffer: out } = await substituteOoxml(templateBuf, { content: "line1\nline2\nline3" })
    const outZip = await JSZip.loadAsync(out)
    const outXml = await outZip.file("word/document.xml")!.async("string")
    expect(outXml).not.toContain("line1\nline2")
    expect(outXml).toContain("<w:br/>")
    expect(outXml).toContain("line1")
    expect(outXml).toContain("line3")
    // ponytail: w:br ceiling — for bullet/numbered lists, split w:p with same pPr/numPr if throughput matters
  })

  it("docx: CRLF normalized to LF before w:br", async () => {
    const buf = readFileSync(sampleDocx)
    const zip = await JSZip.loadAsync(buf)
    let xml = await zip.file("word/document.xml")!.async("string")
    xml = xml.replace("Hello DOCX", "{{content}}")
    zip.file("word/document.xml", xml)
    const templateBuf = (await zip.generateAsync({ type: "nodebuffer" })) as Buffer
    const { buffer: out } = await substituteOoxml(templateBuf, { content: "a\r\nb" })
    const outZip = await JSZip.loadAsync(out)
    const outXml = await outZip.file("word/document.xml")!.async("string")
    expect(outXml).toContain("<w:br/>")
    expect(outXml).not.toContain("\r")
  })
})
