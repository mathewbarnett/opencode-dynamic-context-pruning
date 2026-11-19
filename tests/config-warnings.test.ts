import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const configHome = join(tmpdir(), `dcp-config-warnings-${process.pid}`)
mkdirSync(join(configHome, "opencode"), { recursive: true })
process.env.XDG_CONFIG_HOME = configHome
writeFileSync(
    join(configHome, "opencode", "dcp.jsonc"),
    JSON.stringify({ unknownKey: true, compress: { nudgeForce: "loud" } }),
)

const { getConfig } = await import("../lib/config")

test("config warnings are delivered synchronously to the client", () => {
    const toasts: Array<{ title?: string; message: string; variant?: string }> = []
    getConfig({
        directory: "/tmp",
        client: {
            tui: {
                showToast: (input) => {
                    toasts.push(input.body)
                },
            },
        },
    })

    assert.equal(toasts.length, 1)
    assert.match(toasts[0]!.title ?? "", /warning/)
    assert.match(toasts[0]!.message, /unknownKey/)
    assert.match(toasts[0]!.message, /nudgeForce/)
})

test("parse errors are reported through the same channel", () => {
    // Replace the config with malformed JSONC before reloading via cache bust.
    writeFileSync(join(configHome, "opencode", "dcp.jsonc"), "{ this is not json")
    const toasts: Array<{ title?: string; message: string; variant?: string }> = []
    getConfig({
        directory: "/tmp",
        client: {
            tui: {
                showToast: (input) => {
                    toasts.push(input.body)
                },
            },
        },
    })

    assert.ok(toasts.length >= 1)
    assert.match(toasts[0]!.title ?? "", /Invalid config/)
})
