# Dynamic Context Pruning (OpenCode 2)

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

An [OpenCode](https://opencode.ai) 2 plugin that reduces token usage by pruning obsolete tool
output, compressing conversation spans into summaries, and nudging the model to compress when
context grows large.

This is a fork of [Tarquinen/opencode-dynamic-context-pruning](https://github.com/Tarquinen/opencode-dynamic-context-pruning).
The upstream project left an incomplete OpenCode 2 compatibility layer in place while its
author moved active development to a commercial product. This fork keeps the AGPL-3.0 licensed
core and implements native OpenCode 2 support instead of the compatibility shim. **OpenCode 1 is
not supported.**

## Installation

Requires OpenCode 2.3.x or newer.

```bash
opencode plugin add @mbarnett/opencode-dcp@latest
```

For a local build, run `npm install && npm run build`, then add the directory to your config:

```jsonc
{
    "$schema": "https://opencode.ai/config.json",
    "plugins": ["/absolute/path/to/opencode-dynamic-context-pruning"],
}
```

## What it does

- **Automatic pruning strategies** remove stale tool output (`deduplication`) and inputs of old
  failed calls (`purgeErrors`) as the conversation grows.
- **Compression** turns selected messages or ranges into compact summaries. The model is nudged
  to call the `compress` tool when context crosses configurable thresholds.
- **Commands** (`/dcp`, `/dcp-compress`) provide manual control, context/stats reports, sweep,
  manual mode, and decompress/recompress.
- **TUI panel** shows context stats and manual-mode controls; bind it with the `DCP` command.

## Configuration

Settings are read from, in increasing priority:

1. `~/.config/opencode/dcp.jsonc` (or `dcp.json`)
2. `$OPENCODE_CONFIG_DIR/dcp.jsonc`
3. `<project>/.opencode/dcp.jsonc`

Copy [`dcp.example.jsonc`](dcp.example.jsonc) to one of those paths to customize. The full set of
options is documented in [`dcp.schema.json`](dcp.schema.json). Protected-tool lists are additive
across layers.

`dcp.jsonc` is read once when the plugin loads — reload OpenCode (or restart the plugin) to apply
edits. Project config resolution walks up from the working directory to the nearest `.opencode`
directory, so a nested project can inherit a parent's `dcp.jsonc`. Unknown keys, type errors and
malformed JSONC are reported as toasts at load time, and a malformed file is ignored rather than
partially applied.

Notable settings:

| Setting                            | Default      | Meaning                                                                 |
| ---------------------------------- | ------------ | ----------------------------------------------------------------------- |
| `enabled`                          | `true`       | Enable the plugin.                                                      |
| `compress.mode`                    | `"range"`    | `"range"` summarizes spans; `"message"` summarizes individual messages. |
| `compress.permission`              | `"allow"`    | `"allow"`, `"ask"`, or `"deny"`.                                        |
| `compress.maxContextLimit`         | `100000`     | Upper nudge threshold (tokens or `"75%"` of the context window).        |
| `compress.minContextLimit`         | `50000`      | Lower threshold below which reminders are suppressed.                   |
| `pruneNotification`                | `"detailed"` | `"off"`, `"minimal"`, or `"detailed"`.                                  |
| `manualMode.enabled`               | `false`      | Start sessions in manual mode.                                          |
| `strategies.deduplication.enabled` | `true`       | Prune duplicate tool outputs.                                           |
| `strategies.purgeErrors.enabled`   | `true`       | Prune inputs of old failed calls.                                       |

## Notifications

Notifications are delivered as toasts. The V1 option `pruneNotificationType` has been removed;
there is no invisible in-session notification under OpenCode 2's public plugin API. The V1
`autoUpdate` option was also removed — updates are managed by OpenCode's plugin installer.

Opening the panel with bare `/dcp` is scoped to the session that invoked it; other open sessions
are left alone.

## Limitations

- **OpenCode 1 is not supported** — this is a native OpenCode 2 plugin with no compatibility shim.
- Internal title/summarizer sub-agents are detected by system-prompt signature (OpenCode 2 hook
  events do not expose a request-kind field); a host that changes those signatures may need the
  signature list updated.
- Model context windows are read from OpenCode's registered model catalogue; models added after
  startup are detected on the next request.
- `permission: "ask"` uses OpenCode's native permission prompt; it requires an interactive session
  to approve.
- Token counts used for nudge thresholds and context reports come from an Anthropic tokenizer for
  every provider. Treat them as approximations for non-Anthropic models; reported session usage
  from the host is used directly where available.
- Debug logging (`"debug": true`) writes full message and tool text to
  `~/.config/opencode/logs/dcp/context/<session>/`. Snapshots are capped at 10 per session, but
  they can contain sensitive data — avoid enabling it in shared environments.

## Compatibility

| OpenCode | Status                         |
| -------- | ------------------------------ |
| 2.3.x+   | Supported (native plugin APIs) |
| 2.0–2.2  | Not tested                     |
| 1.x      | Not supported                  |

This fork deliberately diverges from the upstream/commercial continuation: it targets OpenCode 2
natively, drops the V1 adapter and npm auto-update, and stays AGPL-3.0-or-later. See
[`CHANGELOG.md`](CHANGELOG.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Local data

- Pruning state: `$XDG_DATA_HOME/opencode/storage/plugin/dcp/<session>.json` (default
  `~/.local/share/opencode/...`).
- Debug logs and context snapshots: `$XDG_CONFIG_HOME/opencode/logs/dcp/` (default
  `~/.config/opencode/...`).
- The plugin does not transmit data anywhere itself.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run check:package
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution policy and [`scripts/README.md`](scripts/README.md)
for the diagnostic CLI tooling.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Upstream attribution to
Tarquinen/opencode-dynamic-context-pruning is retained.
