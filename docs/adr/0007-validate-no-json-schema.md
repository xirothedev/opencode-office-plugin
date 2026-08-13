# Validate checks regex and required markers only; no JSON Schema

Issue #5 listed "schema validation" alongside regex patterns and required fields for the validate action. We implement only the `regex` and `required` rule types, both operating on the draft's markdown text.

Rejected: JSON Schema validation. Drafts are markdown text — binary formats (docx/xlsx/pptx/pdf) are held as markdown until Accept — and no document in the domain is JSON. JSON Schema would validate nothing that exists.

**Consequences**: validate covers content checks (pattern must match, marker must be present). Structured-content rules (e.g. cell-type checks on a future xlsx-aware surface) would need a new rule type, not JSON Schema.
