import type { Plugin } from "@opencode-ai/plugin"
import { officecliTool } from "./tools/officecli.ts"
import { editTool } from "./tools/edit.ts"

export const OpenOfficePlugin: Plugin = async (_ctx) => {
  return {
    tool: {
      officecli: officecliTool,
      edit: editTool,
    },
  }
}

export default OpenOfficePlugin
