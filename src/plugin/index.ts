import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"
import { Tool } from "@opencode-ai/schema/tool"
import { officecliInvokes, runOfficecliInvoke } from "@/plugin/tools/officecli"
import { BINARY_EXTENSIONS, OFFICE_READ_EXTENSIONS } from "@/plugin/tools/edit"
import { editTool } from "@/plugin/tools/edit"
import { listActiveDrafts } from "@/core/draft/manager"
import { configureOptions } from "@/core/options"

export function isBlockedTool(tool: string): boolean {
  return tool === "edit" || tool === "write"
}

// ponytail: guard + tool registration dormant until host ships ctx.tool — global check, per-tool hook when throughput matters
export const OpenOfficePlugin = define({
  id: "openoffice",
  effect: (ctx: unknown) =>
    Effect.gen(function* () {
      const safeCtx = ctx as {
        options: unknown
        invoke: {
          register: (name: string, handler: (input: unknown) => Effect.Effect<unknown>) => Effect.Effect<unknown>
        }
      } & Record<string, unknown>
      configureOptions(safeCtx.options as never)

      for (const name of Object.keys(officecliInvokes)) {
        // ponytail: InvokeHooks types handlers as Effect<unknown> (E = never), but the core
        // registry yields* the handler so typed failures still propagate at runtime — cast
        yield* safeCtx.invoke.register(
          name,
          (input: unknown) =>
            Effect.tryPromise({
              try: () => runOfficecliInvoke(name, input),
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            }) as unknown as Effect.Effect<unknown>,
        )
      }

      // ponytail: defensive guard — compiles on 1.18.22, activates when host ships ctx.tool; single global check
      const toolDomain =
        typeof ctx === "object" && ctx !== null && "tool" in ctx
          ? (ctx as Record<string, unknown>)["tool"] as
              | {
                  transform?: (cb: (r: { add: (t: unknown) => void }) => void) => Effect.Effect<unknown>
                  hook?: (name: string, cb: (e: unknown) => unknown) => Effect.Effect<unknown>
                }
              | undefined
          : undefined
      if (toolDomain?.transform) {
        yield* toolDomain.transform((registry) => {
          registry.add(editTool as unknown)
        }) as unknown as Effect.Effect<void>
      }
      if (toolDomain?.hook) {
        yield* toolDomain.hook("execute.before", (event: unknown) => {
          const e = event as { tool?: string; args?: { filePath?: string; path?: string } }
          const tool = (e.tool ?? "").toLowerCase()
          const fp = e.args?.filePath ?? e.args?.path ?? ""
          const ext = fp.includes(".") ? fp.slice(fp.lastIndexOf(".")).toLowerCase() : ""
          if (isBlockedTool(tool) && BINARY_EXTENSIONS.has(ext)) {
            throw new Tool.Error({ message: "use officecli tool for office/PDF files — office is the main method for read + handle" })
          }
          // ponytail: read hook for office/pdf — officecli read is the main method, not raw binary read
          if (tool === "read" && OFFICE_READ_EXTENSIONS.has(ext)) {
            throw new Tool.Error({ message: "use officecli tool for office/PDF files — office is the main method for read + handle" })
          }
        }) as unknown as Effect.Effect<void>
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const draft of listActiveDrafts()) {
            if (draft.orphaned) {
              console.log(`[office-plugin] Orphaned draft: ${draft.filePath}`)
            }
          }
        })
      )
    }),
})

export default OpenOfficePlugin
