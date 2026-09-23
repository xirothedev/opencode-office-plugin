import { writeFileSync, unlinkSync } from "node:fs";

import { toMarkdown } from "@firecrawl/anydoc";
import type { ConvertOptions } from "@firecrawl/anydoc";

import { sanitizeXmlText } from "@/core/format/sanitize";
import { getFirecrawlApiKey, getFirecrawlApiUrl } from "@/core/options";

import { runCommand } from "../exec";

export const extractTextFromOffice = async (
  absolutePath: string,
  opts?: ConvertOptions
): Promise<string> => {
  const apiKey = opts?.apiKey ?? getFirecrawlApiKey();
  const apiUrl = opts?.apiUrl ?? getFirecrawlApiUrl();
  const anydocOpts: ConvertOptions | undefined =
    opts || apiKey || apiUrl
      ? {
          ...opts,
          ...(apiKey ? { apiKey } : {}),
          ...(apiUrl ? { apiUrl } : {}),
        }
      : undefined;
  return await toMarkdown(absolutePath, anydocOpts as ConvertOptions);
};

export const writeOfficeFromMarkdown = async (
  markdownInput: string,
  outputPath: string
): Promise<void> => {
  const markdown = sanitizeXmlText(markdownInput);
  const tempPath = `${outputPath}.tmp.md`;
  writeFileSync(tempPath, markdown);
  try {
    await runCommand(`pandoc "${tempPath}" -o "${outputPath}"`);
  } finally {
    unlinkSync(tempPath);
  }
};
