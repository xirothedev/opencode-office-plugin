// ponytail: Office XML (ECMA-376) forbids C0 controls except \t \n \r — any \x03 etc. stored in <w:t> breaks XSD and Word refuses to open.
// Strip them at every write boundary so a stray PK\x03\x04 from a legacy .doc read never corrupts the output.
export function sanitizeXmlText(text: string): string {
  // keep \t (0x09), \n (0x0A), \r (0x0D); drop \x00-\x08, \x0B, \x0C, \x0E-\x1F
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
}

export function sanitizeMarkdown(markdown: string): string {
  return sanitizeXmlText(markdown)
}
