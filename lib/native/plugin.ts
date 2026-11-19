import type { Plugin } from "@opencode/plugin"
import { getConfig } from "../config"
import { Logger } from "../logger"
import { PromptStore } from "../prompts/store"
import { createCompressMessageTool, createCompressRangeTool } from "../compress"
import { attachCompressionDuration } from "../compress/state"
import {
    createSessionState,
    ensureSessionInitialized,
    checkSession,
    saveSessionState,
    syncToolCache,
    type SessionState,
} from "../state"
import { assignMessageRefs } from "../message-ids"
import { applyPendingManualTrigger } from "../commands/manual"
import {
    buildPriorityMap,
    buildToolIdList,
    injectCompressNudges,
    injectMessageIds,
    injectExtendedSubAgentResults,
    prune,
    stripHallucinations,
    syncCompressionBlocks,
} from "../messages"
import { countTokens } from "../token-utils"
import { history, view } from "./messages"
import { analyzeContextTokens } from "../commands/context"
import { buildStatsReport } from "../commands/stats"
import { rpc, type NotificationEvent } from "./rpc"
import { createNotifier } from "./notifications"
import { applyCompressEvaluation, resolveCompressPermission } from "./permissions"
import { injectNativeSystemPrompt } from "./system-prompt"
import { executeNativeCommand } from "./commands"

