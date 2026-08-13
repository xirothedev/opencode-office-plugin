#!/usr/bin/env bun

/**
 * Test: Procurement Workflow (3-step chain)
 *
 * Demonstrates document chain generation:
 * B1: Purchase request → B2: Approval decision → B3: Technical specs
 *
 * Run: bun examples/test-procurement-workflow.js
 */

import { officecliTool } from "../dist/plugin/tools/officecli"
import { mkdir, rm } from "fs/promises"
import { getDraftsDir, getHistoryDir, getLocksDir } from "../dist/core/storage/paths"
import { existsSync } from "fs"

const mockContext = {
  agent: "test-agent",
  sessionID: "procurement-session",
  messageID: "test-message",
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

async function setup() {
  await mkdir(getDraftsDir(), { recursive: true })
  await mkdir(getHistoryDir(), { recursive: true })
  await mkdir(getLocksDir(), { recursive: true })
  await mkdir("./test-procurement", { recursive: true })
}

async function cleanup() {
  await rm(getDraftsDir(), { recursive: true, force: true })
  await rm(getHistoryDir(), { recursive: true, force: true })
  await rm(getLocksDir(), { recursive: true, force: true })
  await rm("./test-procurement", { recursive: true, force: true })
}

async function testProcurementChain() {
  console.log("🏥 Testing Procurement Workflow (3-step chain)\n")

  // Step 1: Purchase Request (B1)
  console.log("📋 Step 1: Create Purchase Request (B1)")
  const b1 = await officecliTool.execute(
    {
      action: "create",
      filePath: "./test-procurement/B1-purchase-request.docx",
      content: `# Purchase Request

## Department: Microbiology

## Items
- Reagent kits: 100 tests
- Purpose: Diagnostic testing
- Technical requirements: Sensitivity >95%, Specificity >90%
- Budget source: Service revenue
- Date: 12/08/2026
`,
    },
    mockContext
  )
  console.log("   ", b1.output)

  await officecliTool.execute(
    { action: "accept", filePath: "./test-procurement/B1-purchase-request.docx" },
    mockContext
  )
  console.log("   ✓ B1 accepted\n")

  // Step 2: Approval Decision (B2) - reads B1
  console.log("📋 Step 2: Generate Approval Decision (B2)")
  const b1Content = await officecliTool.execute(
    { action: "read", filePath: "./test-procurement/B1-purchase-request.docx" },
    mockContext
  )
  console.log("   Read B1:", b1Content.output.substring(0, 50) + "...")

  const b2 = await officecliTool.execute(
    {
      action: "create",
      filePath: "./test-procurement/B2-approval-decision.docx",
      content: `# Approval Decision No. 802/QĐ-BV

Based on purchase request from Microbiology Department:

${b1Content.output}

## Decision
- Approved: Reagent kits (100 tests)
- Budget: $5,000
- Procurement method: Direct shopping
- Date: 12/08/2026
`,
    },
    mockContext
  )
  console.log("   ", b2.output)

  await officecliTool.execute(
    { action: "accept", filePath: "./test-procurement/B2-approval-decision.docx" },
    mockContext
  )
  console.log("   ✓ B2 accepted\n")

  // Step 3: Technical Specs (B3) - reads B1 + B2
  console.log("📋 Step 3: Generate Technical Specs (B3)")
  const b2Content = await officecliTool.execute(
    { action: "read", filePath: "./test-procurement/B2-approval-decision.docx" },
    mockContext
  )
  console.log("   Read B2:", b2Content.output.substring(0, 50) + "...")

  const b3 = await officecliTool.execute(
    {
      action: "create",
      filePath: "./test-procurement/B3-technical-specs.docx",
      content: `# Technical Specifications

Based on:
- Purchase request (B1)
- Approval decision 802/QĐ-BV (B2)

## Reagent Kits - Technical Requirements
- Sensitivity: ≥95%
- Specificity: ≥90%
- Sample type: Blood, serum
- Storage: 2-8°C
- Shelf life: 12 months
- Quantity: 100 tests (confirmed)

## Meeting Notes
Technical council approved specifications on 12/08/2026.
`,
    },
    mockContext
  )
  console.log("   ", b3.output)

  await officecliTool.execute(
    { action: "accept", filePath: "./test-procurement/B3-technical-specs.docx" },
    mockContext
  )
  console.log("   ✓ B3 accepted\n")

  // Verify chain
  console.log("🔍 Verification")
  const files = ["B1-purchase-request.docx", "B2-approval-decision.docx", "B3-technical-specs.docx"]
  for (const file of files) {
    const path = `./test-procurement/${file}`
    console.log(`   ${existsSync(path) ? "✓" : "✗"} ${file}`)
  }

  // Check history
  console.log("\n📜 History (B2)")
  const history = await officecliTool.execute(
    { action: "history", filePath: "./test-procurement/B2-approval-decision.docx" },
    mockContext
  )
  console.log("   ", history.output)

  console.log("\n✅ Procurement workflow test complete!")
  console.log("   Generated: ./test-procurement/B1.docx, B2.docx, B3.docx")
  console.log("   Each document references prior steps (chain dependency)")
}

async function main() {
  await setup()
  try {
    await testProcurementChain()
  } finally {
    await cleanup()
  }
}

main().catch(console.error)
