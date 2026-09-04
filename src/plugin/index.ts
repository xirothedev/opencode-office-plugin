import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"
import { Tool } from "@opencode-ai/schema/tool"
import { officecliInvokes } from "@/plugin/invoke-names"
import { officecliTool } from "@/plugin/tools/officecli"
import { editTool } from "@/plugin/tools/edit"
import { BINARY_EXTENSIONS, OFFICE_READ_EXTENSIONS } from "@/core/format/detect"
import { configureOptions } from "@/core/options"

export function isBlockedTool(tool: string): boolean {
  return tool === "edit" || tool === "write"
}

// ponytail: live host ctx drifts from the pinned vendored types in both directions (beta dropped invoke, shipped tool) — feature-detect at the seam
interface ToolEditorLike {
  add: (tool: unknown) => void
}
interface LiveCtx {
  options?: unknown
  invoke?: { register: (name: string, h: (i: unknown) => Effect.Effect<unknown>) => Effect.Effect<unknown> }
  tool?: {
    transform: (cb: (editor: ToolEditorLike) => void) => Effect.Effect<unknown>
    hook: (name: string, cb: (e: { tool: string; input?: unknown }) => void) => Effect.Effect<unknown>
  }
}

const blockMessage = "use officecli tool for office/PDF files — office is the main method for read + handle"

export function blockBinary(tool: string, input: unknown): void {
  const args = (input ?? {}) as Record<string, unknown>
  const fp = typeof args.filePath === "string" ? args.filePath : typeof args.path === "string" ? args.path : ""
  const ext = fp.includes(".") ? fp.slice(fp.lastIndexOf(".")).toLowerCase() : ""
  if ((isBlockedTool(tool) && BINARY_EXTENSIONS.has(ext)) || (tool === "read" && OFFICE_READ_EXTENSIONS.has(ext))) {
    throw new Tool.Error({ message: blockMessage })
  }
}

export const OpenOfficePlugin = define({
  id: "openoffice",
  effect: (rawCtx) =>
    Effect.gen(function* () {
      const ctx = rawCtx as unknown as LiveCtx
      configureOptions(ctx.options as never)

      if (ctx.invoke) {
        for (const name of Object.keys(officecliInvokes)) {
          yield* ctx.invoke.register(
            name,
            (input: unknown) =>
              Effect.tryPromise({
                try: async () => {
                  const { runOfficecliInvoke } = await import("@/plugin/host")
                  return runOfficecliInvoke(name, input)
                },
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              }) as unknown as Effect.Effect<unknown>,
          )
        }
      }

      if (ctx.tool) {
        // add(editTool) replaces the builtin edit by name (ADR 0010) — draft lifecycle covers every write
        yield* ctx.tool.transform((editor) => {
          editor.add(officecliTool)
          editor.add(editTool)
        })
        // ponytail: host runs hook callbacks through yield* — the non-throwing path must return an Effect, not undefined
        yield* ctx.tool.hook("execute.before", (event) => {
          blockBinary(event.tool, event.input)
          return Effect.void
        })
      }

      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          const { listActiveDrafts } = await import("@/core/draft/manager")
          for (const draft of listActiveDrafts()) {
            if (draft.orphaned) {
              console.log(`[office-plugin] Orphaned draft: ${draft.filePath}`)
            }
          }
        }).pipe(Effect.ignore),
      )
    }),
})

export default OpenOfficePlugin
