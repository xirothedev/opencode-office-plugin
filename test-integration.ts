#!/usr/bin/env bun
/**
 * Direct plugin integration test — bypass opencode TUI
 * Test 10 use cases with real hospital form templates
 */

import { officecliTool } from "./src/plugin/tools/officecli"
import { mkdir, writeFile, readFile } from "fs/promises"
import { join } from "path"

const TEST_DIR = "/tmp/orca-office-tests-direct"
const HOSPITAL_DIR = "/Users/xirothedev/workspace/Tài liệu làm việc/Tài liệu nội bộ/Bệnh viện"

await mkdir(TEST_DIR, { recursive: true })

const mockContext = {
  agent: "test-agent",
  sessionID: "test-session-" + Date.now(),
  messageID: "test-message",
  directory: TEST_DIR,
  worktree: TEST_DIR,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => "yes",
}

const results = []

async function runTest(name, fn) {
  try {
    const start = Date.now()
    await fn()
    const ms = Date.now() - start
    results.push({ name, status: "PASS", ms })
    console.log(`✅ ${name} (${ms}ms)`)
  } catch (err) {
    results.push({ name, status: "FAIL", error: err.message })
    console.log(`❌ ${name}: ${err.message}`)
  }
}

// Test 1: Read DOCX form template
await runTest("Test 1: Read DOCX form template", async () => {
  const result = await officecliTool.execute(
    { action: "read", filePath: `${HOSPITAL_DIR}/01. Mẫu chỉ định thầu DV và MSHH dưới 50 triệu/02. Yêu cầu báo giá.docx` },
    mockContext
  )
  if (!result || !result.output || result.output.length < 100) throw new Error("Read returned empty/short content")
})

// Test 2: Read legacy .doc
await runTest("Test 2: Read legacy .doc", async () => {
  const result = await officecliTool.execute(
    { action: "read", filePath: `${HOSPITAL_DIR}/01. Mẫu chỉ định thầu DV và MSHH dưới 50 triệu/01. Đơn đề xuất.doc` },
    mockContext
  )
  if (!result || !result.output) throw new Error("Read returned null")
})

// Test 3: Read XLSX
await runTest("Test 3: Read XLSX spreadsheet", async () => {
  const result = await officecliTool.execute(
    { action: "read", filePath: `${HOSPITAL_DIR}/01. Mẫu chỉ định thầu DV và MSHH dưới 50 triệu/Bảng kê chứng từ thanh toán.xls` },
    mockContext
  )
  if (!result || !result.output) throw new Error("Read returned null")
})

// Test 4: Create DOCX
await runTest("Test 4: Create purchase request DOCX", async () => {
  const path = `${TEST_DIR}/test4-don-de-xuat.docx`
  await officecliTool.execute(
    { action: "create", filePath: path, content: "# ĐƠN ĐỀ XUẤT MUA SẮM\n\nKhoa: Nội tổng hợp\n\n- Hóa chất: 100 test\n- Vật tư: găng tay 50 hộp" },
    mockContext
  )
  await officecliTool.execute({ action: "accept", filePath: path }, mockContext)
  const stat = await readFile(path).catch(() => null)
  if (!stat) throw new Error("File not created after accept")
})

// Test 5: Batch generate from template
await runTest("Test 5: Batch generate from template", async () => {
  const templatePath = `${TEST_DIR}/test5-template.md`
  await writeFile(templatePath, "# DỰ TOÁN {{STT}}\n\nKhoa: {{KHOA}}\n\nSố tiền: {{SO_TIEN}} VNĐ")

  await officecliTool.execute(
    {
      action: "generate",
      templatePath,
      filePaths: [`${TEST_DIR}/test5-001.docx`, `${TEST_DIR}/test5-002.docx`, `${TEST_DIR}/test5-003.docx`],
      dataArray: JSON.stringify([
        { STT: "1", KHOA: "Nội", SO_TIEN: "5000000" },
        { STT: "2", KHOA: "Ngoại", SO_TIEN: "8000000" },
        { STT: "3", KHOA: "Nhi", SO_TIEN: "3000000" }
      ])
    },
    mockContext
  )

  for (const f of ["test5-001.docx", "test5-002.docx", "test5-003.docx"]) {
    await officecliTool.execute({ action: "accept", filePath: `${TEST_DIR}/${f}` }, mockContext)
  }
})

