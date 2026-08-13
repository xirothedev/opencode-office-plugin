# Batch operations are array arguments on create/accept, not a dedicated batch action

Issue #5 asked for a "batch action" to create/accept multiple files in one call. We extend `create` and `accept` with a `filePaths` JSON-array argument instead of adding a nested-dispatch `batch` action.

Rejected: a generic `batch` action dispatching nested action + entries — it would duplicate `generate`'s batching machinery, force every batched action to reimplement validation, and complicate error reporting. Extending the two mutating actions keeps per-action semantics local and matches the precedent set by `generate` (`dataArray` + `filePaths`, validate-all-then-act-all).

**Consequences**: batching stays limited to create/accept; read-only actions keep single-file form. Semantics are all-or-nothing — one failed entry aborts the whole call with no partial creates or accepts.
