# Contributing to DCP

Thank you for your interest in improving this plugin.

## Scope

This fork targets **OpenCode 2** exclusively. The OpenCode 1 code path was removed; please do not
reintroduce V1 adapters, shims, or casts that fabricate V1 objects for the OC2 API. New code should
use the native `@opencode/plugin` 2.x APIs.

## License and attribution

The project is licensed under **AGPL-3.0-or-later**. By submitting a change you agree that it is
licensed under the same terms. Keep the upstream attribution to
[Tarquinen/opencode-dynamic-context-pruning](https://github.com/Tarquinen/opencode-dynamic-context-pruning)
in the README and any redistribution. Do not merge code from the upstream author's commercial
products into this repository.

## Development setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

`npm run check:package` runs the build plus tarball verification. Use `npm run sandbox` for an
isolated OpenCode install when testing plugin loading and TUI behavior.

## Pull requests

1. Keep changes focused and explain the user-visible behavior in the description.
2. Add or update tests under `tests/` for behavior changes. The shared compression engine and the
   OC2 wiring are both covered by the Node test runner.
3. All checks must pass: `npm run typecheck`, `npm test`, `npm run build`, `npm run verify:package`.
4. Update `dcp.schema.json`, `dcp.example.jsonc`, and the README together when configuration
   changes. The `example config is valid JSONC and documents every schema option` test enforces
   this.
5. Format with `npm run format` before submitting.

## Reporting bugs

Include your OpenCode version, DCP version, relevant `dcp.jsonc` settings, and a minimal session
that reproduces the issue. Debug logs can be enabled with `"debug": true` in the config.
