export interface ValidationRule {
  type: "regex" | "required";
  pattern: string;
}

export const parseRules = (json: string): ValidationRule[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("invalid rules JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError("rules must be an array");
  }
  const rules: ValidationRule[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const rule = parsed[i] as { type?: unknown; pattern?: unknown };
    if (rule.type !== "regex" && rule.type !== "required") {
      throw new Error(`rule ${i} has unknown type ${String(rule.type)}`);
    }
    if (typeof rule.pattern !== "string") {
      throw new TypeError(`rule ${i} must have a string pattern`);
    }
    rules.push({ pattern: rule.pattern, type: rule.type });
  }
  return rules;
};

export const renderValidationReport = (
  filePath: string,
  content: string,
  rules: ValidationRule[]
): string => {
  const results: { rule: ValidationRule; pass: boolean }[] = [];
  for (const rule of rules) {
    let pass: boolean;
    if (rule.type === "regex") {
      try {
        pass = new RegExp(rule.pattern, "u").test(content);
      } catch {
        throw new Error(`invalid regex pattern "${rule.pattern}"`);
      }
    } else {
      pass = content.includes(rule.pattern);
    }
    results.push({ pass, rule });
  }
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const lines = results.map(
    (r) => `- ${r.pass ? "pass" : "fail"}: ${r.rule.type} "${r.rule.pattern}"`
  );
  return `Validation of ${filePath}: ${results.length} rules, ${passed} passed, ${failed} failed\n${lines.join("\n")}`;
};
