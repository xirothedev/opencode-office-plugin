# Preview renders the draft to HTML via pandoc, not headless-browser screenshots

Issue #5 asked for a preview action with before/after screenshot comparison and markdown-to-image rendering. We implement `officecli(action="preview")` as markdown → standalone HTML via pandoc (already a hard dependency for office/PDF writes), written to a temp file whose path the action returns.

Rejected: a headless browser (puppeteer/playwright) for real PNG screenshots — a heavyweight dependency tree for marginal review value. Screenshot before/after comparison remains the user-facing UI concept (see CONTEXT.md "Preview"), and the agent-facing before/after comparison is already the `diff` action. Markdown → image is a user-facing rendering problem, not a plugin-tool problem.

**Consequences**: preview requires pandoc only (already required by the plugin); the plugin gains no browser dependency. An image renderer can be added later without changing the action contract.
