import type { Plugin } from "@opencode-ai/plugin"
import { officecliTool } from "./tools/officecli.js"
import { editTool } from "./tools/edit.js"

export const OpenOfficePlugin: Plugin = async (_ctx) => {
  return {
    tool: {
      officecli: officecliTool,
      edit: editTool,
    },
  }
}

export default OpenOfficePlugin
