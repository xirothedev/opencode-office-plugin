import { describe, it, expect } from "vitest"
import { getDraftsDir, getLocksDir, getHistoryDir, getFilePathHash } from "@/core/storage/paths"
import { getPluginDataDir } from "@/core/options"

describe("paths", () => {
  it("computes plugin data dir", () => {
    const dir = getPluginDataDir()
    expect(dir).toMatch(/opencode\/plugins\/openoffice$/)
  })

  it("computes drafts dir", () => {
    const dir = getDraftsDir()
    expect(dir).toMatch(/opencode\/plugins\/openoffice\/drafts$/)
  })

  it("computes locks dir", () => {
    const dir = getLocksDir()
    expect(dir).toMatch(/opencode\/plugins\/openoffice\/locks$/)
  })

  it("computes history dir", () => {
    const dir = getHistoryDir()
    expect(dir).toMatch(/opencode\/plugins\/openoffice\/history$/)
  })

  it("computes filePathHash as SHA256", () => {
    const hash = getFilePathHash("/absolute/path/to/file.docx")
    expect(hash).toHaveLength(64) // SHA256 hex length
    expect(hash).toMatch(/^[a-f0-9]+$/)
  })

  it("filePathHash is deterministic", () => {
    const hash1 = getFilePathHash("/same/path.docx")
    const hash2 = getFilePathHash("/same/path.docx")
    expect(hash1).toBe(hash2)
  })

  it("filePathHash differs for different paths", () => {
    const hash1 = getFilePathHash("/path/one.docx")
    const hash2 = getFilePathHash("/path/two.docx")
    expect(hash1).not.toBe(hash2)
  })
})
