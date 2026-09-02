# Reviewing existing documents

> Advanced OOXML edits (XML-level): delegate to the bundled format skill. `skills/docx:Editing existing documents` (`unzip → merge_runs.py → edit word/document.xml → zip → validate.py`) is canonical for precise .docx surgery; `skills/pptx:Editing existing decks` (`thumbnail.py` + `add_slide.py` + `clean.py`) for decks. `officecli` comments/track-changes wrap the same OOXML but at higher level.

## First move: read

`read` any file you did not author this session before editing. For files with user content, decide the edit mode:

- User asked for direct changes → plain `edit` + `accept`
- File carries user-authored content worth preserving visibly → **suggestions** or **track changes** below
- Unsure which mode the user wants → **ask the user with the mode question below** before writing any content change; if asking is impossible, default to suggestions — they are reversible and visible in Office apps

**Mode question** — keep the two-option structure and ask in the **user's language** (Vietnamese endusers get the Vietnamese version; translate faithfully, do not reword the options), then stop and wait for the answer:

```
How should I apply changes to <file>?

1. Suggested edits (recommended for content you wrote)
   Each change is a comment with proposed text. You review with
   list-comments, approve what you want, deny the rest. I accept after.
2. Direct edit
   I rewrite the draft and accept. Nothing changes the file until accept.
   history/revert can undo any accepted version.

Which one? (1 = suggested, 2 = direct)
```

One question per file, asked once. After the user answers, keep that mode for the whole task on that file.

Suggestions and comments belong to files that already have content. On a file created this session, write the content directly and skip comments entirely.

## Suggestions (comments carrying proposed text)

A comment with `suggestedText` is a proposed change anchored to a location. Anchors per format:

| Format | Anchor args | Approve effect |
|---|---|---|
| DOCX | `rangeStartParagraph`/`rangeStartOffset`, `rangeEndParagraph`/`rangeEndOffset` | Replaces the anchored paragraph text |
| XLSX | `cellRef` (e.g. `"B4"`) | Writes the value into the cell — numeric if parseable, else string |
| PPTX | `slide` number, optional `x`/`y` | Replaces the first text box on that slide |

Flow:

```
officecli(action="edit", filePath="report.docx", content="<full revised draft>")
officecli(action="comment", filePath="report.docx", commentId="c1",
  author="AI Agent", commentText="Tighten summary",
  suggestedText="Revised paragraph text",
  rangeStartParagraph=0, rangeStartOffset=0, rangeEndParagraph=0, rangeEndOffset=10)
officecli(action="list-comments", filePath="report.docx")
officecli(action="approve", filePath="report.docx", commentId="c1")
officecli(action="accept", filePath="report.docx")
```

Rules:

- `approve` applies one suggestion into the draft and removes the comment; comments without `suggestedText` are plain notes — approving one errors
- No `reject` action exists: a suggestion is declined by leaving it unapproved (the user resolves it in Office) or by undoing the draft
- Comments survive Office round-trips: the user can read/resolve them in Word/Excel/PowerPoint's comment panel before ever running `accept`
- Give every suggestion a distinct `commentId`; `review` output references them

> Low-level DOCX comments (six cross-linked files) — use `skills/docx:Comments` helper `python skills/docx/scripts/comment.py` (dir mode when also editing `document.xml`, else `-o annotated.docx`). It prints the `<w:commentRangeStart>` snippet to place in `word/document.xml`.

## Track changes (DOCX only)

Native redlines with author attribution, stored as `w:ins`/`w:del`:

```
officecli(action="track-insert", filePath="doc.docx", commentId="t1",
  author="AI Agent", content="inserted text", paragraph=3, offset=0)
officecli(action="track-delete", filePath="doc.docx", commentId="t2",
  author="AI Agent", content="deleted text", paragraph=5, offset=12)
```

XLSX/PPTX error here by design — OOXML defines no track changes for them; use suggestion comments instead.

> For XML-level redlining (e.g. `w:ins`/`w:del` with `w:author`/`w:date` on runs, `w:delText` vs `w:t`, paragraph-mark deletions), follow `skills/docx:Tracked changes` exactly and validate with `python skills/docx/scripts/office/validate.py out.docx --original doc.docx --author "AI Agent"` — it flags untracked edits. To accept all: `python skills/docx/scripts/accept_changes.py in.docx out.docx` (note empty-bullet artifact on deleted numbered paras — Word joins them, accept scripts don't).

## Review summary

`review` (DOCX/XLSX/PPTX) reads pending comments + track changes from any file and returns what awaits user decision — run it when taking over a document mid-review or after the user edited it in Office. Comment ids in its output feed `approve`.

## Version recovery

Every `accept` snapshots a version.

- `history` lists snapshots with timestamps
- `revert timestamp` opens a draft from any snapshot — `accept` writes it back
- Reverting never destroys anything: old versions stay in history, so recovery from a bad accept is `history` → `revert` → `accept`

## Non-content mutations

These live in the draft sidecar (markdown drafts can't carry binary properties) and merge into the real file at accept:

- `metadata filePath [properties]` — title/author/subject/keywords (Office), info dict (PDF); call without `properties` to read current values
- `watermark filePath text [position] [size] [opacity]` — position: diagonal-center, top-center, bottom-center
- `annotate filePath annotations` — images only: text notes, rectangular highlights, stamps (fixed palette: DRAFT, APPROVED, CONFIDENTIAL)

Image model — three distinct things:

- **Render**: writing markdown to an image file creates a *new* text-on-white-canvas image; it never modifies an existing image's pixels
- **Overlay** (`watermark`/`annotate`): sidecar mutations composited onto an existing image at accept
- Pixel editing of an existing image: unsupported
