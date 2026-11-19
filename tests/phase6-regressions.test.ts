import assert from "node:assert/strict"
import test from "node:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdirSync } from "node:fs"
import { parse } from "jsonc-parser"
import { createCompressMessageTool } from "../lib/compress/message"
import { createSessionState, type WithParts } from "../lib/state"
import type { PluginConfig } from "../lib/config"
import { Logger } from "../lib/logger"
import { syncToolCache } from "../lib/state/tool-cache"
import { deduplicate } from "../lib/strategies/deduplication"
import { syncCompressionBlocks } from "../lib/messages/sync"
import { resetOnCompaction } from "../lib/state/utils"
import { appendProtectedUserMessages } from "../lib/compress/protected-content"
import { validateConfigTypes } from "../lib/config"
import { getCurrentTokenUsage } from "../lib/token-utils"

const testDataHome = join(tmpdir(), `dcp-p6-data-${process.pid}`)
const testConfigHome = join(tmpdir(), `dcp-p6-config-${process.pid}`)
process.env.XDG_DATA_HOME = testDataHome
process.env.XDG_CONFIG_HOME = testConfigHome
mkdirSync(testDataHome, { recursive: true })
mkdirSync(testConfigHome, { recursive: true })

function buildConfig(): PluginConfig {
    return {
        enabled: true,
        debug: false,
        pruneNotification: "off",
        commands: { enabled: true, protectedTools: [] },
        manualMode: { enabled: false, automaticStrategies: true },
        turnProtection: { enabled: false, turns: 4 },
        experimental: { allowSubAgents: false, customPrompts: false },
        protectedFilePatterns: [],
        compress: {
            mode: "message",
            permission: "allow",
            showCompression: false,
            maxContextLimit: 150000,
            minContextLimit: 50000,
            nudgeFrequency: 5,
            iterationNudgeThreshold: 15,
            nudgeForce: "soft",
            protectedTools: [],
            protectTags: false,
            protectUserMessages: false,
        },
        strategies: {
            deduplication: { enabled: true, protectedTools: [] },
            purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
        },
    } as PluginConfig
}

function textPart(messageID: string, sessionID: string, id: string, text: string) {
    return { id, messageID, sessionID, type: "text" as const, text }
}

function buildMessages(sessionID: string): WithParts[] {
    return [
        {
            info: {
                id: "msg-user-1",
                role: "user",
                sessionID,
                agent: "assistant",
                model: { providerID: "anthropic", modelID: "claude-test" },
                time: { created: 1 },
            } as WithParts["info"],
            parts: [textPart("msg-user-1", sessionID, "part-1", "First line\nSecond line")],
        },
        {
            info: {
                id: "msg-assistant-1",
                role: "assistant",
                sessionID,
                agent: "assistant",
                time: { created: 2 },
            } as WithParts["info"],
            parts: [textPart("msg-assistant-1", sessionID, "part-2", "I mapped the code path")],
        },
    ]
}

function buildTool(
    state: ReturnType<typeof createSessionState>,
    messages: WithParts[],
    config = buildConfig(),
) {
    return createCompressMessageTool({
        client: {
            session: {
                messages: async () => ({ data: messages }),
                get: async () => ({ data: { parentID: null } }),
            },
        },
        state,
        logger: new Logger(false),
        config,
        prompts: {
            reload() {},
            getRuntimePrompts: () => ({ compressMessage: "", compressRange: "" }),
        },
    } as any)
}

// Fix 1: canonical dedupe
test("duplicate message refs differing only in case produce one block", async () => {
    const sessionID = `ses_dupe_${Date.now()}`
    const state = createSessionState()
    const tool = buildTool(state, buildMessages(sessionID))
    await tool.execute(
        {
            topic: "dupes",
            content: [
                { messageId: "M0002", topic: "a", summary: "first" },
                { messageId: "m0002", topic: "b", summary: "second" },
            ],
        },
        {
            ask: async () => {},
            metadata: () => {},
            sessionID,
            messageID: "msg-compress",
            callID: "call-1",
        } as any,
    )
    assert.equal(state.prune.messages.blocksById.size, 1)
})

// Fix 2: tool cache refreshes mutable fields
test("tool cache refreshes status when a pending tool becomes errored", () => {
    const state = createSessionState()
    const config = buildConfig()
    const logger = new Logger(false)
    const part: any = {
        id: "p1",
        messageID: "msg-a",
        sessionID: "ses",
        type: "tool",
        callID: "call-x",
        tool: "bash",
        state: { status: "running", input: { command: "echo hi" } },
    }
    const msg: WithParts = {
        info: {
            id: "msg-a",
            role: "assistant",
            sessionID: "ses",
            time: { created: 1 },
            model: { providerID: "p", modelID: "m" },
        } as WithParts["info"],
        parts: [part],
    }
    syncToolCache(state, config, logger, [msg])
    assert.equal(state.toolParameters.get("call-x")?.status, "running")

    part.state = { status: "error", input: { command: "echo hi" }, error: "boom" }
    syncToolCache(state, config, logger, [msg])
    assert.equal(state.toolParameters.get("call-x")?.status, "error")
    assert.equal(state.toolParameters.get("call-x")?.error, "boom")
})

