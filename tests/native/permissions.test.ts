import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createMockContext } from "./mock-context"

const root = mkdtempSync(join(tmpdir(), "dcp-native-perms-"))
const configHome = join(root, "config")
const dataHome = join(root, "data")
const directory = join(root, "project")
const opencodeDir = join(configHome, "opencode")
for (const dir of [configHome, opencodeDir, dataHome, directory])
    mkdirSync(dir, { recursive: true })
process.env.XDG_CONFIG_HOME = configHome
process.env.XDG_DATA_HOME = dataHome
const configPath = join(opencodeDir, "dcp.jsonc")

function writeConfig(config: Record<string, unknown>) {
    writeFileSync(configPath, JSON.stringify({ enabled: true, debug: false, ...config }))
}

const { setup } = await import("../../lib/native/plugin")
const { applyCompressEvaluation, resolveCompressPermission } =
    await import("../../lib/native/permissions")

async function snapshot(options: Parameters<typeof createMockContext>[0]) {
    const mock = createMockContext(options)
    await setup(mock.ctx)
    const result = await mock
        .getRpcHandlers()
        .snapshot({ sessionID: "ses_1" }, { signal: new AbortController().signal })
    return { mock, result }
}

test("compression is allowed by default", async () => {
    writeConfig({ compress: { permission: "allow" } })
    const { mock, result } = await snapshot({ directory })
    assert.equal(result.canCompress, true)
    assert.equal(result.blockedReason, undefined)
    assert.ok(mock.tools.some((tool) => tool.name === "compress"))
})

test("an agent deny rule disables compression", async () => {
    writeConfig({ compress: { permission: "allow" } })
    const { mock, result } = await snapshot({
        directory,
        agent: {
            id: "build",
            permissions: [{ action: "compress", resource: "*", effect: "deny" }],
        },
    })
    assert.equal(result.canCompress, false)
    assert.ok(
        mock.tools.some((tool) => tool.name === "compress"),
        "tool is registered but gated at execution time",
    )
})

test("a session deny rule disables compression", async () => {
    writeConfig({ compress: { permission: "allow" } })
    const { result } = await snapshot({
        directory,
        session: {
            id: "ses_1",
            agent: "build",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            parentID: null,
            permissions: [{ action: "compress", resource: "*", effect: "deny" }],
        },
    })
    assert.equal(result.canCompress, false)
})

test("a later explicit allow overrides an earlier deny", async () => {
    writeConfig({ compress: { permission: "allow" } })
    const { result } = await snapshot({
        directory,
        agent: {
            id: "build",
            permissions: [
                { action: "compress", resource: "*", effect: "deny" },
                { action: "compress", resource: "*", effect: "allow" },
            ],
        },
    })
    assert.equal(result.canCompress, true)
})

test("config deny disables compression and removes the tool", async () => {
    writeConfig({ compress: { permission: "deny" } })
    const { mock, result } = await snapshot({ directory })
    assert.equal(result.canCompress, false)
    assert.ok(!mock.tools.some((tool) => tool.name === "compress"))
})

test("config ask is approval-gated instead of unsupported", async () => {
    writeConfig({ compress: { permission: "ask" } })
    const { mock, result } = await snapshot({ directory })
    assert.equal(result.canCompress, true)
    assert.match(result.blockedReason ?? "", /approval/)
    assert.ok(mock.permissionHooks.evaluate, "native evaluate hook registered")
})

test("subagents are blocked unless enabled", async () => {
    writeConfig({ compress: { permission: "allow" } })
    const { result } = await snapshot({
        directory,
        session: {
            id: "ses_sub",
            parentID: "ses_1",
            agent: "build",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            permissions: [],
        },
    })
    assert.equal(result.canCompress, false)
})

test("native resolver: config deny wins over host allow", () => {
    assert.deepEqual(
        resolveCompressPermission(
            "deny",
            [{ action: "compress", resource: "*", effect: "allow" }],
            [],
        ),
        { effect: "deny", source: "config" },
    )
})

test("native resolver: later session rule overrides agent rule", () => {
    assert.equal(
        resolveCompressPermission(
            "allow",
            [{ action: "compress", resource: "*", effect: "deny" }],
            [{ action: "compress", resource: "*", effect: "allow" }],
        ).effect,
        "allow",
    )
})

test("native resolver: resource-specific rules do not gate the whole tool", () => {
    assert.equal(
        resolveCompressPermission("allow", [
            { action: "compress", resource: "/tmp/*", effect: "deny" },
        ]).effect,
        "allow",
    )
})

test("native resolver: host deny overrides config ask", () => {
    assert.equal(
        resolveCompressPermission("ask", [{ action: "c?mpress", resource: "*", effect: "deny" }])
            .effect,
        "deny",
    )
})

test("evaluate hook applies config ask to native evaluations", () => {
    const evaluation: any = { action: "compress", effect: "allow" }
    applyCompressEvaluation("ask", evaluation)
    assert.equal(evaluation.effect, "ask")
    const other: any = { action: "read", effect: "allow" }
    applyCompressEvaluation("deny", other)
    assert.equal(other.effect, "allow")
})

test("compress tool calls native permission assert before running", async () => {
    writeConfig({ compress: { permission: "ask" } })
    const mock = createMockContext({ directory })
    await setup(mock.ctx)
    const tool = mock.tools.find((item: any) => item.name === "compress")
    assert.ok(tool)
    try {
        await tool.execute(
            { topic: "topic", content: "content" },
            {
                sessionID: "ses_1",
                messageID: "msg_9",
                id: "call_1",
                agent: "build",
                progress: async () => {},
            },
        )
    } catch {
        // The mock host cannot run a full compression; the assert still must have happened.
    }
    assert.equal(mock.permissionAsserts.length, 1)
    assert.equal(mock.permissionAsserts[0].action, "compress")
    assert.equal(mock.permissionAsserts[0].source.id, "call_1")
})
