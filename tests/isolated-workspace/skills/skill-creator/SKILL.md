---
name: skill-creator
description: Create a Task Skill for a daily document task. Use when user wants to automate a repetitive task, says create skill, daily task, Task Skill, or needs to turn a dossier/folder workflow into a reusable skill.
---

# Skill Creator — grill → write

Turn one daily task into one Task Skill. Two phases, same session. No scaffolding for later.

## Phase 1 — grill

Run the `grilling` tree on the daily task. Frontier is every decision with prerequisites settled; ask the whole frontier in one round, with recommended answer, then wait.

Cover in order:
1. YAGNI — does this need a skill or does `officecli` + copy cover it?
2. I/O — one concrete input folder/file and one concrete output `.docx/.xlsx/.pptx/.pdf` (use real paths, e.g. Van Nien folder → LIST DANH MỤC)
3. Branches — distinct cases the skill handles (different tables, missing docs, empty rows). One trigger per branch.
4. Leading word — shared word in prompts + code + docs that fires the skill

Completion: every branch has a named trigger phrase and I/O is concrete (real folder listed, real output `officecli create` path).

## Phase 2 — write

Write per `writing-for-agents` ladder (`SKILL-MECHANICS.md:10` for frontmatter):

1. `skills/<kebab-name>/SKILL.md` — frontmatter `name` + `description` (pointer: front-loaded leading word, one trigger per branch, no synonyms). Body: steps in order, each ends on a checkable completion criterion. Demand is exhaustive.
2. Disclose reference behind a pointer when only some branches need it: `references/template.md` or `references/task.md`. Inline what every branch needs; disclose what only some need.
3. Keep single source of truth; do not restate `package.json` scripts or `officecli` help.

Scaffold is 2 files max (`SKILL.md` + one `references/*.md`). No `scripts/` until a branch needs code.

Prove: run the new skill's Tracer Bullet in Isolated Runtime (`tests/isolated-workspace`) — `officecli create → accept → validate` PASS. No global install.

Skipped: per-task scripts, validators, routers — add when a branch hits real XML (`docx`) / formula (`xlsx`) fidelity.

See `references/checklist.md` for the grill question template and `references/skill-template.md` for the SKILL.md shell.
