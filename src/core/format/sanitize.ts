// ponytail: Office XML (ECMA-376) forbids C0 controls except \t \n \r — any \x03 etc. stored in <w:t> breaks XSD and Word refuses to open.
// Strip them at every write boundary so a stray PK\x03\x04 from a legacy .doc read never corrupts the output.
// keep \t (0x09), \n (0x0A), \r (0x0D); drop \x00-\x08, \x0B, \x0C, \x0E-\x1F
export const sanitizeXmlText = (text: string): string =>
  // oxlint-disable-next-line no-control-regex -- C0-strip pattern is this function's entire purpose (ECMA-376 forbids these in <w:t>)
  text.replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, "");

export const sanitizeMarkdown = (markdown: string): string =>
  sanitizeXmlText(markdown);
