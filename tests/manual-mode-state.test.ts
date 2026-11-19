import assert from "node:assert/strict"
import test from "node:test"
import { Logger } from "../lib/logger"
import {
    createSessionState,
    refreshManualMode,
    resetSessionState,
    saveManualModeSetting,
} from "../lib/state"

test("persisted manual mode setting refreshes session state", async () => {
    const logger = new Logger(false)
    const sessionId = `manual-mode-${Date.now()}-${Math.random().toString(16).slice(2)}`

    await saveManualModeSetting(sessionId, true, logger)

    const state = createSessionState()
    state.sessionId = sessionId
    state.manualMode = false

    await refreshManualMode(state, sessionId, logger, false)
    assert.equal(state.manualMode, "active")

    await saveManualModeSetting(sessionId, false, logger)
    await refreshManualMode(state, sessionId, logger, true)
    assert.equal(state.manualMode, false)
})

test("resetSessionState clears compression timing", () => {
    const state = createSessionState()
    state.compressionTiming.startsByCallId.set("message-1:call-1", 100)
    state.compressionTiming.pendingByCallId.set("message-1:call-2", "queued" as never)

    resetSessionState(state)

    assert.equal(state.compressionTiming.startsByCallId.size, 0)
    assert.equal(state.compressionTiming.pendingByCallId.size, 0)
})
