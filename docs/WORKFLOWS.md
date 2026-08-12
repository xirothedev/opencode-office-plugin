# Common Workflows

Heavy office tasks involve chains of interdependent documents. This plugin automate document generation, version control, and format conversion for these workflows.

## Example: Procurement Workflow (23 documents)

Hospital procurement require 23 sequential documents (B1→B23), each with input from prior steps:

```
B1: Purchase request → B2: Approval decision → B3: Technical specs meeting minutes
→ B4: Technical specs approval → B5: Price reference → B6: Budget estimation
→ ... → B23: Payment settlement
```

### Flow 1: Sequential Document Chain

**Scenario**: Generate entire procurement package from initial request.

```bash
# Step 1: Create purchase request (B1)
officecli(action="create", filePath="./procurement/B1-request.docx", content="# Purchase Request\n\n## Items\n- Reagent kits: 100 tests\n...")
officecli(action="accept", filePath="./procurement/B1-request.docx")

# Step 2: Read B1, generate approval decision (B2)
b1_content = officecli(action="read", filePath="./procurement/B1-request.docx")
officecli(action="create", filePath="./procurement/B2-approval.docx", content="# Approval Decision\n\nBased on: ${b1_content}\n\nApproved...")
officecli(action="accept", filePath="./procurement/B2-approval.docx")

# Step 3-N: Continue chain...
```

**Plugin benefits**:
- Each document version tracked (history action)
- Can revert any step (revert action)
- Lock prevent concurrent edits
- Format conversion automatic (DOCX → markdown → DOCX)

### Flow 2: Template-Based Batch Generation

**Scenario**: Generate 50 similar documents from template (e.g., approval decisions for different departments).

```bash
# Create template
officecli(action="create", filePath="./templates/decision-template.docx", content="# Decision [NUMBER]\n\nDepartment: [DEPT]\nAmount: [AMOUNT]\n...")
officecli(action="accept", filePath="./templates/decision-template.docx")

# Generate variants
for dept in ["Microbiology", "Radiology", "Cardiology"]:
  template = officecli(action="read", filePath="./templates/decision-template.docx")
  customized = template.replace("[DEPT]", dept).replace("[NUMBER]", generate_number())
  officecli(action="create", filePath=f"./decisions/{dept}-decision.docx", content=customized)
  officecli(action="accept", filePath=f"./decisions/{dept}-decision.docx")
```

### Flow 3: Version Control + Audit Trail

**Scenario**: Track all changes to procurement documents for compliance.

```bash
# Initial version
officecli(action="create", filePath="./budget.docx", content="# Budget: $100,000")
officecli(action="accept", filePath="./budget.docx", timestamp=1234567890)

# Revision 1
officecli(action="create", filePath="./budget.docx", content="# Budget: $120,000\n\nRevised due to...")
officecli(action="accept", filePath="./budget.docx", timestamp=1234567900)

# View history
history = officecli(action="history", filePath="./budget.docx")
# Returns: [{"timestamp": 1234567890, "sessionID": "abc"}, {"timestamp": 1234567900, "sessionID": "abc"}]

# Revert if needed
officecli(action="revert", filePath="./budget.docx", timestamp=1234567890)
officecli(action="accept", filePath="./budget.docx")
```

### Flow 4: Collaborative Editing with Locks

**Scenario**: Multiple team members edit different documents, prevent conflicts.

```bash
# User A: Lock budget document
officecli(action="create", filePath="./budget.docx", content="...")
# Lock acquired automatically

# User B: Try edit same document → error
officecli(action="create", filePath="./budget.docx", content="...")
# Error: "lock held by session A"

# User A: Finish + release lock
officecli(action="accept", filePath="./budget.docx")
# Lock released

# User B: Now can edit
officecli(action="create", filePath="./budget.docx", content="...")
```

### Flow 5: Format Conversion Pipeline

