import type { Plugin } from "@opencode-ai/plugin"
import { officecliTool } from "@/plugin/tools/officecli"
import { editTool } from "@/plugin/tools/edit"

export const OpenOfficePlugin: Plugin = async (_ctx) => {
  return {
    tool: {
      officecli: officecliTool,
      edit: editTool,
    },
  }
}

export default OpenOfficePlugin
