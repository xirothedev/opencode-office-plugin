#!/usr/bin/env node

/**
 * Full Flow Demo: Prompt → 23 Documents
 *
 * Demonstrates:
 * 1. User prompt (natural language)
 * 2. Data extraction (structured input)
 * 3. Workflow orchestration (subagent per step)
 * 4. Chain execution (B1→B2→...→B23)
 * 5. Output files (all documents generated)
 *
 * Run: node examples/full-flow-demo.js
 */

import { officecliTool } from "../dist/plugin/tools/officecli.js"
import { mkdir, rm } from "fs/promises"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../dist/core/storage/paths.js"

const mockContext = {
  agent: "orchestrator",
  sessionID: "procurement-session",
  messageID: "demo-message",
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

// Simulate user prompt
const userPrompt = `
Create procurement package for Microbiology department:
- Items: Reagent kits (100 tests), Pipettes (50 units)
- Budget: $10,000
- Purpose: Diagnostic testing
- Deadline: 30 days
`

console.log("🎯 User Prompt:")
console.log(userPrompt)

// Phase 1: Extract structured data (simulate agent parsing)
const inputData = {
  department: "Microbiology",
  items: [
    { name: "Reagent kits", quantity: 100, unit: "tests" },
    { name: "Pipettes", quantity: 50, unit: "units" },
  ],
  budget: 10000,
  purpose: "Diagnostic testing",
  deadline: "30 days",
  date: new Date().toLocaleDateString("vi-VN"),
}

console.log("\n📊 Extracted Data:")
console.log(JSON.stringify(inputData, null, 2))

// Phase 2: Define workflow (simplified 5 steps for demo)
const workflow = [
  { id: "B1", name: "Purchase Request", deps: [] },
  { id: "B2", name: "Approval Decision", deps: ["B1"] },
  { id: "B3", name: "Technical Specs", deps: ["B1", "B2"] },
  { id: "B4", name: "Budget Approval", deps: ["B3"] },
  { id: "B5", name: "Procurement Plan", deps: ["B4"] },
]

// Phase 3: Subagent generators
async function generateB1(input) {
  return `# Purchase Request

## Department: ${input.department}
## Purpose: ${input.purpose}
## Date: ${input.date}

## Items
${input.items.map((i) => `- ${i.name}: ${i.quantity} ${i.unit}`).join("\n")}

## Estimated Budget: $${input.budget}
## Deadline: ${input.deadline}
`
}

async function generateB2(input, deps) {
  const b1 = deps.B1
  return `# Approval Decision No. 802/QĐ-BV

## Based on Purchase Request:
${b1}

## Decision
- Approved: All items listed above
- Budget: $${input.budget}
- Procurement method: Direct shopping
- Date: ${input.date}
`
}

async function generateB3(input) {
  return `# Technical Specifications

## References
- Purchase Request (B1)
- Approval Decision 802/QĐ-BV (B2)

## Technical Requirements

### Reagent kits
- Sensitivity: ≥95%
- Specificity: ≥90%
- Quantity: 100 tests (confirmed)

### Pipettes
- Volume range: 10-100 μL
- Accuracy: ±1%
- Quantity: 50 units (confirmed)

## Meeting Notes
Technical council approved on ${input.date}.
`
}

async function generateB4(input, deps) {
  const b3 = deps.B3
  return `# Budget Approval No. 878/QĐ-BV

## Based on Technical Specifications (B3):
${b3.substring(0, 200)}...

## Approved Budget
- Total: $${input.budget}
- Reagent kits: $7,000
- Pipettes: $3,000
- Source: Service revenue

## Date: ${input.date}
`
}

async function generateB5(input, deps) {
  const b4 = deps.B4
  return `# Procurement Plan

## Based on Budget Approval (B4):
${b4.substring(0, 200)}...

## Plan Details
- Package name: ${input.department} supplies
- Total value: $${input.budget}
- Method: Direct shopping
- Timeline: ${input.deadline}
- Contract type: Fixed price

## Date: ${input.date}
`
}

const generators = {
  B1: generateB1,
  B2: generateB2,
  B3: generateB3,
  B4: generateB4,
  B5: generateB5,
}

// Phase 4: Execute workflow
async function executeWorkflow() {
  await mkdir(getDraftsDir(), { recursive: true })
  await mkdir(getHistoryDir(), { recursive: true })
  await mkdir(getLocksDir(), { recursive: true })
  await mkdir("./demo-procurement", { recursive: true })

  const results = {}

  console.log("\n🔄 Executing Workflow...")

  for (const step of workflow) {
    console.log(`\n📋 ${step.id}: ${step.name}`)

    // Read dependencies
    const depContents = {}
    for (const dep of step.deps) {
      const readResult = await officecliTool.execute(
        { action: "read", filePath: `./demo-procurement/${dep}.docx` },
        mockContext
      )
      depContents[dep] = readResult.output
      console.log(`   ✓ Read ${dep} (${readResult.output.length} chars)`)
    }

    // Generate content
    const generator = generators[step.id]
    const content = await generator(inputData, depContents)
    console.log(`   ✓ Generated content (${content.length} chars)`)

    // Create draft
    await officecliTool.execute(
      { action: "create", filePath: `./demo-procurement/${step.id}.docx`, content },
      mockContext
    )

    // Accept
    await officecliTool.execute(
      { action: "accept", filePath: `./demo-procurement/${step.id}.docx` },
      mockContext
    )

    results[step.id] = content
    console.log(`   ✓ Accepted ${step.id}.docx`)
  }

  // Summary
  console.log("\n" + "=".repeat(60))
  console.log("✅ WORKFLOW COMPLETE")
  console.log("=".repeat(60))
  console.log(`\nGenerated ${workflow.length} documents:`)
  for (const step of workflow) {
    console.log(`  ✓ ${step.id}-${step.name.toLowerCase().replace(/\s/g, "-")}.docx`)
  }

  console.log("\n📜 Version History (B2):")
  const history = await officecliTool.execute(
    { action: "history", filePath: "./demo-procurement/B2.docx" },
    mockContext
  )
  console.log(`  ${history.output}`)

  console.log("\n📁 Output Directory: ./demo-procurement/")
  console.log("  - B1.docx (Purchase Request)")
  console.log("  - B2.docx (Approval Decision, refs B1)")
  console.log("  - B3.docx (Technical Specs, refs B1+B2)")
  console.log("  - B4.docx (Budget Approval, refs B3)")
  console.log("  - B5.docx (Procurement Plan, refs B4)")

  // Cleanup
  await rm(getDraftsDir(), { recursive: true, force: true })
  await rm(getHistoryDir(), { recursive: true, force: true })
  await rm(getLocksDir(), { recursive: true, force: true })
}

executeWorkflow().catch(console.error)
