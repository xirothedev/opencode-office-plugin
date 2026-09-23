import { describe, it, expect } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import JSZip from "jszip";

import { verifyL3 } from "@/core/format/verify-l3";
import { substituteOoxml } from "@/core/template/substitute-ooxml";

const tmpPath = (name: string): string => {
  const dir = path.join(tmpdir(), "openoffice-l3-test");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
};

// ponytail: minimal run-preserving L3 test — clone + substitute keeps Format, verifyL3 passes
describe("L3 Fidelity — clone + substitute", () => {
  const sampleDocx = "test/fixtures/sample.docx";
  const sampleXlsx = "test/fixtures/sample.xlsx";
  const samplePptx = "test/fixtures/sample.pptx";

  it("docx: placeholder substitute is run-preserving and L3 PASS vs Reference", async () => {
    const buf = readFileSync(sampleDocx);
    const zip = await JSZip.loadAsync(buf);
    const documentXmlFile = zip.file("word/document.xml");
    if (!documentXmlFile) {
      throw new Error("missing word/document.xml in fixture");
    }
    let xml = await documentXmlFile.async("string");
    // Inject placeholder {{greeting}} where "Hello DOCX" sits
    xml = xml.replace("Hello DOCX", "{{greeting}}");
    zip.file("word/document.xml", xml);
    const templateBuf = (await zip.generateAsync({
      type: "uint8array",
    })) as Uint8Array;

    const { buffer: substituted } = await substituteOoxml(templateBuf, {
      greeting: "Hello L3",
    });

    const tplPath = tmpPath("tpl.docx");
    const outPath = tmpPath("out.docx");
    writeFileSync(tplPath, templateBuf);
    writeFileSync(outPath, substituted);

    const res = await verifyL3(outPath, tplPath);
    expect(res.pass).toBe(true);
    expect(res.textDiffs).toBeGreaterThan(0);
  });

  it("docx: split placeholder across runs is handled", async () => {
    // Simulate Word splitting {{greeting}} across two w:r/w:t runs
    const buf = readFileSync(sampleDocx);
    const zip = await JSZip.loadAsync(buf);
    const documentXmlFile = zip.file("word/document.xml");
    if (!documentXmlFile) {
      throw new Error("missing word/document.xml in fixture");
    }
    let xml = await documentXmlFile.async("string");
    // Replace single run with two runs containing split placeholder
    xml = xml.replace(
      '<w:t xml:space="preserve">Hello DOCX</w:t>',
      "<w:t>{{greet</w:t></w:r><w:r><w:t>ing}}</w:t>"
    );
    zip.file("word/document.xml", xml);
    const templateBuf = (await zip.generateAsync({
      type: "uint8array",
    })) as Uint8Array;

    const { buffer: out } = await substituteOoxml(templateBuf, {
      greeting: "Hi Split",
    });
    const tplPath = tmpPath("tpl-split.docx");
    const outPath = tmpPath("out-split.docx");
    writeFileSync(tplPath, templateBuf);
    writeFileSync(outPath, out);

    const res = await verifyL3(outPath, tplPath);
    expect(res.pass).toBe(true);
  });

  it("xlsx: sharedStrings placeholder substitute L3 PASS", async () => {
    const buf = readFileSync(sampleXlsx);
    const zip = await JSZip.loadAsync(buf);
    const sharedStringsFile = zip.file("xl/sharedStrings.xml");
    if (!sharedStringsFile) {
      throw new Error("missing xl/sharedStrings.xml in fixture");
    }
    let xml = await sharedStringsFile.async("string");
    xml = xml.replace("Widgets", "{{item}}");
    zip.file("xl/sharedStrings.xml", xml);
    const templateBuf = (await zip.generateAsync({
      type: "uint8array",
    })) as Uint8Array;

    const { buffer: out } = await substituteOoxml(templateBuf, {
      item: "Gadgets-2",
    });
    const tplPath = tmpPath("tpl.xlsx");
    const outPath = tmpPath("out.xlsx");
    writeFileSync(tplPath, templateBuf);
    writeFileSync(outPath, out);

    const res = await verifyL3(outPath, tplPath);
    expect(res.pass).toBe(true);
  });

  it("pptx: slide placeholder substitute L3 PASS", async () => {
    const buf = readFileSync(samplePptx);
    const zip = await JSZip.loadAsync(buf);
    const slideXmlFile = zip.file("ppt/slides/slide1.xml");
    if (!slideXmlFile) {
      throw new Error("missing ppt/slides/slide1.xml in fixture");
    }
    let xml = await slideXmlFile.async("string");
    xml = xml.replace("Hello from slide 1", "{{title}}");
    zip.file("ppt/slides/slide1.xml", xml);
    const templateBuf = (await zip.generateAsync({
      type: "uint8array",
    })) as Uint8Array;

    const { buffer: out } = await substituteOoxml(templateBuf, {
      title: "New Slide Title",
    });
    const tplPath = tmpPath("tpl.pptx");
    const outPath = tmpPath("out.pptx");
    writeFileSync(tplPath, templateBuf);
    writeFileSync(outPath, out);

    const res = await verifyL3(outPath, tplPath);
    expect(res.pass).toBe(true);
  });

  it("verifyL3 fails when Format differs (styles.xml changed)", async () => {
    const buf = readFileSync(sampleDocx);
    const zip = await JSZip.loadAsync(buf);
    const stylesFile = zip.file("word/styles.xml");
    if (!stylesFile) {
      throw new Error("missing word/styles.xml in fixture");
    }
    let styles = await stylesFile.async("string");
    styles = styles.replace("Heading1", "Heading9");
    zip.file("word/styles.xml", styles);
    const alteredBuf = (await zip.generateAsync({
      type: "uint8array",
    })) as Uint8Array;

    const aPath = tmpPath("a.docx");
    const bPath = tmpPath("b.docx");
    writeFileSync(aPath, buf);
    writeFileSync(bPath, alteredBuf);

    const res = await verifyL3(aPath, bPath);
    expect(res.pass).toBe(false);
    expect(res.details).toContain("styles.xml");
  });

  it("anchor mode: replaces old text when no placeholder present", async () => {
    const buf = readFileSync(sampleDocx);
    // No placeholder, just old text "Hello DOCX"
    const templateBuf = buf;
    const { buffer: out } = await substituteOoxml(templateBuf, {
      "Hello DOCX": "Hello Anchor",
    });
    const tplPath = tmpPath("tpl-anchor.docx");
    const outPath = tmpPath("out-anchor.docx");
    writeFileSync(tplPath, templateBuf);
    writeFileSync(outPath, out);
    const res = await verifyL3(outPath, tplPath);
    expect(res.pass).toBe(true);
  });

  it("docx: newline in replacement becomes w:br (Verify Loop fix)", async () => {
    const buf = readFileSync(sampleDocx);
    const zip = await JSZip.loadAsync(buf);
    const documentXmlFile = zip.file("word/document.xml");
    if (!documentXmlFile) {
      throw new Error("missing word/document.xml in fixture");
    }
    let xml = await documentXmlFile.async("string");
    xml = xml.replace("Hello DOCX", "{{content}}");
    zip.file("word/document.xml", xml);
    const templateBuf = (await zip.generateAsync({
      type: "uint8array",
    })) as Uint8Array;
    const { buffer: out } = await substituteOoxml(templateBuf, {
      content: "line1\nline2\nline3",
    });
    const outZip = await JSZip.loadAsync(out);
    const outXmlFile = outZip.file("word/document.xml");
    if (!outXmlFile) {
      throw new Error("missing word/document.xml in output");
    }
    const outXml = await outXmlFile.async("string");
    expect(outXml).not.toContain("line1\nline2");
    expect(outXml).toContain("<w:br/>");
    expect(outXml).toContain("line1");
    expect(outXml).toContain("line3");
    // ponytail: w:br ceiling — for bullet/numbered lists, split w:p with same pPr/numPr if throughput matters
  });

  it("docx: CRLF normalized to LF before w:br", async () => {
    const buf = readFileSync(sampleDocx);
    const zip = await JSZip.loadAsync(buf);
    const documentXmlFile = zip.file("word/document.xml");
    if (!documentXmlFile) {
      throw new Error("missing word/document.xml in fixture");
    }
    let xml = await documentXmlFile.async("string");
    xml = xml.replace("Hello DOCX", "{{content}}");
    zip.file("word/document.xml", xml);
    const templateBuf = (await zip.generateAsync({
      type: "uint8array",
    })) as Uint8Array;
    const { buffer: out } = await substituteOoxml(templateBuf, {
      content: "a\r\nb",
    });
    const outZip = await JSZip.loadAsync(out);
    const outXmlFile = outZip.file("word/document.xml");
    if (!outXmlFile) {
      throw new Error("missing word/document.xml in output");
    }
    const outXml = await outXmlFile.async("string");
    expect(outXml).toContain("<w:br/>");
    expect(outXml).not.toContain("\r");
  });
});
