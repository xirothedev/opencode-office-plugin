# Validate — skill-creator 4 gates (generic)

Run in Isolated Runtime (`tests/isolated-workspace`). Adapt gate 2 count per task; gates 1/3/4 are task-agnostic.

| Gate | Check | Command / evidence | Pass? |
| --- | --- | --- | --- |
| 1 Name | `name` kebab-case = folder, `description` front-load leading word, one trigger per branch | `head -n 5 skills/<name>/SKILL.md` + `grep description` |  |
| 2 Checklist | Every item the task requires has entry in `references/*.md` (e.g. dossier 22 STT → `grep -c "| STT" mapping.md` + `grill-questions.md`) | `grep -c "|" references/*.md` |  |
| 3 Hygiene | `officecli read` no PK, `create→accept` → `unzip -p word/document.xml w:tr` ≥ body, `file` type matches orig (`.doc` Composite vs `.docx` Word, `.pdf` %PDF) | `bun tests/isolated-workspace/scripts/test-*.mjs` |  |
| 4 Tracer | `tracer.mjs` 4 formats PASS | `bun tests/isolated-workspace/scripts/tracer.mjs` → `report.md` |  |

Fail gate 3 if `.doc` converted to `.docx` via `officecli` — use `cp` for `dùng mẫu` on legacy `.doc`.
