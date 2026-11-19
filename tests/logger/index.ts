import type { Plugin } from "@opencode/plugin"
import { setup } from "./v2.js"

export default {
    id: "opencode-request-logger",
    setup,
} satisfies Plugin.Plugin
