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
there is no invisible in-session notification under OpenCode 2's public plugin API.

## Limitations

- **OpenCode 1 is not supported** — this is a native OpenCode 2 plugin with no compatibility shim.
- Internal title/summarizer sub-agents are detected by system-prompt signature (OpenCode 2 hook
  events do not expose a request-kind field); a host that changes those signatures may need the
  signature list updated.
- Model context windows are read from OpenCode's registered model catalogue; models added after
  startup are detected on the next request.
- `permission: "ask"` uses OpenCode's native permission prompt; it requires an interactive session
  to approve.

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

AGPL-3.0-or-later. See [LICENSE](LICENSE). Upstream attribution to Tarquinen/opencode-dynamic-context-pruning
is retained.
