import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";

import { getRegistryDir, getFilePathHash } from "@/core/storage/paths";
import {
  registerDraft,
  unregisterDraft,
  getRegisteredPath,
} from "@/core/storage/registry";

describe("draft registry", () => {
  beforeEach(async () => {
    await mkdir(getRegistryDir(), { recursive: true });
  });

  afterEach(async () => {
    await rm(getRegistryDir(), { force: true, recursive: true });
  });

  it("maps hash back to the registered absolute path", () => {
    registerDraft("/work/docs/report.docx");
    const hash = getFilePathHash("/work/docs/report.docx");
    expect(getRegisteredPath(hash)).toBe("/work/docs/report.docx");
  });

  it("re-registering the same path overwrites the entry", () => {
    const hash = getFilePathHash("/work/docs/report.docx");
    registerDraft("/work/docs/report.docx");
    registerDraft("/work/docs/report.docx");
    expect(getRegisteredPath(hash)).toBe("/work/docs/report.docx");
  });

  it("returns null for a hash with no entry", () => {
    const hash = getFilePathHash("/work/docs/none.docx");
    expect(getRegisteredPath(hash)).toBeNull();
  });

  it("removes the entry on unregister", () => {
    const hash = getFilePathHash("/work/a.txt");
    registerDraft("/work/a.txt");
    unregisterDraft(hash);
    expect(getRegisteredPath(hash)).toBeNull();
  });
});
