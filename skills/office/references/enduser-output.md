# Enduser output standard

Standard for **every message the agent shows the Enduser** (office staff with no technical skill). The Enduser must answer two questions from any message without asking again: **what happened?** and **what do I do now?**

This file is agent instruction, written in English for stable model performance. All templates below are English skeletons: **render every user-facing message at runtime in the Enduser's language.** Never send an English template to a non-English Enduser, and never mix: one message, one language.

Derived from: [plainlanguage.gov](https://www.plainlanguage.gov/guidelines/) (Plain Writing Act principles), [NN/g error-message guidelines](https://www.nngroup.com/articles/error-message-guidelines/), [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/).

## The 8 rules

1. **Result first (BLUF).** First line = outcome + counts. Causes and caveats come after, never before.
2. **Match the Enduser's language.** Reply in the language of the Enduser's last message. Keep file names, cell references, and their quoted text exactly as written.
3. **Common words only.** Use words a clerk uses at work. Never use names or states from this plugin (`draft`, `lock`, `accept`, `snapshot`, `hash`, `PK`, `L3`, `JSON`, `markdown`) and never paste raw tool output. If a concept has no plain word the user knows, describe the **effect**, not the mechanism.
4. **Active voice, address the reader.** "I applied", "you chose" — never "changes were committed by the system". One sentence, one fact, at most 20 words.
5. **Name the object.** Say which file, sheet, slide, or clause (the way the Enduser would name it). Generic status ("an error occurred", "some changes applied") is a violation.
6. **Every problem ships with the next step.** State the remedy as one reply the Enduser can send back. Offer a small set of choices, not an open question. Never end a message on a failure alone.
7. **Never blame.** "The file is open in Word, so it cannot be saved yet" — never "you left the file open". Always state what is still safe: nothing reaches the real file until the Enduser approves.
8. **One reply must work.** End every report/question with the smallest answer shape: a numbered list plus one example reply ("reply: approve 1 and 3"). Numbering must match comment ids so the reply cannot misfire.

## Message shapes

Use these four shapes; do not improvise others. Translate the filled result, not this file.

**1. Task report** — see SKILL.md Enduser report rule. Line 1: result + count. Then numbered changes: `what — where — applied | waiting for you`. Last line: the one next action.

Template:
```
Done: 3 changes in <file>
1. <what changed> — <location> — waiting for you
2. <what changed> — <location> — applied
3. <what changed> — <location> — waiting for you

Next: reply "approve 1 and 3" to apply, or "reject 1" to keep the old text.
```

**2. Question** — one question, two labeled choices, one example reply. One topic per message.

Template:
```
How should I apply changes to <file>?
1. Suggested edits — each change waits for your approve/reject
2. Direct edit — I apply everything, you review the finished file
Which one? (reply 1 or 2)
```

**3. Failure** — exactly three lines: what failed (named object) → what is safe → the reply that fixes or stops it.

Template:
```
Could not open <file> — it is open on another machine.
Nothing was changed; your file is untouched.
Close it and reply "retry", or reply "stop".
```

**4. Waiting reminder** (suggestions open, Enduser silent) — restate the numbered pending list and the exact reply that applies them. Do not re-explain the mechanism.

## Locale data (apply when the Enduser's language is Vietnamese)

These are formatting facts, not translation choices — apply them to rendered output:

- Address the reader as **bạn**; use **anh/chị** only if the Enduser used that register first. Never infer a name.
- Thousands separator `.`, decimal `,`; money as `1.000.000 ₫` (unit after); dates as `dd/MM/yyyy`. Inside quoted document text, keep the document's own format.
- Use the office terms staff actually use (e.g. `hồ sơ`, `tờ trình`, `phê duyệt`) instead of formal dictionary translations when rendering Vietnamese.

## Self-check before sending (the clerk test)

- Would someone who never opened a developer tool know exactly what to type next?
- Does any word from rule 3's forbidden list appear? → rewrite that sentence.
- Can the whole message be answered with one number or one word? If not: split it or add the example reply.
- Result in line 1, the ask in the last line?
- Is the message in the Enduser's language end to end?

## What NOT to do

- Dump `list-comments` / `review` / `diff` output "for transparency" — the UI shows it; the prose restates it in human terms.
- Explain how drafts, snapshots, or locks work unless the Enduser asked how it works.
- Ask more than one question per message, or ask a question whose answer is not a choice you can act on.
- Open with hedging ("I have partially completed…", "Please note that…") — start with the result.
