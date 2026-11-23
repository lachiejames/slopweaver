# The standing sessions — alive, and on which commit

Bundled reference for the `supervisor` skill. Loaded when § 1 links here, not on every turn.

`slopweaver session standing --loop-session-key <today-s-loop-slug> --json` answers both halves at once, and
**exits 3 for a session that is not live, is `stale`, or could not be measured** — so
`slopweaver session standing --loop-session-key <key> || <act on it>` is the whole check in one line.

## Liveness

- **The Slack loop** (`skills/loop/SKILL.md`) — `loop.live` comes from the listener's own ARM RECORD and
  heartbeat, never from the session ledger. Measured: two `spawned` rows for one loop slug and a
  single `closed` row carrying no workspace collapsed the pair in the ledger's fold, so `session standing`
  read the loop dark for a whole day while `listen status` read it healthy, its arm beating. A `closed` event carries the workspace ref it closes (`src/sessions/session.ts`, the field `cmux
close` resolves before it appends), so a duplicate spawn's own close targets only its own row. A `closed`
  event with no workspace closes every row under its key, which is why liveness stays read from the arm
  record rather than the fold. The `--loop-session-key` is ATTRIBUTION (which slug, which
  worktree, and the cwd that finds its cmux workspace); omit it and the loop is still measured, minus its
  plugin-dir half.
- **The credential keep-alive** — the same call's `keepAlive` half, RECONCILED: the record `claude watch`
  stamps each tick names one run, and one process-table snapshot names every running watch. `watching` = the
  recorded pid runs `claude watch` from the recorded checkout (compared on disk) with a tick inside two intervals (floor five
  minutes); `unrecorded` = a watch is running that the record does not name — also live. `candidates` lists
  every running watch, the record's first; `duplicates` every second writer, which **exits 3 even when live**;
  `queued` every `--wait` successor; `unmeasured` is an unreadable table, never absence. Freshness grades every
  candidate's checkout, worst wins. **Absent means `candidates` is empty** — never `live: false`, which a
  running but `ticks-stopped` watch also reads. Its `why` goes in the fold verbatim. Measured: a
  second watch took the record and was killed, and a record-only read said NOT running while the first ticked.
  **Why graded at all**: nothing was running it once; three plans expired eight hours after their
  sign-ins and `cmux spawn` refused the successor supervisor.
- **The supervisor has NO liveness half, deliberately.** Whether the owner's single intake chat is open is the owner's call,
  not a fault this gauge reports — and the session running the check is usually that chat, so the answer would
  be either self-evident or a false alarm. Its freshness is graded; its liveness is not. **Its MODEL is read every
  call** (`supervisor.chair`): a pinned session whose newest turn is off Fable, or that a safeguard fallback just
  switched, is not clear, and `supervisor tick-record`/`sweep-prompt` REFUSE it.
  Those two also RESTORE it, typing `/model fable` into their own tab so the owner's hand is not needed; `session standing` only ever reports, and never types anything anywhere.

## The keep-alive dies with its seat

**It dies when the seat that started it exits, so it is ABSENT once a takeover closes the predecessor's
workspace** — by construction, not because something broke. Measured: the watch's process chain runs watch → its tsx →
`zsh -c` → the seat's own `claude --session-id`. The skill loaded at every handover must
carry this, because the supervisor forgetting it is the main failure. So it is part of BOOT:

- **Read `keepAlive` on your first `session standing` call.** Before you have started one, a running watch is an
  INHERITED one — normally your predecessor's, though the gauge carries no seat
  identity to prove it. Leave it running, and do not apply the stale-restart remedy to it: its owner or the
  completed takeover retires it. **Start yours with `claude watch --wait` at boot**, unless a stand-down is on
  record (§ "Stood down by the owner's word"): it queues behind a running watch, writing nothing, and within 15s of that
  one exiting runs the loop as a foreground child WITHOUT `--wait`, so a ticking watch never carries the flag. A plain start beside a running watch is REFUSED (hatch `claude-watch-admission`).
  Residue: the check is one snapshot, not a fence — two starts in one instant, or two `--wait` successors, can
  both run (the next sweep shows them in `duplicates`) or both refuse (it reads absent); a checkout path with a space is unsupported, since `ps` cannot represent it. Fencing is board row
  `keep-alive-single-writer-needs-a-fenced-ownership-protocol`.
- **Run the check AND the watch through MAIN, forced.** `bin/slopweaver` prefers an inherited plugin root, and a
  worktree whose `bin` predates the keep-alive line prints none at all. `<MAIN>` is the
  `mainCheckouts` entry carrying the CLI (§ "The supervisor's own two trees"):

