import type { Plugin } from "@opencode/plugin"
import { setup } from "./lib/native/plugin"

export default { id: "opencode-dcp", setup } satisfies Plugin.Plugin
