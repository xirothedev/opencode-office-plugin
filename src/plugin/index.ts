import type { Plugin } from "@opencode-ai/plugin"
import { officecliTool } from "./tools/officecli"
import { editTool } from "./tools/edit"

export const OpenOfficePlugin: Plugin = async (_ctx) => {
  return {
    tool: {
      officecli: officecliTool,
      edit: editTool,
    },
  }
}

export default OpenOfficePlugin
