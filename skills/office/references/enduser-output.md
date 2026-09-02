# Enduser output standard

Standard for **every message the agent shows the Enduser** (office staff with no technical skill). The Enduser must answer two questions from any message without asking again: **what happened?** and **what do I do now?**

Derived from: [plainlanguage.gov](https://www.plainlanguage.gov/guidelines/) (Plain Writing Act principles), [NN/g error-message guidelines](https://www.nngroup.com/articles/error-message-guidelines/), [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/).

## The 8 rules

1. **Result first (BLUF).** First line = outcome + counts. History, causes, and caveats come after, never before.
2. **User's language.** Reply in the language the Enduser writes in. Keep file names, cell refs, and their own quoted text unchanged.
3. **Common words only.** Use words a clerk uses at work. Never tool names, states, or codes from this plugin (`draft`, `lock`, `accept`, `snapshot`, `hash`, `JSON`, `PK`, `L3`) — and never paste raw tool output. If a concept has no plain word the user knows, describe the effect instead of naming the mechanism.
4. **Active voice, address the reader.** "Bạn đã chọn" / "I applied", never "changes were committed by the system". One sentence, one fact. Aim ≤ 20 words.
5. **Specific, never generic.** "Trang 2 bị lỗi phông chữ" — not "Đã xảy ra lỗi". Name the object (file, sheet, slide, điều khoản) the user would recognize.
6. **Every problem ships with the next step.** State the remedy as an action the Enduser can take in one reply (NN/g: be constructive; offer a small set of choices rather than an open question). Never end on a failure alone.
7. **Never blame.** "Tệp đang mở trong Word nên tôi chưa lưu được" — not "you did not close the file". Their work is never lost: say what is still safe (nothing you did touches the file until they approve).
8. **One reply must work.** End every report/question with the smallest possible answer shape: a numbered list + a one-line example reply ("trả lời: duyệt 1 và 3"). Numbers here must match comment ids so the reply cannot misfire.

## Message shapes

Use these four shapes; do not improvise others.

**1. Task report** — see SKILL.md Enduser report rule. Line 1 result, numbered changes (`what — where — applied | waiting for you`), one next action.

**2. Question** — one question, two labeled choices, example reply. One topic per message.

**3. Failure** — three lines: what failed (named object) → what is safe → what to do or which choice fixes it.

```
Không mở được Báo giá.xlsx — tệp đang được mở ở máy khác.
Nội dung tôi chuẩn bị vẫn được giữ an toàn, chưa có gì bị ghi.
Đóng tệp đó rồi trả lời "thử lại", hoặc trả lời "hủy" để tôi dừng.
```

**4. Waiting reminder** (suggestions open, Enduser silent) — restate the numbered pending list and the exact reply that applies them. Never re-explain the mechanism.

## Vietnamese specifics

- Address **bạn**; use **anh/chị** only if the Enduser introduced that register. No first-name assumptions.
- Numbers and money in Vietnamese format: `1.000.000 ₫` (dot thousands, unit after), dates `dd/MM/yyyy`. Keep the document's own format inside quoted content.
- Keep short French-origin office terms staff actually use (`hồ sơ`, `tờ trình`, `phê duyệt`) instead of stiff translations.
- Bilingual chats: match the language of the Enduser's **last** message.

## Self-check before sending (the clerk test)

- Would someone who has never opened a computer read this and know exactly what to type next?
- Any word from this list? `draft, lock, accept, undo, snapshot, version, hash, OOXML, ZIP, markdown, JSON, API, plugin, tool, action` → rewrite.
- Can the whole message be answered with one number or one word? If not, split it or add the example reply.
- Is the good news in line 1 and the ask in the last line?

## What NOT to do

- Dump `list-comments`/`review`/`diff` output "for transparency" — the UI shows it; prose repeats it in human terms.
- Explain how drafts, snapshots, or locks work unless the Enduser asked how it works.
- Ask more than one question per message, or a question whose answer is not a choice you can act on.
- Hedged openings ("I have partially completed…", "Please note that…") — start with the result.
