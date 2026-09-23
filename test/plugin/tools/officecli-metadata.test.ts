import { describe, it, expect, beforeEach, mock } from "bun:test";
import { writeFileSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

import { spawnSync } from "bun";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

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
        doc.addPage([200, 200]);
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

const setMetadata = async (
  filePath: string,
  properties: string
): Promise<string> =>
  await runTool(officecliTool, { action: "metadata", filePath, properties });

describe("officecli metadata", () => {
  const docxFile = "/tmp/test-metadata.docx";
  const pdfFile = "/tmp/test-metadata.pdf";
  const docxFixture = path.join(process.cwd(), "test/fixtures/sample.docx");
  const pdfFixture = path.join(process.cwd(), "test/fixtures/sample.pdf");
  setupHermeticDirs();
  cleanupTestFile(docxFile);
  cleanupTestFile(pdfFile);

  beforeEach(async () => {
    await copyFile(docxFixture, docxFile);
    await copyFile(pdfFixture, pdfFile);
  });

  it("metadata read returns JSON for a real docx", async () => {
    const result = await runTool(officecliTool, {
      action: "metadata",
      filePath: docxFile,
    });
    const parsed = JSON.parse(result);
    expect(typeof parsed).toBe("object");
  });

  it("metadata set writes pending values visible to read before accept", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Doc\n\nBody",
      filePath: docxFile,
    });
    const result = await setMetadata(
      docxFile,
      JSON.stringify({ author: "Ada Lovelace", title: "Quarterly Report" })
    );
    expect(result).toContain("Metadata set");
    const read = await runTool(officecliTool, {
      action: "metadata",
      filePath: docxFile,
    });
    const parsed = JSON.parse(read);
    expect(parsed.title).toBe("Quarterly Report");
    expect(parsed.author).toBe("Ada Lovelace");
  });

  it("metadata persists into the accepted docx core properties", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Doc\n\nBody",
      filePath: docxFile,
    });
    await setMetadata(
      docxFile,
      JSON.stringify({ author: "Ada Lovelace", title: "Quarterly Report" })
    );
    const acceptResult = await runTool(officecliTool, {
      action: "accept",
      filePath: docxFile,
    });
    expect(acceptResult).toContain("Accepted");
    const zip = await JSZip.loadAsync(await readFile(docxFile));
    const coreXml = await zip.file("docProps/core.xml")?.async("string");
    expect(coreXml).toContain("<dc:title>Quarterly Report</dc:title>");
    expect(coreXml).toContain("<dc:creator>Ada Lovelace</dc:creator>");
  });

  it("custom fields are stored in the accepted docx custom.xml", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Doc\n\nBody",
      filePath: docxFile,
    });
    await setMetadata(
      docxFile,
      JSON.stringify({ custom: { Budget: "12000", Project: "Alpha" } })
    );
    await runTool(officecliTool, { action: "accept", filePath: docxFile });
    const zip = await JSZip.loadAsync(await readFile(docxFile));
    const customXml = await zip.file("docProps/custom.xml")?.async("string");
    expect(customXml).toContain('name="Project"');
    expect(customXml).toContain("<vt:lpwstr>Alpha</vt:lpwstr>");
    expect(customXml).toContain('name="Budget"');
  });

  it("metadata read returns the PDF info dict", async () => {
    const result = await runTool(officecliTool, {
      action: "metadata",
      filePath: pdfFile,
    });
    const parsed = JSON.parse(result);
    expect(typeof parsed).toBe("object");
  });

  it("metadata write applies to the accepted pdf", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# PDF draft\n\nBody",
      filePath: pdfFile,
    });
    await setMetadata(
      pdfFile,
      JSON.stringify({ author: "Grace Hopper", title: "PDF Title" })
    );
    const acceptResult = await runTool(officecliTool, {
      action: "accept",
      filePath: pdfFile,
    });
    expect(acceptResult).toContain("Accepted");
    const read = await runTool(officecliTool, {
      action: "metadata",
      filePath: pdfFile,
    });
    const parsed = JSON.parse(read);
    expect(parsed.title).toBe("PDF Title");
    expect(parsed.author).toBe("Grace Hopper");
  });

  it("revert restores the pending metadata of the accepted state", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Doc\n\nBody",
      filePath: docxFile,
    });
    await setMetadata(docxFile, JSON.stringify({ title: "Quarterly Report" }));
    await runTool(officecliTool, { action: "accept", filePath: docxFile });
    const history = await runTool(officecliTool, {
      action: "history",
      filePath: docxFile,
    });
    const timestamps = JSON.parse(history.slice(history.indexOf("[")));
    const [{ timestamp }] = timestamps;

    await runTool(officecliTool, {
      action: "revert",
      filePath: docxFile,
      timestamp,
    });
    const read = await runTool(officecliTool, {
      action: "metadata",
      filePath: docxFile,
    });
    expect(JSON.parse(read).title).toBe("Quarterly Report");
  });

  it("errors on non-string property values", async () => {
    await runTool(officecliTool, {
      action: "create",
      content: "# Doc\n\nBody",
      filePath: docxFile,
    });
    await expect(
      setMetadata(docxFile, JSON.stringify({ title: 42 }))
    ).rejects.toThrow(/property "title" must be a string/u);
  });

  it("errors on text files", async () => {
    await expect(
      runTool(officecliTool, {
        action: "metadata",
        filePath: "/tmp/test-metadata.txt",
      })
    ).rejects.toThrow(
      /metadata only supported for DOCX, XLSX, PPTX and PDF files/u
    );
  });

  it("errors when writing metadata without a draft", async () => {
    await expect(
      setMetadata(docxFile, JSON.stringify({ title: "X" }))
    ).rejects.toThrow(/no active draft/u);
  });
});
