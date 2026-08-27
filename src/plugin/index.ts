import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"
import { officecliInvokes, runOfficecliInvoke } from "@/plugin/tools/officecli"
import { listActiveDrafts } from "@/core/draft/manager"
import { configureOptions } from "@/core/options"

// ponytail: this host build exposes no tool domain for external plugins; officecliTool/editTool
// stay exported and tested — re-register via ctx.tool.transform when the host ships it
export const OpenOfficePlugin = define({
  id: "openoffice",
  effect: (ctx) =>
    Effect.gen(function* () {
      configureOptions(ctx.options)

      for (const name of Object.keys(officecliInvokes)) {
        // ponytail: InvokeHooks types handlers as Effect<unknown> (E = never), but the core
        // registry yields* the handler so typed failures still propagate at runtime — cast
        yield* ctx.invoke.register(
          name,
          (input) =>
            Effect.tryPromise({
              try: () => runOfficecliInvoke(name, input),
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            }) as unknown as Effect.Effect<unknown>,
        )
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
