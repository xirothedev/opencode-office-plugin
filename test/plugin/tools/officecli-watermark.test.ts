import { describe, it, expect, beforeEach, mock } from "bun:test";
import { writeFileSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

import { spawnSync } from "bun";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

import { extractTextFromPDF } from "@/core/format/backends/pdf";
import { officecliTool } from "@/plugin/tools/officecli";

import { runTool, setupHermeticDirs, cleanupTestFile } from "./harness";

// ponytail: bun:test has no importOriginal — non-PDF commands fall through to the
// real shell via spawnSync. Mock the owned seam, never node:child_process
// (sharp imports spawnSync from it). Factory stays sync: dynamic imports
// inside the factory can deadlock module evaluation (seen with pdf-lib).
mock.module("@/core/format/exec", () => {
  const decoder = new TextDecoder();
  return {
    runCommand: mock(async (cmd: string) => {
      const outMatch = cmd.match(/-o "(?<out>[^"]+)"/u);
      const out = outMatch?.groups?.out;
      if (out !== undefined && out.toLowerCase().endsWith(".pdf")) {
        const doc = await PDFDocument.create();
        doc.addPage([300, 300]);
        writeFileSync(out, await doc.save());
        return;
      }
      const proc = spawnSync({
        cmd: ["sh", "-c", cmd],
        stderr: "pipe",
        stdout: "pipe",
      });
      if (proc.exitCode !== 0) {
        const stderr = decoder.decode(proc.stderr).trim();
        throw new Error(stderr || `command failed: ${cmd}`);
      }
    }),
  };
});

const withDraft = async (filePath: string, content: string): Promise<void> => {
  await runTool(officecliTool, { action: "create", content, filePath });
};

describe("officecli watermark", () => {
  const docxFile = "/tmp/test-watermark.docx";
  const pdfFile = "/tmp/test-watermark.pdf";
  const docxFixture = path.join(process.cwd(), "test/fixtures/sample.docx");
  const pdfFixture = path.join(process.cwd(), "test/fixtures/sample.pdf");
  setupHermeticDirs();
  cleanupTestFile(docxFile);
  cleanupTestFile(pdfFile);
  cleanupTestFile("/tmp/test-watermark.xlsx");

  beforeEach(async () => {
    await copyFile(docxFixture, docxFile);
    await copyFile(pdfFixture, pdfFile);
  });

  it("watermark text renders into the accepted pdf", async () => {
    await withDraft(pdfFile, "# PDF draft\n\nBody");
    const setResult = await runTool(officecliTool, {
      action: "watermark",
      filePath: pdfFile,
      position: "diagonal-center",
      text: "DRAFT",
    });
    expect(setResult).toContain("Watermark set");
    await runTool(officecliTool, { action: "accept", filePath: pdfFile });
    const pdfText = await extractTextFromPDF(pdfFile);
    expect(pdfText).toContain("DRAFT");
  });

  it("empty text removes the watermark from the accepted pdf", async () => {
    await withDraft(pdfFile, "# PDF draft\n\nBody");
    await runTool(officecliTool, {
      action: "watermark",
      filePath: pdfFile,
      text: "DRAFT",
    });
    const removeResult = await runTool(officecliTool, {
      action: "watermark",
      filePath: pdfFile,
      text: "",
    });
    expect(removeResult).toContain("Watermark removed");
    await runTool(officecliTool, { action: "accept", filePath: pdfFile });
    const pdfText = await extractTextFromPDF(pdfFile);
    expect(pdfText).not.toContain("DRAFT");
  });

  it("watermark injects a header into the accepted docx", async () => {
    await withDraft(docxFile, "# Doc\n\nBody");
    await runTool(officecliTool, {
      action: "watermark",
      filePath: docxFile,
      position: "top-center",
      text: "CONFIDENTIAL",
    });
    await runTool(officecliTool, { action: "accept", filePath: docxFile });
    const zip = await JSZip.loadAsync(await readFile(docxFile));
    const headerXml = await zip.file("word/header1.xml")?.async("string");
    expect(headerXml).toContain("CONFIDENTIAL");
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toContain("headerReference");
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    expect(contentTypes).toContain("wordprocessingml.header+xml");
  });

  it("watermark on docx defaults to top-center without a position", async () => {
    await withDraft(docxFile, "# Doc\n\nBody");
    await runTool(officecliTool, {
      action: "watermark",
      filePath: docxFile,
      text: "CONFIDENTIAL",
    });
    const acceptResult = await runTool(officecliTool, {
      action: "accept",
      filePath: docxFile,
    });
    expect(acceptResult).toContain("Accepted");
    const zip = await JSZip.loadAsync(await readFile(docxFile));
    const headerXml = await zip.file("word/header1.xml")?.async("string");
    expect(headerXml).toContain("CONFIDENTIAL");
  });

  it("errors on diagonal-center for docx", async () => {
    await withDraft(docxFile, "# Doc\n\nBody");
    await expect(
      runTool(officecliTool, {
        action: "watermark",
        filePath: docxFile,
        position: "diagonal-center",
        text: "DRAFT",
      })
    ).rejects.toThrow(/diagonal-center watermark not supported for DOCX/u);
  });

  it("errors on opacity for docx", async () => {
    await withDraft(docxFile, "# Doc\n\nBody");
    await expect(
      runTool(officecliTool, {
        action: "watermark",
        filePath: docxFile,
        opacity: 0.5,
        text: "DRAFT",
      })
    ).rejects.toThrow(/opacity not supported for DOCX watermarks/u);
  });

  it("errors on unsupported formats (xlsx)", async () => {
    await copyFile(docxFixture, "/tmp/test-watermark.xlsx");
    await expect(
      runTool(officecliTool, {
        action: "watermark",
        filePath: "/tmp/test-watermark.xlsx",
        text: "DRAFT",
      })
    ).rejects.toThrow(/watermark only supported for DOCX and PDF/u);
  });

  it("errors when writing a watermark without a draft", async () => {
    await expect(
      runTool(officecliTool, {
        action: "watermark",
        filePath: docxFile,
        text: "DRAFT",
      })
    ).rejects.toThrow(/no active draft/u);
  });

  it("errors on invalid position", async () => {
    await withDraft(pdfFile, "# PDF draft\n\nBody");
    await expect(
      runTool(officecliTool, {
        action: "watermark",
        filePath: pdfFile,
        position: "left-middle",
        text: "DRAFT",
      })
    ).rejects.toThrow(/invalid position/u);
  });
});
