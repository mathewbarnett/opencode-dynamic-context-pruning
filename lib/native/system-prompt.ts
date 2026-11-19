// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SystemPart } from "@opencode/ai"
import type { PluginConfig } from "../config"
import type { Logger } from "../logger"
import type { SessionState } from "../state"
import { compressPermission } from "../compress-permission"
import { renderSystemPrompt, type PromptStore } from "../prompts"
import { buildProtectedToolsExtension } from "../prompts/extensions/system"

const INTERNAL_AGENT_SIGNATURES = [
    "You are a title generator",
    "You are a helpful AI assistant tasked with summarizing conversations",
    "You are an anchored context summarization assistant for coding sessions",
    "Summarize what was done in this conversation",
]

function isInternalAgentCall(system: readonly SystemPart[]): boolean {
    const primary = system[0]
    if (!primary || primary.type !== "text" || !primary.text) return false
    return INTERNAL_AGENT_SIGNATURES.some((signature) => primary.text.includes(signature))
}

/**
 * Native OC2 variant of the system-prompt injection. It edits the real
 * `SystemPart[]` in place — appending to the last text part (or pushing a new
 * one) — so non-text parts and their cache/metadata fields survive untouched.
 */
export function injectNativeSystemPrompt(
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
    prompts: PromptStore,
    system: SystemPart[],
): void {
    if (state.isSubAgent && !config.experimental.allowSubAgents) return

    if (isInternalAgentCall(system)) {
        logger.info("Skipping DCP system prompt injection for internal agent")
        return
    }

    if (compressPermission(state, config) === "deny") return

    // The context hook reloads prompts once before nudges are injected; doing it
    // again here would re-read every override file twice per request.
    const newPrompt = renderSystemPrompt(
        prompts.getRuntimePrompts(),
        buildProtectedToolsExtension(config.compress.protectedTools),
        !!state.manualMode,
        state.isSubAgent && config.experimental.allowSubAgents,
    )

    const index = system.length - 1
    const last = system[index]
    if (last && last.type === "text") {
        system[index] = { ...last, text: last.text + "\n\n" + newPrompt }
    } else {
        system.push({ type: "text", text: newPrompt })
    }
}
