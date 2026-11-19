// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Plugin } from "@opencode/plugin"
import { setup } from "./lib/native/plugin"

export default { id: "opencode-dcp", setup } satisfies Plugin.Plugin
