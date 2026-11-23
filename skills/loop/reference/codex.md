# Running the loop from Codex

Bundled reference for the `loop` skill. Loaded when the body links here, not on every turn.

**Codex is a SUBSTITUTE host, not a degraded one** — it is allowed to use subagents, because the guiding
principle is giving agents maximum capability. Every tier the Claude host can drive, this host drives, subagents and
`fresh-visible-session` dispatch included, so a Claude outage or a spent weekly limit changes nothing about
what this loop can do. The one limit is AGENTS.md rule 2, unchanged and applying to every model alike: no
hidden executor, nothing headless, nothing detached. Where a tier is refused below it is refused **by mode**,
identically on both hosts — never because this host is Codex.

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` in the skill body is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.

```bash
<plugin-root>/bin/slopweaver listen --follow --emit --json \
  --queue "${SLOPWEAVER_HOME:-$HOME/.slopweaver}/live/slack/queue.jsonl"
```

Run it in the foreground; it must inherit `CODEX_THREAD_ID`. It stays connected and prints one JSON object
per line, one per admitted mention, for as long as it runs. Poll it often enough to keep the owner informed
without detaching it. **Never wait for one line's turn to finish before reading the next one** — that is the
entire point of `--follow`.

**Never redirect stderr into stdout (no `2>&1`), and read only stdout.** Progress narration — every Socket
Mode frame this sees, including discarded ones (pings, reconnect frames, anything not an `events_api`
frame) — is deliberately on stderr so stdout stays pure JSONL. Merging the two defeats that: Slack's socket
produces frame-level chatter far more often than the bot is actually addressed, so a watcher armed on every
merged line wakes on that chatter — a measured failure mode, burning a whole turn every few seconds to
narrate a raw protocol frame as if it mattered. Watch stdout alone.

1. `slopweaver turn brief --channel <c> --message-ts <ts> --thread-ts <tts> --user <u> --surface <s> \
--text "<text>" --mode continuous-drain --host codex [--turn-id <id> --working-ts <ts>]` — preserving
   every field the emitted line carried, `started` included when present.
2. **Judge.** Compose one `RoutingDecision` JSON exactly as the skill body's "Routing judgement" section describes — the same
   agent-judgement reasoning, never a keyword-matched filter, and never invented in this file a second time.
3. `slopweaver turn dispatch --brief <path> --decision <path>`, then follow what it prints for the tier:
   - **`no-response`** / **`for-a-human`** — nothing further. Read the next line.
   - **`fresh-visible-session`** — the default for anything needing research. `turn dispatch` opens a real,
     watched cmux workspace for a worker (booting `codex --no-alt-screen` when this host is Codex, under a
     `CODEX_HOME=` prefix naming the destination the register's own ranking picked — `src/cmux/seatRoute.ts`;
     the decision's `"model"` pin applies to the Claude boot line only, a Codex seat taking the repository's
     own `CODEX_MODEL` pin instead, with the ChatGPT app's browser tools switched off —
     [browser route](../../../docs/browser-route.md#the-rule)) and returns immediately once it has
     booted. The worker owns the ask to its terminal outcome — it reviews and posts itself. Read the next
     line right away; do not wait on that workspace's work finishing.
   - **`inline`** — the trivial-ack carve-out only: compose from context and judgement alone, `turn review
--brief --decision --answer` then `--poll`, then `turn answer --brief --decision --answer --verdict`.
     Read the next line.
   - **`read-only-subagent`** — **refused outright in `continuous-drain` mode**, the same as for Claude Code:
     a native subagent call (Codex's own, exactly like Claude's Agent tool) blocks this thread for its whole
     investigation, and this loop must never stop reading the stream. `turn dispatch` refuses this tier
     before any subagent starts. Re-judge as `inline` or `fresh-visible-session`.
4. Report the turn in one or two lines and return to step 1 until the owner interrupts or a blocker requires
   their authority.

`slopweaver turn dispatch --sweep` at startup, on every idle poll with nothing new to read, and after every
dispatched or terminal turn — `ready`/still-working/`worker-failed`/`phantom`/`lease-expired` per dispatched
ask, never relaunching. A `ready` is the worker's own to post; re-judge a `phantom`.

The listener captures the same way regardless of host: it appends the `captured` ask-lifecycle event, then
the queue file, before either Slack UI effect — see the skill body's own header on this. With no
listener process running at all, an addressed message is a genuine no-op. A separate `--follow --queue`
capture-only listener may still acknowledge and durably queue it while this thread is elsewhere in a
`fresh-visible-session` turn, but no answer happens until a visible session deliberately reads that queue.

For an unlisted tagger, do no operational work — the responder whitelist gate runs before this stream ever
prints a mention for it, and you will never see that line at all. A listed non-owner's ask goes through the
tag decision tree `turn brief` prints, exactly as on the Claude host. On a broken turn, record the failure with
`slopweaver turn breakage` (its `--cause` is required; see "Keep going. Log what breaks." in the skill body) and continue unless credentials or
authorisation make further progress impossible.
