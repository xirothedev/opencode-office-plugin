---
"@xirothedev/openoffice-plugin-opencode": patch
---

Fixed: the plugin now registers tools through `ctx.tool` on current opencode2 hosts and defers heavy backends to first call, so it loads on hosts whose plugin harness dropped `invoke` from `ctx`.
