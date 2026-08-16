import { Effect } from "effect"
import { Plugin } from "@opencode-ai/plugin/effect"
import { officecliTool } from "@/plugin/tools/officecli"
import { editTool } from "@/plugin/tools/edit"
import { listActiveDrafts } from "@/core/draft/manager"
import { configureOptions } from "@/core/options"

export const OpenOfficePlugin = Plugin.define({
  id: "openoffice",
  effect: (ctx) =>
    Effect.gen(function* () {
      configureOptions(ctx.options)

      yield* ctx.tool.transform((tools) => {
        tools.add(officecliTool)
        tools.add(editTool)
      })

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
