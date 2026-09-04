import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { OpenOfficePlugin, isBlockedTool, blockBinary } from "@/plugin/index"

describe("live host tool registration", () => {
  function run(ctx: Record<string, unknown>) {
    return Effect.runPromise(Effect.scoped(OpenOfficePlugin.effect({ options: {}, ...ctx } as never)))
  }

  it("registers officecli + edit and hooks execute.before", async () => {
    const added: { name?: string }[] = []
    const hooks: string[] = []
    await run({
      tool: {
        transform: (cb: (e: { add: (t: { name?: string }) => void }) => void) => {
          cb({ add: (t) => added.push(t) })
          return Effect.void
        },
        hook: (name: string) => {
          hooks.push(name)
          return Effect.void
        },
      },
    })
    expect(added.map((t) => t.name)).toEqual(["officecli", "edit"])
    expect(hooks).toEqual(["execute.before"])
  })

  it("blocks binary paths and allows text", () => {
    expect(() => blockBinary("write", { path: "/tmp/a.docx" })).toThrow(/officecli/)
    expect(() => blockBinary("read", { filePath: "/tmp/a.pdf" })).toThrow(/officecli/)
    expect(() => blockBinary("read", { filePath: "/tmp/a.md" })).not.toThrow()
    expect(isBlockedTool("edit")).toBe(true)
    expect(isBlockedTool("read")).toBe(false)
  })
})
