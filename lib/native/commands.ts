// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PluginConfig } from "../config"
import type { Logger } from "../logger"
import type { SessionState } from "../state"
import { compressPermission } from "../compress-permission"
import {
    handleContextCommand,
    handleDecompressCommand,
    handleHelpCommand,
    handleManualToggleCommand,
    handleManualTriggerCommand,
    handleRecompressCommand,
    handleStatsCommand,
    handleSweepCommand,
} from "../commands"
import type { WithParts } from "../state"

export interface NativeCommandDeps {
    client: any
    state: SessionState
    logger: Logger
    config: PluginConfig
    workingDirectory: string
    sessionID: string
    text: string
    messages: WithParts[]
}

/**
 * Dispatch a native `/dcp …` invocation directly through the shared command
 * handlers. Returns the trigger prompt when `compress`/`dcp-compress` staged a
 * manual compression, so the caller can deliver it via `ctx.session.prompt`.
 */
export async function executeNativeCommand(deps: NativeCommandDeps): Promise<string | null> {
    const { client, state, logger, config, workingDirectory, sessionID, messages } = deps
    if (!config.commands.enabled) return null

    if (compressPermission(state, config) === "deny") return null

    const args = (deps.text || "").trim().split(/\s+/).filter(Boolean)
    const subcommand = args[0]?.toLowerCase() ?? ""
    const subArgs = args.slice(1)

    const commandCtx = { client, state, config, logger, sessionId: sessionID, messages }

    if (subcommand === "context") {
        await handleContextCommand(commandCtx)
        return null
    }
    if (subcommand === "stats") {
        await handleStatsCommand(commandCtx)
        return null
    }
    if (subcommand === "sweep") {
        await handleSweepCommand({ ...commandCtx, args: subArgs, workingDirectory })
        return null
    }
    if (subcommand === "manual") {
        await handleManualToggleCommand(commandCtx, subArgs[0]?.toLowerCase())
        return null
    }
    if (subcommand === "compress") {
        const userFocus = subArgs.join(" ").trim()
        const prompt = await handleManualTriggerCommand(commandCtx, "compress", userFocus)
        if (!prompt) return null
        state.manualMode = "compress-pending"
        state.pendingManualTrigger = { sessionId: sessionID, prompt }
        return prompt
    }
    if (subcommand === "decompress") {
        await handleDecompressCommand({ ...commandCtx, args: subArgs })
        return null
    }
    if (subcommand === "recompress") {
        await handleRecompressCommand({ ...commandCtx, args: subArgs })
        return null
    }

    await handleHelpCommand(commandCtx)
    return null
}
