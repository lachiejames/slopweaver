---
name: derive
description: Derive deterministic silver (directory + cross-ref graph + opportunities) from the corpus. Use after a refresh, whenever a mention or an owner will not resolve, or when a run reports the derived roster stale or absent. Phrases like "run derive", "rebuild the directory", "the roster is stale", "why can't it resolve that person".
argument-hint: "[--top N]"
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" derive $ARGUMENTS` and report the directory / graph / opportunity summary. This is free and deterministic (no LLM). If it says there's no corpus, tell the user to run `/slopweaver:refresh` first.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
