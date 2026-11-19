# Changelog

## 4.0.0

- Native OpenCode 2 plugin: new `lib/native` entrypoints for plugin setup, message projection,
  RPC, permissions, commands, notifications, system prompt, and TUI. OpenCode 1 is no longer
  supported.
- Removed the upstream V1 compatibility layer, npm auto-update, and in-session notification
  injection; notifications are now toasts.
- Config warnings (unknown keys, type errors, malformed JSONC) are delivered as toasts when the
  plugin loads, and malformed config files are rejected instead of partially merged.
- `/dcp` panel-open events are scoped to the invoking session so other open sessions are unaffected.
- Debug context snapshots are capped at 10 per session.
- Removed runtime-dead V1 hook and host-permission modules and their tests.
