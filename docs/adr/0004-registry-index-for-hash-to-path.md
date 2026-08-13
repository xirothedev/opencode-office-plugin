# Registry index file maps filePathHash back to absolute path

Drafts, locks, and history are keyed by `filePathHash` (SHA256), which is one-way. The `list` action must report real file paths, and locks can be released while a draft survives (orphaned drafts), so the mapping cannot live in the lock JSON — it would die with the lock.

A `registry/{filePathHash}.json` file is written when a Draft is created and pruned when the draft is accepted or undone. It outlives the lock, survives sessions, and makes orphaned drafts discoverable by path.

Rejected: storing the path inside the lock file (lost on release, so orphaned drafts would be undiscoverable) and scanning the filesystem for a matching file (cannot reverse a SHA256).

**Consequences**: one extra storage directory; registry entries are never written except by draft creation, so no migration of existing drafts is needed — older drafts simply lack an entry until re-created.
