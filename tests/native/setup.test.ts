import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createMockContext, sessionEvent } from "./mock-context"

const root = mkdtempSync(join(tmpdir(), "dcp-native-setup-"))
const configHome = join(root, "config")
const dataHome = join(root, "data")
const opencodeDir = join(configHome, "opencode")
mkdirSync(opencodeDir, { recursive: true })
mkdirSync(dataHome, { recursive: true })
process.env.XDG_CONFIG_HOME = configHome
process.env.XDG_DATA_HOME = dataHome
const directory = join(root, "project")
mkdirSync(directory, { recursive: true })

writeFileSync(
    join(opencodeDir, "dcp.jsonc"),
    JSON.stringify({ enabled: true, debug: false, pruneNotification: "off" }),
)

const { setup } = await import("../../lib/native/plugin")

test("setup registers context and compaction hooks", async () => {
    const mock = createMockContext({ directory })
    const cleanup = await setup(mock.ctx)
    assert.equal(typeof cleanup, "function")
    assert.ok(mock.hooks.context, "context hook registered")
    assert.ok(mock.hooks.compaction, "compaction hook registered")
})

test("setup registers a JSON-schema compress tool", async () => {
    const mock = createMockContext({ directory })
    await setup(mock.ctx)
    const compress = mock.tools.find((tool) => tool.name === "compress")
    assert.ok(compress, "compress tool registered")
    assert.equal(compress.options.permission, "compress")
    assert.equal(compress.input.type, "object")
    assert.deepEqual(compress.input.required, ["topic", "content"])
    assert.equal(typeof compress.execute, "function")
})

test("setup registers dcp commands", async () => {
    const mock = createMockContext({ directory })
    await setup(mock.ctx)
    const names = mock.commands.map((command) => command.name)
    assert.ok(names.includes("dcp"), "dcp command registered")
    assert.ok(names.includes("dcp-compress"), "dcp-compress command registered")
})

test("setup registers RPC methods", async () => {
    const mock = createMockContext({ directory })
    await setup(mock.ctx)
    const definition = mock.getRpcDefinition()
    assert.equal(definition.id, "dcp")
    assert.deepEqual(Object.keys(definition.methods).sort(), ["manual", "snapshot", "status"])
})

test("status RPC reports command availability", async () => {
    const mock = createMockContext({ directory })
    await setup(mock.ctx)
    assert.deepEqual(
        await mock.getRpcHandlers().status({}, { signal: new AbortController().signal }),
        {
            enabled: true,
        },
    )
})

test("snapshot RPC returns context and stats for a session", async () => {
    const mock = createMockContext({ directory })
    await setup(mock.ctx)
    const snapshot = await mock
        .getRpcHandlers()
        .snapshot({ sessionID: "ses_1" }, { signal: new AbortController().signal })
    assert.equal(typeof snapshot.manualMode, "boolean")
    assert.equal(typeof snapshot.canCompress, "boolean")
    assert.equal(typeof snapshot.context.total, "number")
    assert.equal(typeof snapshot.stats.sessionTokens, "number")
})

test("manual RPC toggles manual mode", async () => {
    const mock = createMockContext({ directory })
    await setup(mock.ctx)
    const handlers = mock.getRpcHandlers()
    const context = { signal: new AbortController().signal }
    await handlers.manual({ sessionID: "ses_1", enabled: true }, context)
    let snapshot = await handlers.snapshot({ sessionID: "ses_1" }, context)
    assert.equal(snapshot.manualMode, true)
    await handlers.manual({ sessionID: "ses_1", enabled: false }, context)
    snapshot = await handlers.snapshot({ sessionID: "ses_1" }, context)
    assert.equal(snapshot.manualMode, false)
})

test("context hook runs the pipeline without throwing", async () => {
    const mock = createMockContext({ directory })
    await setup(mock.ctx)
    const event = sessionEvent()
    await mock.invoke("context", event)
    assert.ok(event.messages.length >= 2, "messages survive the transform")
    assert.ok(
        event.system.some((part: any) => part.text.includes("context management")),
        "system prompt injected",
    )
})

test("disabled config skips hooks and tools", async () => {
    const disabledDir = join(root, "disabled-project")
    const opencodeDir = join(disabledDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(join(opencodeDir, "dcp.jsonc"), JSON.stringify({ enabled: false }))
    const mock = createMockContext({ directory: disabledDir })
    await setup(mock.ctx)
    assert.equal(Object.keys(mock.hooks).length, 0)
    assert.equal(mock.tools.length, 0)
    assert.equal(mock.commands.length, 0)
    assert.deepEqual(
        await mock.getRpcHandlers().status({}, { signal: new AbortController().signal }),
        { enabled: false },
    )
})
