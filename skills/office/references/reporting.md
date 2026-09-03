# Enduser bug reporting

Procedure for collecting an **Enduser report** — a self-contained file a non-technical Enduser forwards to the developer when asked to report a problem, so the plugin or a skill can be fixed. Enduser devices have no `gh` and no GitHub access: **the report is one portable file**, never a GitHub issue, never a zip.

All output to the Enduser follows [enduser-output.md](enduser-output.md). The report file itself is **English** (developer-facing); the Enduser's answers are translated into it, never asked in English.

## Triggers

- **Handoff phrase** (primary): the developer sends the Enduser this line — the Enduser typing it (or a close variant) starts the interview:

  > In your office chat, type: **report the problem you had with <task>**. Answer the 4 short questions — I'll receive the report file from you.

- **Fallback detection**: a complaint about an office task failing ("file bị lỗi", "saya not able to...") — confirm once ("Want me to prepare a report for the developer?"), then interview.

## Interview — 4 questions, Enduser's language

Ask all four in the Enduser's language, one message, numbered; cap each answer at 1–2 sentences; optional 5th: "which file?" (name is enough). Ask **zero** technical questions — versions, commands, and logs are the agent's job.

| # | Question (render in user language) | Maps to field |
|---|-------------------------------------|---------------|
| 1 | What were you doing? | `task` |
| 2 | What went wrong, in your words? | `symptom` |
| 3 | What did you expect to happen? | `expected` |
| 4 | What did you do instead to finish the work? | `workaround` |

Agent fills the rest from this session's Captures and environment. Missing answer → `unknown`, never blocked on.

## Classification

Agent sets `class`: `plugin-bug` (officecli misbehaved), `skill-gap` (the workflow/instructions failed, plugin behaved correctly), `format-fidelity` (output format broke vs the Reference), `unclear`. The Enduser may override with one word. Classification is for developer triage — never explain the taxonomy to the Enduser.

## The report file

Path: `.opencode/office/reports/YYYY-MM-DD-<slug>.md` (slug from `task`). Single file, schema:

```markdown
---
report: 1
date: <ISO-8601>
class: plugin-bug | skill-gap | format-fidelity | unclear
task: <Q1 answer, translated>
file: <file name or unknown>
symptom: <Q2 answer, translated>
expected: <Q3 answer, translated>
workaround: <Q4 answer, translated>
learned-link: <set when the workaround worked — Skill Learning owns recording it; never store the pattern here>
plugin: <version or unknown>
opencode: <version or unknown>
os: <platform>
captures: [<capture ids — local refs for follow-up>]
---

## Enduser statement

> <verbatim answers, translated, attributed as the Enduser's words>

## What the plugin did

1. `officecli action="create" filePath="Báo giá.docx" content=<omitted: 412 chars>` → ok
2. `officecli action="edit" ...` → ok
3. ❌ `officecli action="substitute" filePath="Báo giá.docx" data=<omitted: 3 keys>` → error: <first line, scrubbed>
```

### Sanitization (hard rule — reports are confidential dossiers)

- Redact **values** of: `content`, `data`, `dataArray`, `commentText`, `text`, `suggestedText`, `properties`, `rules` → `<omitted: N chars>` / `<omitted: N keys>`.
- Keep: action names, `filePath`/`targetPath` **base names**, ids, `cellRef`, paragraph/slide indices, result/error states.
- Errors: first line only; strip any quoted user text from the message.
- Never embed file contents. Full Captures stay local; the ids in front matter let the Enduser attach them **only if the developer explicitly asks and the Enduser opts in** — warn once what Captures expose.

## After writing — confirmation (enduser-output shape)

```
Report is ready — 1 page, with your 4 answers and what the plugin did.
Nothing was sent anywhere; the file stays on this machine.
Next: attach `2026-09-02-pricing-quote-error.md` to your message to the developer.
```

No GitHub wording, no labels, no publish step. When the workaround in Q4 worked, hand it to the existing **Skill Learning** loop — that stays the single recording path (ADR-0013); this file only links it.

## What NOT to do

- Ask the Enduser for versions, commands, screenshots of terminals, or reproduction steps — that is Captures' job.
- Ship content-bearing Captures by default, or zip them "just in case".
- Re-interview for detail the session already recorded.
- Store the working workaround's pattern here (Skill Learning's job) or open a second learning path.
