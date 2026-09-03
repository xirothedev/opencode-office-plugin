# Runtime Captures are local JSON files, no telemetry endpoint

Every `officecli` invoke (agent tool and host invoke) writes one Capture file to the plugin captures dir (`<dataDir>/.capture/`, same shape as test Captures: `label`, `args`, `output`, `error`, `ms`, `ts`, plus `source` and `truncatedBytes`). Captures never leave the machine: consumers are the Enduser report flow and Skill Learning, both local. We rejected a remote telemetry endpoint — the plugin must not phone home, document paths and excerpts are the Enduser's confidential data, and file drop is the simplest ingest both consumers already read.

## Considered options

- Remote telemetry endpoint (rejected: privacy, trust, opencode plugin norms)
- SQLite store via built-in `node:sqlite` (rejected: no query consumer exists yet; per-invoke JSON files avoid cross-session write locks and match the test Capture artifact; revisit if captures need analysis at scale)
- opencode `tool.execute.after` hook only (rejected: fires only on success and misses the host invoke path, so it would capture exactly the cases we do not need)
- Gated runtime Capture, off unless learning is enabled (supersedes ADR 0013's gate: the gate hid the failures we most need to see, and the sweep caps the cost that motivated it)

## Consequences

- Capture is now unconditional on every invoke; ADR 0013's "when learning is enabled" gate no longer applies and `CONTEXT.md` (root and `docs/`) Capture entry was amended accordingly.
- `office.preview` success is not captured: its output is a data-URL preview of up to 20 MB; its failures are.
- Captures may contain absolute paths and document excerpts: the writer drops a `.gitignore` (`*`) in the captures dir.
- Writes are fire-and-forget: a failed Capture never fails an invoke.
- The dir is swept to the newest 200 files on each write.
