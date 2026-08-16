/**
 * Basic comment workflow example
 *
 * Demonstrates the intended comment API on a DOCX file.
 *
 * NOTE: tool-level comments on binary-format drafts are unimplemented
 * (drafts hold markdown, not OOXML — see docs/COMMENT-WORKFLOW.md Limitations).
 * This example documents the intended flow; it fails at the comment step
 * until comments move to the sidecar design.
 *
 * Run with: bun examples/comment-workflow.js
 */

import { Effect, Schema } from "effect"
import { officecliTool } from "../dist/plugin/tools/officecli"
import { configureOptions } from "../dist/core/options"
import { tmpdir } from "os"
import { join } from "path"

const context = {
  agent: "example-agent",
  sessionID: "example-session-1",
  messageID: "example-message",
  id: "example-call",
  progress: () => Effect.void,
}

async function call(args) {
  const input = Schema.decodeUnknownSync(officecliTool.input)(args)
  const result = await Effect.runPromise(officecliTool.execute(input, context))
  return result.output
}

async function main() {
  configureOptions({ dataDir: join(tmpdir(), "openoffice-example") })
  const filePath = "./examples/sample-contract.docx"

  console.log("=== Comment Workflow Example ===\n")

  // Step 1: Create a draft
  console.log("1. Creating draft...")
  const draftContent = `# Sample Contract

This is a sample contract for demonstration purposes.

## Terms and Conditions

The parties agree to the following terms:

1. Payment of $10,000 due within 30 days
2. Delivery within 60 days of signing
3. Liability limited to $5,000,000

## Signatures

Both parties agree to the terms above.`

  await call({
    action: "create",
    filePath,
    content: draftContent,
  })
  console.log("✓ Draft created\n")

  // Step 2: Add a comment
  console.log("2. Adding comment...")
  await call({
    action: "comment",
    filePath,
    commentId: "comment-1",
    author: "Legal AI",
    commentText: "Liability clause exceeds standard limits. Recommend negotiation to $2,000,000.",
    rangeStartParagraph: 7,
    rangeStartOffset: 0,
    rangeEndParagraph: 7,
    rangeEndOffset: 50,
  })
  console.log("✓ Comment added\n")

  // Step 3: Add track changes
  console.log("3. Adding track changes...")
  await call({
    action: "track-delete",
    filePath,
    commentId: "tc-1",
    author: "Legal AI",
    content: "$5,000,000",
    paragraph: 7,
    offset: 27,
  })

  await call({
    action: "track-insert",
    filePath,
    commentId: "tc-2",
    author: "Legal AI",
    content: "$2,000,000",
    paragraph: 7,
    offset: 27,
  })
  console.log("✓ Track changes added\n")

  // Step 4: Accept draft
  console.log("4. Accepting draft...")
  await call({ action: "accept", filePath })
  console.log("✓ Draft accepted\n")

  // Step 5: List comments
  console.log("5. Listing comments...")
  const commentsResult = await call({ action: "list-comments", filePath })
  console.log("Comments:", commentsResult)
  console.log()

  // Step 6: Review summary
  console.log("6. Review summary...")
  const reviewResult = await call({ action: "review", filePath })
  console.log(reviewResult)
  console.log()

  console.log("=== Example Complete ===")
  console.log("\nNext steps:")
  console.log("1. Open", filePath, "in Microsoft Word")
  console.log("2. Review the comment and tracked changes")
  console.log("3. Accept/reject changes as needed")
  console.log("4. Save the document")
  console.log("5. Run officecli({ action: 'review', filePath }) to see accepted version")
}

main().catch(console.error)
