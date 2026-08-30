---
name: <kebab-name>
description: <Leading word> for <daily task>. Use when <branch 1>, <branch 2>, or <branch 3>.
---

# <Title>

One sentence: what this Task Skill does and why it exists.

## Steps

1. Inventory input — `ls -R <input>` / `officecli list` — completion: file list captured
2. Extract — `officecli read` each source → markdown — completion: dates/doc numbers extracted
3. Render — fill table via `references/template.md` — completion: markdown has all rows
4. Create — `officecli create filePath + content` then `accept` — completion: `officecli validate` PASS
5. Prove — Tracer Bullet in Isolated Runtime — completion: `report.md` PASS

Disclose what only some branches need in `references/`; inline what every branch needs.

Skipped: scripts until XML/fidelity branch needs them — add `scripts/*.py` then.
