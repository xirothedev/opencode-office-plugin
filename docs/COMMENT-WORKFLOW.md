# Comment and Track Changes Workflow

Collaborative document review using native Office comments and track changes.

## Overview

Agent creates draft with **comments** (suggestions) and **track changes** (insertions/deletions) instead of direct edits. User reviews in Word/Excel/PowerPoint, accepts/rejects changes, saves. Agent reads accepted version.

**Benefits:**
- User stays in familiar Office UI
- Granular control (accept/reject per change)
- Audit trail (who changed what, when)
- No separate diff/preview needed - native review

## Supported Formats

- **DOCX**: Full support (comments + track changes)
- **XLSX/PPTX**: Planned (phase 2)

## API Actions

### Add Comment

```javascript
officecli({
  action: "comment",
  filePath: "/path/to/doc.docx",
  commentId: "comment-1",
  author: "AI Agent",
  commentText: "This clause needs review",
  rangeStartParagraph: 5,
  rangeStartOffset: 10,
  rangeEndParagraph: 5,
  rangeEndOffset: 25,
})
```

### Add Track Change (Insertion)

```javascript
officecli({
  action: "track-insert",
  filePath: "/path/to/doc.docx",
  commentId: "tc-1",
  author: "AI Agent",
  content: " additional text",
  paragraph: 3,
  offset: 15,
})
```

### Add Track Change (Deletion)

```javascript
officecli({
  action: "track-delete",
  filePath: "/path/to/doc.docx",
  commentId: "tc-2",
  author: "Reviewer",
  content: "old text to remove",
  paragraph: 7,
  offset: 0,
})
```

### List Comments

```javascript
officecli({
  action: "list-comments",
  filePath: "/path/to/doc.docx",
})
// Returns: { count: 3, comments: [...] }
```

### Review Summary

```javascript
officecli({
  action: "review",
  filePath: "/path/to/doc.docx",
})
// Returns: { comments: [...], trackChanges: [...] }
```

## Workflow Example

### 1. Agent Creates Draft with Comments

```javascript
// Agent reads document
const content = await officecli({ action: "read", filePath: "contract.docx" })

// Agent adds comment
await officecli({
  action: "comment",
  filePath: "contract.docx",
  commentId: "comment-1",
  author: "Legal AI",
  commentText: "Liability clause exceeds standard limits. Recommend negotiation.",
  rangeStartParagraph: 15,
  rangeStartOffset: 0,
  rangeEndParagraph: 15,
  rangeEndOffset: 100,
})

// Agent suggests text change
await officecli({
  action: "track-delete",
  filePath: "contract.docx",
  commentId: "tc-1",
  author: "Legal AI",
  content: "$10,000,000",
  paragraph: 16,
  offset: 45,
})

await officecli({
  action: "track-insert",
  filePath: "contract.docx",
  commentId: "tc-2",
  author: "Legal AI",
  content: "$5,000,000",
  paragraph: 16,
  offset: 45,
})

// Agent accepts draft
await officecli({ action: "accept", filePath: "contract.docx" })
```

### 2. User Reviews in Word

User opens `contract.docx` in Microsoft Word:
- Sees comment bubble: "Liability clause exceeds standard limits..."
- Sees tracked change: ~~$10,000,000~~ → **$5,000,000**
- Accepts/rejects each change
- Saves document

### 3. Agent Reads Accepted Version

```javascript
// Agent reads final document
const finalContent = await officecli({ action: "read", filePath: "contract.docx" })

// Agent checks what was accepted
const review = await officecli({ action: "review", filePath: "contract.docx" })
console.log(`Comments: ${review.comments.length}, Track changes: ${review.trackChanges.length}`)
```

## Use Cases

### Legal Document Review
Lawyer reviews contract clauses, comments on ambiguous terms, accepts/rejects redlines.

### Financial Audit
CFO reviews financial statements, comments on discrepancies, tracks adjustments.

### Technical Specifications
Engineer reviews requirements, comments on feasibility, suggests modifications.

### Policy Documents
Stakeholder reviews policies, comments on governance issues, tracks revisions.

## Implementation Details

### OOXML Structure

**Comments** stored in `word/comments.xml`:
```xml
<w:comments>
  <w:comment w:id="comment-1" w:author="AI Agent" w:date="2026-08-12T10:30:00Z">
    <w:p>
      <w:r>
        <w:t>Comment text</w:t>
      </w:r>
    </w:p>
  </w:comment>
</w:comments>
```

**Track changes** inline in `word/document.xml`:
```xml
<w:ins w:id="tc-1" w:author="AI Agent" w:date="2026-08-12T10:30:00Z">
  <w:r>
    <w:t>inserted text</w:t>
  </w:r>
</w:ins>

<w:del w:id="tc-2" w:author="Reviewer" w:date="2026-08-12T11:00:00Z">
  <w:r>
    <w:delText>deleted text</w:delText>
  </w:r>
</w:del>
```

### Lock States

- **acquired**: Agent editing draft
- **in-review**: User reviewing in Word
- **stale**: Lock timeout (24h)

### Performance

- Warn at 10MB document size or 1000 comments
- Fail at 50MB or 5000 comments
- Test with large docs during development

## Limitations

- DOCX only (XLSX/PPTX planned for phase 2)
- Character-level positioning simplified (paragraph-level accuracy)
- No real-time collaboration (lock-based)
- Complex formatting may not round-trip perfectly

## Future Enhancements

- Threaded comment replies
- Comment resolution tracking
- Multi-author support with author filtering
- XLSX/PPTX support
- Real-time collaboration (CRDT-based)
