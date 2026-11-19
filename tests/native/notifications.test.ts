import assert from "node:assert/strict"
import test from "node:test"
import { notificationEvent, rpc } from "../../lib/native/rpc"
import { createNotifier, createToastSubscriber } from "../../lib/native/notifications"
import { createMockContext } from "./mock-context"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "dcp-native-notifications-"))
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

test("RPC definition exposes the notification event", () => {
    assert.deepEqual(Object.keys(rpc.events), ["notification", "openPanel"])
    assert.deepEqual(
        notificationEvent.parse({
            title: "DCP",
            message: "Compressed 3 messages",
            variant: "success",
            duration: 4000,
            sessionID: "ses_1",
        }),
        {
            title: "DCP",
            message: "Compressed 3 messages",
            variant: "success",
            duration: 4000,
            sessionID: "ses_1",
        },
    )
    assert.throws(() => notificationEvent.parse({ message: "x", variant: "unknown" }))
})

test("notifier turns a toast call into a normalized RPC event", async () => {
    const emitted: unknown[] = []
    const notifier = createNotifier(async (event) => {
        emitted.push(event)
    })
    await notifier.showToast({
        body: { title: "DCP: Prune", message: "Pruned 2 outputs", variant: "weird" },
        sessionID: "ses_1",
    })
    assert.deepEqual(emitted, [
        {
            title: "DCP: Prune",
            message: "Pruned 2 outputs",
            variant: "info",
            duration: 5000,
            sessionID: "ses_1",
        },
    ])
})

test("notifier carries command output as a toast, never a prompt message", async () => {
    const emitted: unknown[] = []
    const notifier = createNotifier(async (event) => {
        emitted.push(event)
    })
    await notifier.prompt({
        path: { id: "ses_1" },
        body: { parts: [{ text: "Context report" }, { text: "42 tokens" }] },
    })
    assert.deepEqual(emitted, [
        {
            title: "DCP",
            message: "Context report\n42 tokens",
            variant: "info",
            duration: 5000,
            sessionID: "ses_1",
        },
    ])
})

test("notifier suppresses duplicate and burst notifications", async () => {
    const emitted: string[] = []
    const notifier = createNotifier(async (event) => {
        emitted.push(event.message)
    })
    await notifier.showToast({ body: { message: "same" }, sessionID: "ses_1" })
    await notifier.showToast({ body: { message: "same" }, sessionID: "ses_1" })
    await notifier.showToast({ body: { message: "other" }, sessionID: "ses_1" })
    for (let i = 0; i < 10; i++)
        await notifier.showToast({ body: { message: `burst ${i}` }, sessionID: "ses_1" })
    assert.deepEqual(emitted, ["same", "other", "burst 0", "burst 1"]) // 4 per window
})

test("toast subscriber shows and deduplicates events", () => {
    const shown: unknown[] = []
    const subscriber = createToastSubscriber({
        show: (toast) => {
            shown.push(toast)
        },
    })
    const event = {
        data: { title: "DCP", message: "Compressed", variant: "success" as const },
    }
    subscriber(event)
    subscriber(event)
    assert.deepEqual(shown, [
        {
            title: "DCP",
            message: "Compressed",
            variant: "success",
            duration: 5000,
            sessionID: undefined,
        },
    ])
})

test("command output emits a notification event through RPC", async () => {
    const mock = createMockContext({ directory: "/tmp" })
    const cleanup = await import("../../lib/native/plugin").then(({ setup }) => setup(mock.ctx))
    const command = mock.commands.find((entry) => entry.name === "dcp")
    assert.ok(command)
    await command.execute({
        sessionID: "ses_1",
        prompt: { text: "help" },
        delivery: "ui",
    })
    assert.ok(mock.rpcEvents.length > 0, "command output emitted a notification")
    assert.equal(mock.rpcEvents[0]!.name, "notification")
    assert.match(String(mock.rpcEvents[0]!.data.message), /DCP/)
    await cleanup?.()
})

test("bare /dcp emits openPanel instead of registering a second slash command", async () => {
    const mock = createMockContext({ directory: "/tmp" })
    const cleanup = await import("../../lib/native/plugin").then(({ setup }) => setup(mock.ctx))
    const command = mock.commands.find((entry) => entry.name === "dcp")
    assert.ok(command)
    await command.execute({
        sessionID: "ses_1",
        prompt: { text: "" },
        delivery: "ui",
    })
    assert.deepEqual(mock.rpcEvents, [{ name: "openPanel", data: { sessionID: "ses_1" } }])
    await cleanup?.()
})
