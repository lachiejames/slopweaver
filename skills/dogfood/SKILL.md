---
name: dogfood
description: Reload and dogfood this Slopweaver checkout inside the current visible Claude Code session. Use when developing Slopweaver through `claude --plugin-dir`, after changing plugin skills, commands, hooks, MCP configuration, or the manifest.
---

# Dogfood the live Claude plugin checkout

This workflow is for a visible Claude Code session launched with `claude --plugin-dir <this-checkout>`. It never
starts another model process and it never treats an installed marketplace cache as the editable source.

## Prove the source before editing

1. Resolve `${CLAUDE_PLUGIN_ROOT}` and require it to be this checkout. If it is absent or points under Claude's
   installed plugin cache, stop and relaunch Claude Code with `--plugin-dir` for the intended checkout.
2. Run `${CLAUDE_PLUGIN_ROOT}/bin/slopweaver doctor --json`.
3. Require `pluginRoot` to equal `${CLAUDE_PLUGIN_ROOT}`, `statuses.pluginLoad` to be `plugin-dir`, and
   `statuses.pluginHooks` to be `present`. Do not claim hook trust from that file check.
4. Run the relevant focused validation before changing anything, so the baseline is measured.

## Edit, validate, reload

Make the requested source change in this checkout, then run the relevant focused tests and the repository gate.
If any plugin-discovered surface changed—`skills/`, `hooks/`, `.mcp.json`, or either plugin
manifest—publish this exact checkpoint and stop:

> Run `/reload-plugins` now, then invoke `/slopweaver:dogfood` again. Claude Code owns plugin reload; the plugin
> cannot honestly certify or trigger that host action from inside its own command.

Do not continue on the assumption that files on disk are already active. `/reload-plugins` reloads development
plugins in the current Claude Code session; marketplace installs remain versioned cached copies and require the
normal update/install path.

## Proof after reload

On the next invocation:

1. Re-run the absolute `doctor --json` and re-check the exact root and plugin-owned surface.
2. Exercise the changed slash command or skill through its real Claude surface, not only through the CLI.
3. For continuity changes, test the four routes with temporary journals: Claude→Claude, Codex→Codex,
   Claude→Codex, and Codex→Claude. Use `handover release` then `handover claim`; a live or unknown takeover must
   refuse unless the owner explicitly supplies `--force --why`.
4. Report source root, manifest version, reload boundary, commands exercised, validation, and any proof that
   still depends on the host or owner.

Never invoke Claude, Codex, Linear, or a ship-family workflow from this command.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
