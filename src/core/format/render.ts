import { mkdirSync } from "node:fs";
import path from "node:path";

import { runCommand } from "./exec";

export const renderMarkdownFileToHtml = async (
  markdownPath: string,
  outputPath: string
): Promise<void> => {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    await runCommand(`pandoc "${markdownPath}" -o "${outputPath}"`);
  } catch (error) {
    throw new Error(`pandoc preview failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
};
