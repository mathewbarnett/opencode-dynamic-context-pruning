import assert from "node:assert/strict"
import test from "node:test"
import { history } from "../../lib/native/messages"

const session = {
    id: "ses_1",
    agent: "build",
    model: { providerID: "anthropic", id: "claude-sonnet-4", variant: undefined },
    parentID: null,
}

const entries: any[] = [
    { id: "msg_u1", type: "user", time: { created: 1000 }, text: "hello", skills: [] },
    {
        id: "msg_u2",
        type: "user",
        time: { created: 1500 },
        text: "second",
        skills: [{ text: "skill context" }],
    },
    {
        id: "msg_a1",
        type: "assistant",
        time: { created: 2000 },
        agent: "build",
        model: { providerID: "anthropic", id: "claude-sonnet-4" },
        tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        content: [
            { type: "text", text: "working" },
            {
                type: "tool",
                id: "call_1",
                name: "bash",
                input: { command: "ls" },
                state: {
                    status: "completed",
                    content: [{ type: "text", text: "file.ts" }],
                },
            },
        ],
    },
    { id: "msg_s1", type: "synthetic", time: { created: 3000 }, text: "a synthetic note" },
    {
        id: "msg_l1",
        type: "location-switched",
        time: { created: 4000 },
        location: { directory: "/tmp/project" },
    },
    {
        id: "msg_sh1",
        type: "shell",
        time: { created: 5000 },
        command: "echo hi",
        output: { output: "hi" },
        metadata: {},
    },
    {
        id: "msg_sh2",
        type: "shell",
        time: { created: 5500 },
        command: "npm run watch",
        output: { output: "" },
        metadata: { background: true },
    },
    { id: "msg_c1", type: "compaction", time: { created: 6000 }, status: "pending" },
    { id: "msg_c2", type: "compaction", time: { created: 7000 }, status: "completed" },
]

test("history projects session entries into engine messages", () => {
    const messages = history(entries as any, session as any)
    assert.deepEqual(
        messages.map((message) => message.info.id),
        ["msg_u1", "msg_u2", "msg_a1", "msg_s1", "msg_l1", "msg_sh1", "msg_c2"],
    )
})

test("history joins user skill context with user text", () => {
    const messages = history(entries as any, session as any)
    assert.equal(messages[1]!.info.role, "user")
    assert.equal(messages[1]!.parts[0]!.text, "skill context\n\nsecond")
})

test("history expands assistant tool calls into tool parts with output", () => {
    const messages = history(entries as any, session as any)
    const assistant = messages[2]!
    assert.equal(assistant.info.role, "assistant")
    assert.equal(assistant.parts[0]!.type, "step-start")
    assert.equal(assistant.parts[1]!.text, "working")
    const tool = assistant.parts[2]!
    assert.equal(tool.type, "tool")
    assert.equal(tool.tool, "bash")
    assert.equal(tool.callID, "call_1")
    assert.equal(tool.state.status, "completed")
    assert.equal(tool.state.output, "file.ts")
})

test("history fills info fields from the assistant entry and session", () => {
    const messages = history(entries as any, session as any)
    const assistant = messages[2]!.info
    assert.equal(assistant.sessionID, "ses_1")
    assert.equal(assistant.time.created, 2000)
    assert.equal(assistant.agent, "build")
    assert.equal(assistant.model.providerID, "anthropic")
    assert.equal(assistant.model.modelID, "claude-sonnet-4")
    assert.equal(assistant.tokens.input, 10)
    assert.equal(assistant.tokens.output, 5)
})

test("history renders location switches and foreground shell commands as user text", () => {
    const messages = history(entries as any, session as any)
    assert.match(messages[4]!.parts[0]!.text, /\/tmp\/project/)
    assert.match(messages[5]!.parts[0]!.text, /echo hi/)
})

test("history ignores background shells and incomplete compactions", () => {
    const ids = history(entries as any, session as any).map((message) => message.info.id)
    assert.ok(!ids.includes("msg_sh2"), "background shell ignored")
    assert.ok(!ids.includes("msg_c1"), "pending compaction ignored")
})

test("history marks completed compactions as summary messages", () => {
    const messages = history(entries as any, session as any)
    const summary = messages[6]!
    assert.equal(summary.info.id, "msg_c2")
    assert.equal(summary.info.role, "assistant")
    assert.equal(summary.info.summary, true)
    assert.equal(summary.parts.length, 0)
})
