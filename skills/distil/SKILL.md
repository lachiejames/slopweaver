---
name: distil
description: Distil the corpus into gold markdown — one batch per handoff, composed by you in this session (no model runs in the CLI). Use only when the user explicitly asks to build or extend gold, or asks how much distil work remains. Never reach for it to answer a question — ask never needs gold. Phrases like "distil", "build gold", "how much gold is left to build".
argument-hint: "[status|brief|answer] [--max-per-batch N] [--top-containers N] [--recent-only]"
---

`distil` never calls a model itself (rule 2: no spawned model, anywhere). You — this session — are the
model. The CLI's job is to gather evidence and validate what you write; composing the digest is yours.

**Start with status**, always: `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" distil status $ARGUMENTS`. It reports
total/cached/remaining UNIQUE batches, the next batch's source/container/record-count/prompt-chars/
truncation, and states plainly: **CLI model calls: zero**. Report those numbers to the user before doing
anything else — the point is honesty about scope, not a surprise partway through.

**Then loop, one batch per handoff:**

1. `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" distil brief --out <a scratch path>` — writes the NEXT uncached
   batch's exact prompt to that file and prints it.
2. Read the prompt. Compose a digest from EXACTLY what it shows — no records outside it, none dropped:
   `{"summary": "one sentence", "points": [{"point": "…", "citations": ["url-or-id", …]}, …]}`. Every point
   needs at least one citation or it is silently dropped at validation time.
3. Write that JSON to a scratch file, then:
   `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" distil answer --brief <path from step 1> --answer <path from step 3>`.
   It reloads the brief, proves the corpus still produces the SAME batch (contract, pinned records, content
   hash, and the rendered prompt all checked), validates your digest, and only then updates the cache. An
   invalid digest (no summary, no cited point) is refused and nothing is cached.
4. Repeat from step 1 until `distil brief` reports "nothing to distil" — gold is rewritten automatically the
   moment every unique batch is cached.

**Say this plainly, do not conceal it with a hidden loop:** a cold full corpus can be thousands of batches.
One batch per handoff is not ergonomic for that, and there is deliberately no automatic bulk mode — each batch is a real spend of this session's own turns, and doing that
silently in a loop of hundreds is an undisclosed cost, the reason `distil` itself calls no model. **Ask the user how many batches they actually want distilled in this session** before looping past a
handful, and stop to check in if `distil status` shows the remaining count still climbing into the hundreds.

If `distil brief` reports there is nothing to distil at all (no corpus), point the user to `/slopweaver:refresh`
and `/slopweaver:derive` first. `--accept-prompt-change` is occasionally needed on `distil brief` if the
distil contract changed since the cache was built — `distil status` warns about this; do not pass it
reflexively.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
