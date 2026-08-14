# Non-content mutations live in a draft Sidecar, applied at Accept

Issue #6 (nice-to-have features) adds three mutations that cannot live in the markdown draft: Metadata values, Watermark configuration, and Image annotation overlays. The draft stores the agent's markdown content; a DOCX's core properties, a PDF's watermark, and a PNG's pixel overlays have no markdown representation.

We store each of these as a JSON Sidecar beside the draft, and apply it to the binary at Accept — metadata merged into the format's property store, watermark rendered into the output, annotations composited onto the image.

Rejected: writing directly to the real file after acquiring the lock — it breaks the "real file written only by Accept" rule, bypasses Undo, and desyncs from the draft. Also rejected: flattening annotations into a new image draft — overlays would be uneditable and diff/revert would operate on opaque binaries.

**Consequences**: one mechanism serves all three features, so Undo, stale-lock override, and orphaned-draft recovery behave identically for them. Content, metadata, watermark, and overlays all flush atomically at Accept. The Sidecar is JSON and format-agnostic; per-format rendering happens in the existing format backends.
