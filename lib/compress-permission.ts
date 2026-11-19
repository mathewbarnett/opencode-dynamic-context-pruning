// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PluginConfig } from "./config"
import type { SessionState } from "./state"

/**
 * Effective compress permission for the native OC2 path. Host rules are
 * resolved once in `resolveCompressPermission` and cached on the session;
 * this helper just reads that cached value with the config as fallback.
 */
export const compressPermission = (
    state: SessionState,
    config: PluginConfig,
): "ask" | "allow" | "deny" => {
    return state.compressPermission ?? config.compress.permission
}
