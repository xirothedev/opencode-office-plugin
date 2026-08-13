const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g

export function substituteTemplate(template: string, data: Record<string, string | number>): string {
  const missing: string[] = []
  const substituted = template.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      missing.push(key)
      return match
    }
    return String(data[key])
  })
  if (missing.length > 0) {
    throw new Error(`missing template keys: ${missing.join(", ")}`)
  }
  return substituted
}
