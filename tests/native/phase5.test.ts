import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "dcp-native-phase5-"))
const configHome = join(root, "config")
const opencodeDir = join(configHome, "opencode")
mkdirSync(opencodeDir, { recursive: true })
mkdirSync(join(root, "data"), { recursive: true })
process.env.XDG_CONFIG_HOME = configHome
process.env.XDG_DATA_HOME = join(root, "data")
writeFileSync(
    join(opencodeDir, "dcp.jsonc"),
    JSON.stringify({ enabled: true, debug: false, pruneNotification: "off" }),
)

const { getConfig } = await import("../../lib/config")
const { Logger } = await import("../../lib/logger")
const { PromptStore } = await import("../../lib/prompts/store")
const { createSessionState } = await import("../../lib/state")
const { injectNativeSystemPrompt } = await import("../../lib/native/system-prompt")
const { executeNativeCommand } = await import("../../lib/native/commands")

const warnings = { tui: { showToast: async () => {} } }

function deps() {
    const logger = new Logger(false)
    const config = getConfig({ directory: root, client: warnings as any })
    const state = createSessionState("compact")
    const prompts = new PromptStore(logger, root, config.experimental.customPrompts, "compact")
    const emitted: any[] = []
    const client = {
        session: {
            messages: async () => ({ data: [] }),
            prompt: async (input: any) => {
                emitted.push(input)
                return {}
            },
        },
        tui: { showToast: async () => {} },
    }
    return { logger, config, state, prompts, client, emitted }
}

test("native system prompt preserves non-text parts and appends to last text part", () => {
    const { logger, config, state, prompts } = deps()
    const system: any[] = [
        { type: "text", text: "base", cache: { type: "ephemeral" }, metadata: { a: 1 } },
        { type: "text", text: "ignored-marker" },
    ]
    injectNativeSystemPrompt(state, logger, config, prompts, system)
    assert.equal(system.length, 2)
    assert.equal(system[0]!.cache?.type, "ephemeral")
    assert.deepEqual(system[0]!.metadata, { a: 1 })
    assert.ok(system[1]!.text.startsWith("ignored-marker\n\n"))
    assert.match(system[1]!.text, /context management/)
})

test("native system prompt skips internal agent calls", () => {
    const { logger, config, state, prompts } = deps()
    const system: any[] = [{ type: "text", text: "You are a title generator" }]
    injectNativeSystemPrompt(state, logger, config, prompts, system)
    assert.equal(system.length, 1)
    assert.equal(system[0]!.text, "You are a title generator")
})

test("native command dispatch toggles manual mode via shared handler", async () => {
    const { logger, config, state, client } = deps()
    const trigger = await executeNativeCommand({
        client,
        state,
        logger,
        config,
        workingDirectory: root,
        sessionID: "ses_1",
        text: "manual on",
        messages: [],
    })
    assert.equal(trigger, null)
    assert.ok(state.manualMode)
})

test("native command dispatch stages a manual compress trigger", async () => {
    const { logger, config, state, client } = deps()
    const trigger = await executeNativeCommand({
        client,
        state,
        logger,
        config,
        workingDirectory: root,
        sessionID: "ses_1",
        text: "compress focus here",
        messages: [],
    })
    assert.ok(trigger, "a trigger prompt is returned")
    assert.equal(state.manualMode, "compress-pending")
    assert.equal(state.pendingManualTrigger?.prompt, trigger)
})
