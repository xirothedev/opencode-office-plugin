import type { Plugin } from "@opencode-ai/plugin"
import { officecliTool } from "./tools/officecli.js"

export const OpenOfficePlugin: Plugin = async (ctx) => {
  return {
    tool: {
      officecli: officecliTool,
    },
  }
}

export default OpenOfficePlugin