```bash
cd <MAIN> && SLOPWEAVER_CLI_DIR=<MAIN> <MAIN>/bin/slopweaver session standing --loop-session-key <key> --json
cd <MAIN> && SLOPWEAVER_CLI_DIR=<MAIN> <MAIN>/bin/slopweaver claude watch --wait
cd <MAIN> && SLOPWEAVER_CLI_DIR=<MAIN> <MAIN>/bin/slopweaver talk courier --follow
```

How a retired chair's watch actually closes: [keep-alive-retirement.md](keep-alive-retirement.md). **Whether a polling loop is the right shape at all is the owner's open question**, ruled good enough for now.
The courier dies with the seat too, and keeps itself on MAIN's code: [relay-courier.md](relay-courier.md).

## The supervisor's own two trees — and the main checkout every session reads through

The `supervisor` half is freshness only, and its two trees are read from the CONTRACT rather than from a
process's own checkout, because the supervisor's cwd is an ordinary handover worktree while the CLI it is
required to invoke lives somewhere else:

- its **bin** — the declared main checkout that carries `bin/slopweaver`, resolved from `mainCheckouts` in
  `$SLOPWEAVER_HOME/profile.json` by which one carries the CLI. Measured **whether or not a supervisor chat is
  open**: it is the tree every session invoking the absolute path reads through. Unresolvable (nothing
  declared, none carrying it, or two that do) is UNMEASURED with the reason printed — never a clean bill.
- its **plugin-dir** — the skill prose the live supervisor is following, from the pinned workspace whose title
  is exactly `/slopweaver:supervisor`. Two pinned supervisor workspaces resolve to NOTHING and say so: cmux
  enforces no single-pin invariant, so picking the first would grade a tree nobody is reading.

**Its `stale` list is its own, and broader than the loop's** (`SUPERVISOR_CHAIN_PATHS`, `src/live/standing/supervisor.ts`):
`src`, `bin`, `skills`, `.claude/rules`, `AGENTS.md` — `docs` excluded, being read on demand rather than
followed. The loop chain's list could not be reused, and the finding that produced this half is the proof:
`session close-done` landed under `src/cli/commands/session/`, which the loop's list does not name, and only
8 of 22 live worktrees carried it.

**Its remedies are not a respawn** — `session respawn` accepts `loop`, and nothing else. A stale
supervisor **bin** is one mechanical `slopweaver checkout sync`; a stale **plugin-dir** is reopening the
supervisor chat on a current worktree. The stream event says which.

**The keep-alive's remedy is not a respawn either, and the stream says so rather than defaulting.**
`streamEvents.ts` reads a `RESPAWNABLE_SESSIONS` list, and a session absent from it gets a sentence naming what to
actually do: for the keep-alive, interrupt the loop and start it again from a current checkout — through MAIN,
forced (§ "The keep-alive dies with its seat") — and never restart one a fresh seat inherited.

**The keep-alive has ONE tree per running watch, and its own sensitivity list.** It follows no skill prose, so
there is no `plugin-dir` half — only the `bin` its CLI runs out of, graded against `KEEP_ALIVE_CHAIN_PATHS`
(`src/claude/watchSession.ts`: `bin`, `src/claude`, `src/cli/commands/claude`); the loop's list names none.

## Which commit each one is on — the same weight as liveness

The loop runs on **two** trees (the keep-alive on one, above), and they drift independently:

- its **bin** — the CLI it and every worker it dispatches run;
- its **plugin-dir** — the skill prose it is actually FOLLOWING, from its `claude --plugin-dir` argv.

Each is reported with a HEAD, how far `origin/main` is ahead, and a grade. **`stale` means the missing commits
touched code or prose that session runs** — an ordinary few-commit drift grades `behind` and is reported
without shouting. A `stale` session is an **alert** on the supervisor stream, so
`slopweaver events tail --cursor supervisor --min-severity alert || surface-it` catches it even if nobody runs
the check.

**Why the supervisor half is checked at all, measured**: `session close-done` landed and only 8 of the 22 live
worktrees carried it. The main checkout carried it only because a
supervisor hand-ran `git merge --ff-only origin/main` after every landing — a step recorded verbatim in four
consecutive boot blocks. The pull half of that is mechanical (`checkout sync`); this half is the gauge
that says when it is owed.

**Why this is checked at all, measured**: the loop ran a worktree two days old, and the standing
scheduler one 74 commits behind, through a whole day of public failures, while every liveness
gauge read `healthy`. Every
worker a standing session dispatches inherits its bin, so fixes landed in the meantime changed nothing in the
channel. Fixes land on the plugin constantly, and a session that does not use the latest does the hard parts
and misses the easy, obvious one.

## If it has drifted, it respawns itself — do not do it by hand

