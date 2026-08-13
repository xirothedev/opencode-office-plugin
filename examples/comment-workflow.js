/**
 * Basic comment workflow example
 *
 * Demonstrates:
 * - Adding comments to a DOCX file
 * - Listing comments
 * - Reading comments back
 */

import { officecliTool } from "../dist/plugin/tools/officecli"

async function main() {
  const filePath = "./examples/sample-contract.docx"
  const sessionID = "example-session-1"
  const context = { sessionID }

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

  await officecliTool.execute(
    {
      action: "create",
      filePath,
      content: draftContent,
    },
    context,
  )
  console.log("✓ Draft created\n")

  // Step 2: Add a comment
  console.log("2. Adding comment...")
  await officecliTool.execute(
    {
      action: "comment",
      filePath,
      commentId: "comment-1",
      author: "Legal AI",
      commentText: "Liability clause exceeds standard limits. Recommend negotiation to $2,000,000.",
      rangeStartParagraph: 7,
      rangeStartOffset: 0,
      rangeEndParagraph: 7,
      rangeEndOffset: 50,
    },
    context,
  )
  console.log("✓ Comment added\n")

  // Step 3: Add track changes
  console.log("3. Adding track changes...")
  await officecliTool.execute(
    {
      action: "track-delete",
      filePath,
      commentId: "tc-1",
      author: "Legal AI",
      content: "$5,000,000",
      paragraph: 7,
      offset: 27,
    },
    context,
  )

  await officecliTool.execute(
    {
      action: "track-insert",
      filePath,
      commentId: "tc-2",
      author: "Legal AI",
      content: "$2,000,000",
      paragraph: 7,
      offset: 27,
    },
    context,
  )
  console.log("✓ Track changes added\n")

  // Step 4: Accept draft
  console.log("4. Accepting draft...")
  await officecliTool.execute({ action: "accept", filePath }, context)
  console.log("✓ Draft accepted\n")

  // Step 5: List comments
  console.log("5. Listing comments...")
  const commentsResult = await officecliTool.execute(
    { action: "list-comments", filePath },
    context,
  )
  console.log("Comments:", commentsResult.output)
  console.log()

  // Step 6: Review summary
  console.log("6. Review summary...")
  const reviewResult = await officecliTool.execute({ action: "review", filePath }, context)
  console.log(reviewResult.output)
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
