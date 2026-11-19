import assert from "node:assert/strict"
import test from "node:test"
import { rpc } from "../../lib/native/rpc"

test("rpc definition uses the dcp namespace", () => {
    assert.equal(rpc.id, "dcp")
    assert.deepEqual(Object.keys(rpc.methods).sort(), ["manual", "snapshot", "status"])
    assert.deepEqual(Object.keys(rpc.events), ["notification", "openPanel"])
})

test("status method schemas validate their payloads", () => {
    assert.deepEqual(rpc.methods.status.input.parse({}), {})
    assert.deepEqual(rpc.methods.status.output.parse({ enabled: true }), { enabled: true })
    assert.throws(() => rpc.methods.status.output.parse({ enabled: "yes" }))
})

test("snapshot input requires a session ID", () => {
    assert.deepEqual(rpc.methods.snapshot.input.parse({ sessionID: "ses_1" }), {
        sessionID: "ses_1",
    })
    assert.throws(() => rpc.methods.snapshot.input.parse({}))
})

test("snapshot output allows an optional blocked reason", () => {
    const base = {
        manualMode: false,
        canCompress: true,
        context: {
            system: 0,
            user: 0,
            assistant: 0,
            tools: 0,
            toolCount: 0,
            toolsInContextCount: 0,
            prunedTokens: 0,
            prunedToolCount: 0,
            prunedMessageCount: 0,
            total: 0,
        },
        stats: {
            sessionTokens: 0,
            sessionSummaryTokens: 0,
            sessionDurationMs: 0,
            sessionTools: 0,
            sessionMessages: 0,
            allTime: {
                totalTokens: 0,
                totalTools: 0,
                totalMessages: 0,
                sessionCount: 0,
            },
        },
    }
    assert.deepEqual(rpc.methods.snapshot.output.parse(base), base)
    assert.deepEqual(
        rpc.methods.snapshot.output.parse({ ...base, blockedReason: "not supported" })
            .blockedReason,
        "not supported",
    )
})

test("manual method schemas validate their payloads", () => {
    assert.deepEqual(rpc.methods.manual.input.parse({ sessionID: "ses_1", enabled: true }), {
        sessionID: "ses_1",
        enabled: true,
    })
    assert.throws(() => rpc.methods.manual.input.parse({ sessionID: "ses_1" }))
    assert.deepEqual(rpc.methods.manual.output.parse({}), {})
})