```bash
slopweaver session respawn loop --successor <today-s-slug>  # boots today's dated loop doc
```

Three gates, and it refuses on any of them: the session must be genuinely `stale`, nothing may be in flight
(no ask still holding a worker), and the successor's run must not already be held by
a live session. **That third gate is what stops two loop sessions ending up on one doc** — which once happened
when two hand restarts both booted idle on a pickup false negative and the old listener respawned
itself on top, leaving Slack load-balancing tags across two listeners with only one being watched.

`--force` overrides the first gate only. A refusal names which gate stopped it; relay that rather than working
around it. An unmeasurable loop names WHY: an unconfirmed boot of the successor you named with no listener
running means it may be between arms, so run `--confirm`, not a finding (11s after the disarm); only
a running listener no tree resolves from is a read to fix. The verb boots the successor first and then tells
the outgoing session the two steps only it can take — `listen disarm`, then stopping its own listener child —
because a process belongs to the session that started it.

**The loop's respawn is two phases, and a boot is NOT a respawn.** `session respawn loop` once booted
a session into the right worktree at the right HEAD, published `respawned`, and every worktree/branch/directory
gate read green — while the session in there was analysing a table row it had been sent as its pickup and no
second listener ever armed. So the boot writes a pending record and publishes nothing, and `respawned`
comes only from:

```bash
slopweaver session respawn loop --confirm   # exit 0 = the successor's OWN arm is live from its OWN tree
```

which reads `listen status`, resolves the live arm's pid to the checkout it runs from, and confirms only when
that arm is not the predecessor's, is up, and runs from the successor's worktree. Anything else exits 3 and
says what is still missing (predecessor still armed, unarmed, DOWN, or a listener from some OTHER tree — that
class). The successor runs it right after it arms; a hand-run handover gate and your own tick read the
same verb, so nothing can call a boot a respawn on its own evidence. **A confirmation on record answers 0 only
while the arm it confirmed is live, up, from the successor's tree** — else 3, a `supervise` re-arm included,
never re-judged; a boot clears the record first, then writes its own `spawned` row's tree (an earlier seat's record once
answered for a new one). The pickup line itself is always the
lifecycle template (`src/cmux/pickupCommand.ts`) — a doc's own fenced blocks are never typed at a session.

## Stood down by the owner's word STAYS DOWN — `missing` is then a caption, not an order

**The gauge cannot tell "nobody started it" from "the owner turned it off", and only one of those is yours to fix.**
When the owner has stood a standing session down — in the owner's own words, in this chat or relayed through it —
`session standing`'s `missing` for that half is a FACT TO CAPTION in the briefing's collapsed fold, never a
respawn order, and it stays that way until the owner says otherwise. Re-spawning it is not a helpful default: it
puts a listener back on Slack that the owner deliberately took off.

Three things this costs you, all cheap:

- **Record the stand-down the tick the owner says it** — `slopweaver session record <key> --note "stood down by
owner, not to be respawned"` — and carry it in the state doc's boot block as shift state (that is
  exactly what a boot block is for; [state-doc.md](state-doc.md)).
- **Caption it every tick it stays down**, in the fold: _loop: stood down by the owner, gauge reads
  missing — deliberate._ A `missing` half with no caption is indistinguishable from one nobody noticed.
- **The section below applies only to a half that is missing with no stand-down on record.** `stale` is
  different again and is unaffected: it is about a session that IS running, on the wrong tree.

## If either is missing with no stand-down on record, spawn it — never silently assume it's up

- Loop absent → write or reuse today's dated loop handover doc, then
  `slopweaver cmux spawn <that-slug> --model opus` (right-sized per § 0).
- Keep-alive absent (`keepAlive.candidates` empty) → open a visible session and run
  `slopweaver claude watch --wait` in its FOREGROUND, through MAIN, forced (§ "The keep-alive dies with its seat"). Keeping stores alive is a plain CLI loop needing no plan
  budget or Fable seat, which matters most when plans have expired and no Claude session can spawn to fix them;
  only an anomalous drawdown makes it open a visible Opus investigation. Leave it running and interruptible; never
  background it, never wrap it in launchd or cron (rule 2, `no-headless`). Confirm with
  `slopweaver session standing --json` — its `keepAlive.live` reads true only once a tick has actually been
  stamped, so the confirmation is the loop's own record rather than the fact you typed the command.

Either way: verify the spawn came up past the known pickup false-negative (§ 3's own caveat — check
`slopweaver cmux list --json` rather than trusting the confirmation alone), `slopweaver session record` what
you did, and say so plainly in the § 2 briefing. A spawn you did silently is, from the owner's side,
indistinguishable from one that never happened at all.