// Test 6: Create XLSX
await runTest("Test 6: Create budget XLSX", async () => {
  const path = `${TEST_DIR}/test6-budget.xlsx`
  await officecliTool.execute(
    {
      action: "create",
      filePath: path,
      content: "# Bảng dự toán\n\n| STT | Nội dung | Số tiền |\n|-----|----------|--------|\n| 1 | Hóa chất | 5,000,000 |\n| 2 | Vật tư | 4,000,000 |\n| | **Tổng** | **9,000,000** |"
    },
    mockContext
  )
  await officecliTool.execute({ action: "accept", filePath: path }, mockContext)
})

// Test 7: Export DOCX → PDF
await runTest("Test 7: Export DOCX → PDF", async () => {
  const docxPath = `${TEST_DIR}/test7-hop-dong.docx`
  const pdfPath = `${TEST_DIR}/test7-hop-dong.pdf`

  await officecliTool.execute(
    { action: "create", filePath: docxPath, content: "# HỢP ĐỒNG MUA BÁN\n\nSố: 2805/2026/HĐ-MB\n\nGiá trị: 120,000,000 VNĐ" },
    mockContext
  )
  await officecliTool.execute({ action: "accept", filePath: docxPath }, mockContext)
  await officecliTool.execute({ action: "export", filePath: docxPath, targetPath: pdfPath }, mockContext)
})

// Test 8: Add watermark
await runTest("Test 8: Add watermark", async () => {
  const path = `${TEST_DIR}/test8-bien-ban.docx`
  await officecliTool.execute(
    { action: "create", filePath: path, content: "# BIÊN BẢN NGHIỆM THU\n\nHạng mục: Lắp đặt thiết bị y tế" },
    mockContext
  )
  await officecliTool.execute({ action: "accept", filePath: path }, mockContext)
  await officecliTool.execute(
    { action: "watermark", filePath: path, text: "BẢN NHÁP", position: "diagonal-center" },
    mockContext
  )
  await officecliTool.execute({ action: "accept", filePath: path }, mockContext)
})

// Test 9: Add comment
await runTest("Test 9: Add comment for review", async () => {
  const path = `${TEST_DIR}/test9-to-trinh.docx`
  await officecliTool.execute(
    { action: "create", filePath: path, content: "# TỜ TRÌNH\n\nV/v: Phê duyệt kế hoạch LCNT\n\nKính gửi: Ban Giám đốc" },
    mockContext
  )
  await officecliTool.execute({ action: "accept", filePath: path }, mockContext)
  await officecliTool.execute(
    {
      action: "comment",
      filePath: path,
      commentId: "c1",
      author: "Trưởng phòng HCQT",
      commentText: "Cần bổ sung bảng so sánh giá",
      rangeStartParagraph: 2,
      rangeEndParagraph: 2
    },
    mockContext
  )
  const comments = await officecliTool.execute({ action: "list-comments", filePath: path }, mockContext)
  if (!comments || !comments.output || comments.output.includes("No comments")) throw new Error("Comment not listed")
})

// Test 10: Diff + validate
await runTest("Test 10: Diff + validate before accept", async () => {
  const path = `${TEST_DIR}/test10-quyet-dinh.docx`

  // v1
  await officecliTool.execute(
    { action: "create", filePath: path, content: "# QUYẾT ĐỊNH\n\nPhê duyệt dự toán: 100,000,000 VNĐ" },
    mockContext
  )
  await officecliTool.execute({ action: "accept", filePath: path }, mockContext)

  // v2 draft
  await officecliTool.execute(
    { action: "create", filePath: path, content: "# QUYẾT ĐỊNH\n\nPhê duyệt dự toán: 120,000,000 VNĐ\n\nGhi chú: Đã điều chỉnh" },
    mockContext
  )

  const diff = await officecliTool.execute({ action: "diff", filePath: path }, mockContext)
  if (!diff || !diff.output) throw new Error("Diff returned null")

  const validation = await officecliTool.execute(
    {
      action: "validate",
      filePath: path,
      rules: JSON.stringify([
        { pattern: "Phê duyệt", name: "approval-marker" },
        { pattern: "Ghi chú", name: "note-required" }
      ])
    },
    mockContext
  )
  if (!validation || validation.output.includes("FAIL")) throw new Error("Validation failed")

  await officecliTool.execute({ action: "accept", filePath: path }, mockContext)
})

// Summary
console.log("\n" + "=".repeat(60))
console.log(`PASSED: ${results.filter(r => r.status === "PASS").length}/${results.length}`)
console.log("=".repeat(60))
for (const r of results) {
  if (r.status === "FAIL") console.log(`  ❌ ${r.name}: ${r.error}`)
}

process.exit(results.every(r => r.status === "PASS") ? 0 : 1)
