import { describe, it, expect } from "vitest"
import { substituteTemplate } from "@/core/template/substitute"

describe("substituteTemplate", () => {
  it("substitutes a single placeholder", () => {
    expect(substituteTemplate("Hello {{name}}!", { name: "Hạnh" })).toBe("Hello Hạnh!")
  })

  it("substitutes multiple placeholders in one pass", () => {
    expect(substituteTemplate("{{dept}} request #{{number}}", { dept: "Microbiology", number: "3" })).toBe(
      "Microbiology request #3"
    )
  })

  it("tolerates whitespace inside the braces", () => {
    expect(substituteTemplate("Amount: {{ amount }}", { amount: "100" })).toBe("Amount: 100")
  })

  it("leaves text without placeholders unchanged", () => {
    expect(substituteTemplate("No variables here.", {})).toBe("No variables here.")
  })

  it("stringifies non-string values", () => {
    expect(substituteTemplate("Total: {{total}}", { total: 42 })).toBe("Total: 42")
  })

  it("ignores extra keys not used by the template", () => {
    expect(substituteTemplate("{{a}}", { a: "1", b: "2" })).toBe("1")
  })

  it("throws listing every missing key", () => {
    expect(() => substituteTemplate("{{a}} and {{b}}", { a: "1" })).toThrow(
      "missing template keys: b"
    )
  })

  it("throws when the data does not contain the key at all", () => {
    expect(() => substituteTemplate("{{missing}}", {})).toThrow("missing template keys: missing")
  })
})