**Scenario**: Extract data from PDF invoices, process in spreadsheet, generate report.

```bash
# Extract text from PDF invoice
invoice_text = officecli(action="read", filePath="./invoice.pdf")
# Returns markdown with extracted text

# Parse + process (agent logic)
data = parse_invoice(invoice_text)

# Create summary spreadsheet
officecli(action="create", filePath="./summary.xlsx", content=generate_spreadsheet(data))
officecli(action="accept", filePath="./summary.xlsx")

# Generate final report (DOCX)
officecli(action="create", filePath="./report.docx", content=generate_report(data))
officecli(action="accept", filePath="./report.docx")
```

## Advanced Patterns

### Pattern 1: Dependency Graph

Model document dependencies explicitly:

```
B1 → B2 → B3 → B4
         ↓
    B5 → B6 → B7
```

Agent can traverse graph, generate documents in correct order, validate inputs exist before creating dependent documents.

### Pattern 2: Validation Gates

Before accepting document, validate content:

```bash
# Create draft
officecli(action="create", filePath="./decision.docx", content=draft_content)

# Validate (agent logic)
if not validate_decision(draft_content):
  officecli(action="undo", filePath="./decision.docx")
  # Fix + retry

# Accept if valid
officecli(action="accept", filePath="./decision.docx")
```

### Pattern 3: Batch Read + Aggregate

Read multiple documents, aggregate into summary:

```bash
# Read all department requests
requests = []
for dept in departments:
  content = officecli(action="read", filePath=f"./{dept}/request.docx")
  requests.append(content)

# Generate summary
summary = aggregate_requests(requests)
officecli(action="create", filePath="./summary.docx", content=summary)
officecli(action="accept", filePath="./summary.docx")
```

### Pattern 4: Snapshot Comparison

Compare current draft with historical snapshot:

```bash
# Get historical version
history = officecli(action="history", filePath="./budget.docx")
old_snapshot = history[0]  # First version

# Read current
current = officecli(action="read", filePath="./budget.docx")

# Diff (agent logic)
changes = diff(old_snapshot, current)
```

## Real-World Applications

### 1. Legal Document Packages
- Contract templates → customized per client
- Appendices with client-specific data
- Version control for negotiations
- Audit trail for compliance

### 2. Financial Reporting
- Extract data from bank statements (PDF)
- Process in spreadsheet (XLSX)
- Generate executive summary (DOCX)
- Archive with timestamps

### 3. HR Onboarding
- Offer letter template → personalized
- Tax forms batch generation
- Policy acknowledgment tracking
- Compliance document chain

### 4. Research Documentation
- Protocol documents with version history
- Data collection forms (XLSX)
- Analysis reports (DOCX)
- Regulatory submission packages

### 5. Construction Project
- Permit applications (chain of approvals)
- Inspection reports (PDF → extract → process)
- Change order tracking
- As-built documentation

## Tips

1. **Use descriptive file paths**: `./procurement/2024/Q1/reagent-request.docx` not `./doc1.docx`
2. **Timestamp explicit**: Pass `timestamp` to `accept` for deterministic history
3. **Read before edit**: Always read current version before creating new draft
4. **Validate before accept**: Use `undo` if draft content invalid
5. **Batch operations**: Loop over lists for batch generation
6. **Format choice**: Use DOCX for editable documents, PDF for archival, XLSX for data

## Limitations

- PDF/Image = read-only (can't write back)
- Complex formatting may not round-trip perfectly (markdown intermediate)
- Large files (>10MB) may be slow (pandoc conversion)
- No real-time collaboration (lock-based, not CRDT)

## Future Enhancements

- [ ] PDF write support (markdown → PDF via pandoc/pdflatex)
- [ ] Image annotation (OCR + overlay)
- [ ] Real-time collaboration (WebSocket locks)
- [ ] Document comparison (diff viewer)
- [ ] Template library (pre-built workflow templates)
