import type { Plugin } from "@opencode-ai/plugin"
import { officecliTool } from "@/plugin/tools/officecli"
import { editTool } from "@/plugin/tools/edit"
import { listActiveDrafts } from "@/core/draft/manager"

export const OpenOfficePlugin: Plugin = async (ctx) => {
  const toolUsage: Array<{ tool: string; sessionID: string; timestamp: number }> = []

  return {
    tool: {
      officecli: officecliTool,
      edit: editTool,
    },

    // Subscribe to opencode events
    event: async ({ event }) => {
      // Log message events for tracking document-related conversations
      if (event.type === "message.updated") {
        console.log(`[office-plugin] Message updated`)
      }
    },

    // Modify opencode config
    config: async (cfg) => {
      // Could add default template paths, custom format options, etc.
      // For now, no-op — extend as needed
    },

    // Track tool execution
    "tool.execute.before": async ({ tool, sessionID, callID }) => {
      if (tool === "officecli" || tool === "edit") {
        toolUsage.push({ tool, sessionID, timestamp: Date.now() })
      }
    },

    "tool.execute.after": async ({ tool, sessionID, callID }) => {
      // Could log success/failure, metrics, etc.
    },

    // Cleanup on shutdown
    dispose: async () => {
      // Log orphaned drafts
      const drafts = listActiveDrafts()
      for (const draft of drafts) {
        if (draft.orphaned) {
          console.log(`[office-plugin] Orphaned draft: ${draft.filePath}`)
        }
      }

      console.log(`[office-plugin] Disposed. Tool usage count: ${toolUsage.length}`)
    },
  }
}

export default OpenOfficePlugin
