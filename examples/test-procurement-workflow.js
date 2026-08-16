#!/usr/bin/env bun

/**
 * Test: Procurement Workflow (3-step chain)
 *
 * Demonstrates document chain generation:
 * B1: Purchase request → B2: Approval decision → B3: Technical specs
 *
 * Run: bun examples/test-procurement-workflow.js
 */

import { Effect, Schema } from "effect"
import { officecliTool } from "../dist/plugin/tools/officecli"
import { mkdir, rm } from "fs/promises"
import { configureOptions } from "../dist/core/options"
import { tmpdir } from "os"
import { join } from "path"
import { existsSync } from "fs"

const mockContext = {
  agent: "test-agent",
  sessionID: "procurement-session",
  messageID: "test-message",
  id: "test-call",
  progress: () => Effect.void,
}

async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const result = await Effect.runPromise(officecliTool.execute(input, mockContext))
  return result.output
}

async function setup() {
  configureOptions({ dataDir: join(tmpdir(), "openoffice-procurement-test") })
  await mkdir("./test-procurement", { recursive: true })
}

async function cleanup() {
  await rm(join(tmpdir(), "openoffice-procurement-test"), { recursive: true, force: true })
  await rm("./test-procurement", { recursive: true, force: true })
}

async function testProcurementChain() {
  console.log("🏥 Testing Procurement Workflow (3-step chain)\n")

  // Step 1: Purchase Request (B1)
  console.log("📋 Step 1: Create Purchase Request (B1)")
  const b1 = await call({
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
  })
  console.log("   ", b1)

  await call({ action: "accept", filePath: "./test-procurement/B1-purchase-request.docx" })
  console.log("   ✓ B1 accepted\n")

  // Step 2: Approval Decision (B2) - reads B1
  console.log("📋 Step 2: Generate Approval Decision (B2)")
  const b1Content = await call({ action: "read", filePath: "./test-procurement/B1-purchase-request.docx" })
  console.log("   Read B1:", b1Content.substring(0, 50) + "...")

  const b2 = await call({
    action: "create",
    filePath: "./test-procurement/B2-approval-decision.docx",
    content: `# Approval Decision No. 802/QĐ-BV

Based on purchase request from Microbiology Department:

${b1Content}

## Decision
- Approved: Reagent kits (100 tests)
- Budget: $5,000
- Procurement method: Direct shopping
- Date: 12/08/2026
`,
  })
  console.log("   ", b2)

  await call({ action: "accept", filePath: "./test-procurement/B2-approval-decision.docx" })
  console.log("   ✓ B2 accepted\n")

  // Step 3: Technical Specs (B3) - reads B1 + B2
  console.log("📋 Step 3: Generate Technical Specs (B3)")
  const b2Content = await call({ action: "read", filePath: "./test-procurement/B2-approval-decision.docx" })
  console.log("   Read B2:", b2Content.substring(0, 50) + "...")

  const b3 = await call({
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
  })
  console.log("   ", b3)

  await call({ action: "accept", filePath: "./test-procurement/B3-technical-specs.docx" })
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
  const history = await call({ action: "history", filePath: "./test-procurement/B2-approval-decision.docx" })
  console.log("   ", history)

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
