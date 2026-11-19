import assert from "node:assert/strict"
import test from "node:test"
import type { Message } from "@opencode/ai/schema/messages"
import { view } from "../lib/native/messages"
import { createSessionState, type CompressionBlock } from "../lib/state"
import { assignMessageRefs } from "../lib/message-ids"
import { injectMessageIds, prune } from "../lib/messages"
import type { PluginConfig } from "../lib/config"
import { Logger } from "../lib/logger"

const session = {
    id: "ses_test",
    agent: "build",
    model: { id: "test", providerID: "test" },
} as Parameters<typeof view>[2]
const config = {
    compress: { mode: "range", permission: "allow", protectUserMessages: false },
} as PluginConfig
const logger = new Logger(false)
function transcript(): Message[] {
    return [
        {
            role: "system",
            content: [{ type: "compaction", provider: "test", encrypted: "opaque-checkpoint" }],
        },
        {
            id: "msg_user",
            role: "user",
            content: [
                { type: "media", mediaType: "image/png", data: new Uint8Array([0, 255]) },
                { type: "text", text: "Inspect this", cache: { type: "ephemeral" } },
            ],
        },
        {
            id: "msg_assistant",
            role: "assistant",
            metadata: { host: true },
            content: [
                {
                    type: "reasoning",
                    text: "Reasoning",
                    encrypted: "signed-reasoning",
                    providerMetadata: { test: { signature: "original" } },
                },
                {
                    type: "tool-call",
                    id: "call_one",
                    name: "read",
                    input: { path: "one" },
                    providerMetadata: { test: { itemId: "fc_original" } },
                },
                { type: "tool-call", id: "call_two", name: "read", input: { path: "two" } },
            ],
        },
        {
            role: "tool",
            content: [
                {
                    type: "tool-result",
                    id: "call_one",
                    name: "read",
                    result: { type: "text", value: "Original output" },
                    providerMetadata: { test: { replay: true } },
                },
                {
                    type: "tool-result",
                    id: "call_two",
                    name: "read",
                    result: {
                        type: "content",
                        value: [
                            { type: "file", uri: "data:image/png;base64,AA==", mime: "image/png" },
                        ],
                    },
                },
            ],
        },
        { id: "msg_latest", role: "user", content: [{ type: "text", text: "Continue" }] },
    ] as Message[]
}

function entries(messages: Message[]) {
    return messages
        .filter((message) => message.id)
        .map((message) => ({
            id: message.id,
            type: message.role,
            time: { created: 1 },
            agent: "build",
            model: session.model,
            content: [],
            text: "",
        })) as Parameters<typeof view>[1]
}

test("V2 projection preserves all native content without edits", () => {
    const messages = transcript()
    assert.deepEqual(view(messages, entries(messages), session).commit(), messages)
})

test("V2 ID injection preserves signatures, media and tool pairing", () => {
    const native = transcript()
    const projected = view(native, entries(native), session)
    const state = createSessionState("compact")
    assignMessageRefs(state, projected.messages)
    injectMessageIds(state, config, projected.messages, new Map())
    const restored = projected.commit()
    assert.deepEqual(restored[0], native[0])
    assert.equal(restored[1]!.content[0], native[1]!.content[0])
    assert.equal(restored[2]!.content[0], native[2]!.content[0])
    assert.equal(restored[3]!.content[1], native[3]!.content[1])
    assert.match(JSON.stringify(restored[3]!.content[0]), /@2@/)
    assert.doesNotMatch(JSON.stringify(restored), /dcp-message-id|m0002/)
    assert.ok(!JSON.stringify(native).includes("@2@"), "native input must not be mutated")
})

test("V2 tool pruning replaces only marked results", () => {
    const native = transcript()
    const projected = view(native, entries(native), session)
    const state = createSessionState("compact")
    state.prune.tools.set("call_one", 100)
    prune(state, logger, config, projected.messages)
    const restored = projected.commit()
    assert.match(JSON.stringify(restored[3]!.content[0]), /Output removed/)
    assert.equal(restored[3]!.content[1], native[3]!.content[1])
    assert.deepEqual(restored[2], native[2])
})

test("V2 compression removes the assistant and its ID-less results together", () => {
    const native = transcript()
    const projected = view(native, entries(native), session)
    const state = createSessionState("compact")
    state.prune.messages.byMessageId.set("msg_assistant", {
        tokenCount: 100,
        allBlockIds: [1],
        activeBlockIds: [1],
    })
    prune(state, logger, config, projected.messages)
    const restored = projected.commit()
    assert.deepEqual(restored, [native[0], native[1], native[4]])
})

test("V2 leaves non-durable plugin messages and checkpoint tool results intact", () => {
    const native = transcript()
    const projected = view(native, [], session)
    assert.equal(projected.messages.length, 0, "unselectable messages must not receive DCP IDs")
    assert.deepEqual(projected.commit(), native)
})

test("V2 does not fabricate a base message for summary injection", () => {
    const native = transcript().filter((message) => message.role !== "user")
    const projected = view(native, entries(native), session)
    const state = createSessionState("compact")
    state.prune.messages.byMessageId.set("msg_assistant", {
        tokenCount: 100,
        allBlockIds: [1],
        activeBlockIds: [1],
    })
    state.prune.messages.activeByAnchorMessageId.set("msg_assistant", 1)
    state.prune.messages.blocksById.set(1, {
        blockId: 1,
        active: true,
        anchorMessageId: "msg_assistant",
        summary: "CHECKPOINT_SUMMARY",
    } as CompressionBlock)
    prune(state, logger, config, projected.messages)
    const restored = projected.commit()
    assert.deepEqual(restored, [native[0]], "no synthetic base message is invented")
})
