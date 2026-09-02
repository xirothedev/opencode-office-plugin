export interface ValidationRule {
  type: "regex" | "required"
  pattern: string
}

export function parseRules(json: string): ValidationRule[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error("invalid rules JSON")
  }
  if (!Array.isArray(parsed)) {
    throw new Error("rules must be an array")
  }
  const rules: ValidationRule[] = []
  for (let i = 0; i < parsed.length; i++) {
    const rule = parsed[i] as { type?: unknown; pattern?: unknown }
    if (rule.type !== "regex" && rule.type !== "required") {
      throw new Error(`rule ${i} has unknown type ${String(rule.type)}`)
    }
    if (typeof rule.pattern !== "string") {
      throw new Error(`rule ${i} must have a string pattern`)
    }
    rules.push({ type: rule.type, pattern: rule.pattern })
  }
  return rules
}

export function renderValidationReport(filePath: string, content: string, rules: ValidationRule[]): string {
  const results: Array<{ rule: ValidationRule; pass: boolean }> = []
  for (const rule of rules) {
    let pass: boolean
    if (rule.type === "regex") {
      try {
        pass = new RegExp(rule.pattern).test(content)
      } catch {
        throw new Error(`invalid regex pattern "${rule.pattern}"`)
      }
    } else {
      pass = content.includes(rule.pattern)
    }
    results.push({ rule, pass })
  }
  const passed = results.filter((r) => r.pass).length
  const failed = results.length - passed
  const lines = results.map((r) => `- ${r.pass ? "pass" : "fail"}: ${r.rule.type} "${r.rule.pattern}"`)
  return `Validation of ${filePath}: ${results.length} rules, ${passed} passed, ${failed} failed\n${lines.join("\n")}`
}
