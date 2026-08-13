import { createTwoFilesPatch } from "diff"

export function diffTexts(realContent: string, draftContent: string): string {
  return createTwoFilesPatch("real file", "draft", realContent, draftContent, "real file", "draft")
}