export async function setup(ctx: Plugin.Context) {
    const warnings = {
        tui: {
            showToast: async (input: { body: { message: string } }) => {
                console.warn(`DCP: ${input.body.message}`)
            },
        },
    }
    const config = getConfig({ directory: ctx.location.directory, client: warnings })
    if (!config.enabled) {
        await ctx.rpc.register(
            { ...rpc, methods: { status: rpc.methods.status } },
            { status: async () => ({ enabled: false }) },
        )
        return
    }
    const logger = new Logger(config.debug)
    const prompts = new PromptStore(
        logger,
        ctx.location.directory,
        config.experimental.customPrompts,
        "compact",
    )
    const sessions = new Map<string, SessionState>()
    const queues = new Map<string, Promise<unknown>>()
    const limits = new Map<string, number>()
    const registrations: Array<{ dispose(): Promise<void> }> = []
    registrations.push(
        await ctx.permission.hook("evaluate", (evaluation) =>
            applyCompressEvaluation(config.compress.permission, evaluation),
        ),
    )
    const aliases: Record<string, string> = {
        task: "subagent",
        bash: "shell",
        apply_patch: "patch",
    }
    for (const list of [
        config.compress.protectedTools,
        config.commands.protectedTools,
        config.strategies.deduplication.protectedTools,
        config.strategies.purgeErrors.protectedTools,
    ]) {
        for (const name of [...list])
            if (aliases[name] && !list.includes(aliases[name]!)) list.push(aliases[name]!)
    }

    function serial<T>(sessionID: string, operation: () => Promise<T>): Promise<T> {
        const pending = (queues.get(sessionID) ?? Promise.resolve()).catch(() => {}).then(operation)
        queues.set(sessionID, pending)
        void pending
            .finally(() => {
                if (queues.get(sessionID) === pending) queues.delete(sessionID)
            })
            .catch(() => {})
        return pending
    }

    let emitNotification: (event: NotificationEvent) => Promise<void> = async () => {}
    let emitOpenPanel: () => Promise<void> = async () => {}
    const notifier = createNotifier(async (event) => emitNotification(event))
    const client = {
        session: {
            get: async ({ path }: { path: { id: string } }) => ({
                data: await ctx.session.get({ sessionID: path.id }),
            }),
            messages: async ({ path }: { path: { id: string } }) => {
                const [entries, session] = await Promise.all([
                    ctx.session.context({ sessionID: path.id }),
                    ctx.session.get({ sessionID: path.id }),
                ])
                return { data: history(entries, session) }
            },
            prompt: notifier.prompt,
        },
        tui: {
            showToast: notifier.showToast,
        },
    }

    async function load(sessionID: string, agentID?: string) {
        const [session, entries] = await Promise.all([
            ctx.session.get({ sessionID }),
            ctx.session.context({ sessionID }),
        ])
        const selected =
            agentID ??
            session.agent ??
            entries.findLast((entry) => entry.type === "assistant")?.agent
        if (!selected) throw new Error("DCP commands require a session with a selected agent")
        const { data: agent } = await ctx.agent.get({ agentID: selected })
        let state = sessions.get(sessionID)
        if (!state) {
            state = createSessionState("compact")
            sessions.set(sessionID, state)
        }
        const messages = history(entries, session)
        await ensureSessionInitialized(
            client,
            state,
            sessionID,
            logger,
            messages,
            config.manualMode.enabled,
        )
        await checkSession(client, state, logger, messages, config.manualMode.enabled)
        state.compressPermission = resolveCompressPermission(
            config.compress.permission,
            agent.permissions ?? [],
            session.permissions ?? [],
        ).effect
        return { state, entries, session, messages }
    }

    function allowed(state: SessionState) {
        if (state.isSubAgent && !config.experimental.allowSubAgents)
            throw new Error("DCP compression is disabled in subagents")
        if (state.compressPermission === "deny") throw new Error("DCP compression is denied")
    }

    registrations.push(
        await ctx.model.transform((editor) => {
            limits.clear()
            for (const model of editor.list())
                limits.set(`${model.providerID}/${model.id}`, model.limit.context)
        }),
    )

    for (const kind of ["context", "compaction"] as const) {
        const registration = await ctx.session.hook(kind, (event) =>
            serial(event.sessionID, async () => {
                const { state, entries, session, messages } = await load(
                    event.sessionID,
                    event.agent,
                )
                if (state.isSubAgent && !config.experimental.allowSubAgents) {
                    delete event.tools.compress
                    return
                }
                if (state.compressPermission === "deny") delete event.tools.compress
                state.modelContextLimit =
                    limits.get(`${event.model.providerID}/${event.model.id}`) ??
                    state.modelContextLimit ??
                    0
                state.systemPromptTokens = countTokens(
                    event.system.map((part) => part.text).join("\n"),
                )
                const projected = view(event.messages, entries, session)
                stripHallucinations(projected.messages, state.idFormat)
                assignMessageRefs(state, projected.messages)
                // Compaction may select only a prefix; block origins can be in the retained tail.
                syncCompressionBlocks(state, logger, messages)
                syncToolCache(state, config, logger, projected.messages)
                buildToolIdList(state, projected.messages)
                prune(state, logger, config, projected.messages)
                await injectExtendedSubAgentResults(
                    client,
                    state,
                    logger,
                    projected.messages,
                    config.experimental.allowSubAgents,
                )
                const priorities = buildPriorityMap(config, state, projected.messages)
                prompts.reload()
                injectCompressNudges(
                    state,
                    config,
                    logger,
                    projected.messages,
                    prompts.getRuntimePrompts(),
                    priorities,
                    kind === "context",
                )
                injectMessageIds(state, config, projected.messages, priorities)
                applyPendingManualTrigger(state, projected.messages, logger)
                event.messages = projected.commit()
                injectNativeSystemPrompt(state, logger, config, prompts, event.system)
                await logger.saveContext(event.sessionID, projected.messages)
            }),
        )
        registrations.push(registration)
    }

    if (config.compress.permission !== "deny") {
        const define = (state: SessionState) =>
            (config.compress.mode === "message"
                ? createCompressMessageTool
                : createCompressRangeTool)({ client, state, logger, config, prompts })
        const definition = define(createSessionState("compact"))
        registrations.push(
            await ctx.tool.transform((editor) =>
                editor.add({
                    name: "compress",
                    description: definition.description,
                    input: definition.args,
                    options: { codemode: false, permission: "compress" },
                    execute: (input, context) =>
                        serial(context.sessionID, async () => {
                            const { state } = await load(context.sessionID, context.agent)
                            allowed(state)
                            await ctx.permission.assert({
                                sessionID: context.sessionID,
                                agent: context.agent,
                                action: "compress",
                                resources: ["*"],
                                source: {
                                    type: "tool",
                                    messageID: context.messageID,
                                    id: context.id,
                                },
                                metadata: { plugin: "dcp" },
                            })
                            const started = Date.now()
                            const executor = define(state)
                            // The shared core only reads these RunContext fields; build them
                            // from real native values instead of fabricating a V1 tool context.
                            const content = await executor.execute(input, {
                                sessionID: context.sessionID,
                                messageID: context.messageID,
                                callID: context.id,
                                ask: async () => allowed(state),
                                metadata: ({ title }: { title: string }) => {
                                    void context.progress({ title })
                                },
                            })
                            attachCompressionDuration(
                                state.prune.messages,
                                context.messageID,
                                context.id,
                                Date.now() - started,
                            )
                            await saveSessionState(state, logger)
                            return { content }
                        }),
                }),
            ),
        )
    }
    if (config.commands.enabled)
        registrations.push(
            await ctx.command.transform((editor) => {
                for (const name of ["dcp", "dcp-compress"])
                    editor.add({
                        name,
                        description:
                            name === "dcp" ? "DCP commands" : "Trigger DCP manual compression",
                        execute: async (invocation) => {
                            if (name === "dcp" && !invocation.prompt.text.trim()) {
                                await emitOpenPanel()
                                return
                            }
                            const prompt = await serial(invocation.sessionID, async () => {
                                const { state, messages } = await load(invocation.sessionID)
                                if (
                                    name === "dcp-compress" ||
                                    invocation.prompt.text.trim().split(/\s+/)[0] === "compress"
                                )
                                    allowed(state)
                                const text =
                                    name === "dcp-compress"
                                        ? `compress ${invocation.prompt.text}`.trim()
                                        : invocation.prompt.text
                                const triggered = await executeNativeCommand({
                                    client,
                                    state,
                                    logger,
                                    config,
                                    workingDirectory: ctx.location.directory,
                                    sessionID: invocation.sessionID,
                                    text,
                                    messages,
                                })
                                if (!triggered) return null
                                allowed(state)
                                state.pendingManualTrigger = null
                                return triggered
                            })
                            if (prompt)
                                await ctx.session.prompt({
                                    sessionID: invocation.sessionID,
                                    text: prompt,
                                    delivery: invocation.delivery,
                                })
                        },
                    })
            }),
        )
    const rpcRegistration = await ctx.rpc.register(rpc, {
        status: async () => ({ enabled: config.commands.enabled }),
        snapshot: ({ sessionID }) =>
            serial(sessionID, async () => {
                const { state, messages } = await load(sessionID)
                syncCompressionBlocks(state, logger, messages)
                return {
                    manualMode: !!state.manualMode,
                    canCompress:
                        state.compressPermission !== "deny" &&
                        (!state.isSubAgent || config.experimental.allowSubAgents),
                    ...(state.compressPermission === "ask"
                        ? { blockedReason: "Compression requires approval" }
                        : {}),
                    context: analyzeContextTokens(state, messages),
                    stats: await buildStatsReport(state, logger),
                }
            }),
        manual: ({ sessionID, enabled }) =>
            serial(sessionID, async () => {
                const { state } = await load(sessionID)
                state.manualMode = enabled ? "active" : false
                await saveSessionState(state, logger)
                return {}
            }),
    })
    emitNotification = (event) => rpcRegistration.events.emit("notification", event)
    emitOpenPanel = () => rpcRegistration.events.emit("openPanel", {})
    registrations.push(rpcRegistration)
    logger.info("DCP native initialized")
    return async () => {
        for (const registration of registrations.splice(0)) await registration.dispose()
        sessions.clear()
        queues.clear()
        limits.clear()
    }
}