// Fix 5: dedup keeps successful output
test("deduplication keeps the most recent successful duplicate", () => {
    const state = createSessionState()
    const config = buildConfig()
    const logger = new Logger(false)
    for (const [id, status] of [
        ["c1", "completed"],
        ["c2", "error"],
    ] as const) {
        state.toolParameters.set(id, {
            tool: "grep",
            parameters: { pattern: "x" },
            status,
            turn: 0,
            tokenCount: 10,
        })
    }
    const messages: WithParts[] = [
        {
            info: {
                id: "m",
                role: "assistant",
                sessionID: "s",
                time: { created: 1 },
            } as WithParts["info"],
            parts: [
                {
                    type: "tool",
                    callID: "c1",
                    tool: "grep",
                    state: { status: "completed", input: { pattern: "x" }, output: "found" },
                },
                {
                    type: "tool",
                    callID: "c2",
                    tool: "grep",
                    state: { status: "error", input: { pattern: "x" }, error: "fail" },
                },
            ] as any,
        },
    ]
    deduplicate(state, logger, config, messages)
    assert.equal(state.prune.tools.has("c1"), false, "successful call retained")
    assert.equal(state.prune.tools.has("c2"), true, "failed duplicate pruned")
})

// Fix 3: blocks stay active when origin leaves window
test("compression block stays active when its origin message is absent", () => {
    const state = createSessionState()
    state.prune.messages.blocksById.set(1, {
        blockId: 1,
        runId: 1,
        active: true,
        deactivatedByUser: false,
        compressedTokens: 10,
        summaryTokens: 5,
        durationMs: 0,
        topic: "t",
        startId: "m1",
        endId: "m1",
        anchorMessageId: "m1",
        compressMessageId: "origin-msg",
        includedBlockIds: [],
        consumedBlockIds: [],
        parentBlockIds: [],
        directMessageIds: ["m1"],
        directToolIds: [],
        effectiveMessageIds: ["m1"],
        effectiveToolIds: [],
        createdAt: 1,
        summary: "S",
    })
    state.prune.messages.byMessageId.set("m1", {
        tokenCount: 10,
        allBlockIds: [1],
        activeBlockIds: [1],
    })
    syncCompressionBlocks(state, new Logger(false), [
        {
            info: {
                id: "m1",
                role: "user",
                sessionID: "s",
                time: { created: 1 },
                tokens: {},
            } as WithParts["info"],
            parts: [],
        },
    ])
    assert.equal(state.prune.messages.blocksById.get(1)?.active, true)
    assert.equal(state.prune.messages.activeBlockIds.has(1), true)
})

// Fix 6: protected user messages keep all text parts
test("protected user message preserves all text parts", () => {
    const config = buildConfig()
    const messages = buildMessages("ses")
    const searchContext = {
        rawMessages: messages,
        rawMessagesById: new Map(messages.map((m) => [m.info.id, m])),
        rawIndexById: new Map(messages.map((m, i) => [m.info.id, i])),
        summaryByBlockId: new Map(),
    }
    const selection = {
        startReference: { type: "message" as const, id: "msg-user-1" },
        endReference: { type: "message" as const, id: "msg-user-1" },
        messageIds: ["msg-user-1"],
        messageTokenById: new Map([["msg-user-1", 10]]),
        toolIds: [],
        requiredBlockIds: [],
    }
    const summary = appendProtectedUserMessages(
        "",
        selection as any,
        searchContext,
        createSessionState(),
        true,
    )
    assert.match(summary, /First line/)
    assert.match(summary, /Second line/)
})

// Fix 8: resetOnCompaction clears stale fields
test("resetOnCompaction clears timing/cache/stats/context state", () => {
    const state = createSessionState()
    state.compressionTiming.startsByCallId.set("c", 1)
    state.subAgentResultCache.set("c", "result")
    state.toolIdList = ["c"]
    state.stats.totalPruneTokens = 100
    state.manualMode = "active"
    state.modelContextLimit = 1000
    state.systemPromptTokens = 50
    resetOnCompaction(state)
    assert.equal(state.compressionTiming.startsByCallId.size, 0)
    assert.equal(state.subAgentResultCache.size, 0)
    assert.deepEqual(state.toolIdList, [])
    assert.equal(state.stats.totalPruneTokens, 0)
    assert.equal(state.manualMode, false)
    assert.equal(state.modelContextLimit, undefined)
    assert.equal(state.systemPromptTokens, undefined)
})

// Fix 4: strict percent validation
test("config validation rejects malformed percent limits", () => {
    const raw: any = parse(`{"compress":{"maxContextLimit":"abc%"}}`)
    const errors = validateConfigTypes(raw)
    assert.ok(errors.some((e) => e.key === "compress.maxContextLimit"))
})

// Fix 9: token accounting is explicit (no cache double count)
test("token usage sums input, output, reasoning and cache separately", () => {
    const state = createSessionState()
    const messages: WithParts[] = [
        {
            info: {
                id: "m",
                role: "assistant",
                sessionID: "s",
                time: { created: 1 },
                tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 10 } },
            } as WithParts["info"],
            parts: [],
        },
    ]
    assert.equal(getCurrentTokenUsage(state, messages), 165)
})
