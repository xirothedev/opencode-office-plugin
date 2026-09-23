import { createTwoFilesPatch } from "diff";

export const diffTexts = (realContent: string, draftContent: string): string =>
  createTwoFilesPatch(
    "real file",
    "draft",
    realContent,
    draftContent,
    "real file",
    "draft"
  );
