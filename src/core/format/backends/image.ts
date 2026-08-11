import { createWorker } from "tesseract.js"

export async function extractTextFromImage(absolutePath: string): Promise<string> {
  const worker = await createWorker("eng")
  const { data: { text } } = await worker.recognize(absolutePath)
  await worker.terminate()
  return text.trim()
}
