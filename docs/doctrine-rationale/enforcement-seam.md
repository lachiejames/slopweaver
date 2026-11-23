# Where enforcement goes — a gate in the command, a bounded hook, never a gauge the subject pulls

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

Whenever the owner asks to make something "harder to get wrong", the first decision is the SEAM: where the
rule sits decides whether it binds anything. Two findings settle it, and every gate and hook in this
repository is built on both.

## A gauge the degraded party chooses to consult enforces nothing

The gap in a self-monitoring rule is never the measurement. It is that the party being measured decides
whether to look. MEASURED on one supervisor session:
`slopweaver session depth` reported `respawn-candidate self` about that session six times, from 305k tokens
to 482k over about two hours. Then it stopped running the gauge and kept going for another **8h42m and ~520
turns**, ending at **988,396 tokens**. The last reading landed five minutes before it crossed 500k, with 516
of its 744 turns still to run. Reproduce the curve on any transcript:

```bash
jq -r 'select(.message.usage) | [.timestamp, (.message.usage | (.input_tokens//0)+(.cache_read_input_tokens//0)+(.cache_creation_input_tokens//0))] | @tsv' <transcript.jsonl>
```

A refusal inside a verb, a clause in a sweep contract, and prose the session re-reads all bind only a session
that still chooses to run them, and this one ran the gauge zero times over its last nine hours. **Only
something that fires on the party's own actions, unasked, is a mechanism.** So before proposing a louder
gauge, a stricter doc or a verb-side check, ask: _would this have fired on that session?_ If the answer needs the
subject to choose to run something, it is not enforcement. The `session-depth-warning` check is that answer
for depth: it rides every `Bash` call past the line ([hooks](../hooks/session-guards.md)).

## A blocking hook is allowed when it is bounded and self-disarming

The owner's ruling, reversing a recommendation that hooks stay read-only: **keep the blocking
hook, and author it well.** The danger is not blocking. It is UNBOUNDED blocking — stale state plus a refusal
is a session that cannot be ended, and it presents as inexplicable agent behaviour rather than as "a hook
stopped you".

**Prefer a gate inside a command people deliberately run.** `handover finish` refusing a partial run has real
teeth and has never trapped anyone, and the `SLOPWEAVER_ALLOW_UNREVIEWED` escape makes it a judgement rather
than a wall. A hook is the right tool only when the rule must survive something no command can see — a
session quietly ending mid-run, or a compaction erasing the rules that governed it. The durability is the
reason: a file on disk, and a hook or always-on instructions the harness re-injects, survive a compaction;
prose in a skill does not.

When only a hook will do, every one of these closes a specific way it becomes a trap:

- **Inert by default** — no recorded state, no effect at all.
- **Fails OPEN on any internal error** — a crashing gate that blocks is the worst object in the design.
- **Bounded by the harness's own signal**, never a private counter — see below.
- **Staleness disarms it** — a ledger naming a branch or worktree that no longer exists is reported, never
  refused on.
- **It blocks only on state it can resolve UNAMBIGUOUSLY.** Found by an adversarial Codex pass and
  reproduced: a gate blocked on a run whose slug two docs claimed, resolved first-match, while every escape
  verb its refusal named refused that same duplicate — three advertised exits, all failing, every turn.
  Anything ambiguous is reported and let through.
- **Every message names the hook and the exact escape**, and the entry is project-scoped with a timeout
  ([the registered set](../hooks/registered-and-bounded.md)).
- **Its stdin reader is injected**, or fail-open cannot be tested at all.

`src/handover/hookGate.ts`'s header is the worked example of all of them, and it states the honest limit: a
hook puts the rule in front of the model every cycle; it cannot make the model reason correctly.

### What the harness gives a hook

MEASURED by reading the Claude Code binary's own embedded schemas and docs
(`~/.local/share/claude/versions/<v>`), which is the authority rather than the published docs:

- **`PostCompact` exists and fires at the moment context is lost**, so a compaction is observable and the
  re-injection belongs there, not in a `SessionStart` nudge. `Stop` and `PreCompact` exist too.
- **The bound on consecutive blocks is native.** A `Stop` payload carries `stop_hook_active`, true once a hook
  has blocked this turn, and the contract is to succeed while it is; the harness also ends the turn after
  `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (default 8) consecutive blocks. A private counter can desync from what the
  harness believes; its own signal cannot.
- **The output contract**: `{"decision":"block","reason":"…"}` refuses, and
  `{"hookSpecificOutput":{"hookEventName":"…","additionalContext":"…"}}` injects context. For a `Stop` hook a
  non-zero exit is ITSELF a block, so a fail-open `Stop` hook always exits 0 and writes nothing to stderr.
- **`Stop` fires on clear, resume and compact**, far more often than "the agent gave up", which is why the
  bound matters.
