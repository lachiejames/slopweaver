---
name: loop
description: Be the bot, continuously, inside THIS visible session — a permanent stream of Slack addresses, each judged and dispatched as it arrives. Never detaches, never spawns a headless model; you can watch it and interrupt it. With no listener, an address is a no-op; capture-only may queue it but never answers. Automations are the supervisor's own decision and never this session's — see the automation skill. Use when the owner wants the bot live and listening. Phrases like "run the bot", "start the loop", "listen for tags", "be the bot", "go live".
argument-hint: "[--turns N to stop after N tags]"
---

# loop — the bot, in the session you are watching

You are the bot, and you are the bot **here** — the LISTENER. Every address — a channel `app_mention`, a DM that
tags the bot, or a reply under one of its own posts where `--thread-replies` names the channel — is judged from
a turn in this session, which the owner can read as it happens and interrupt at any point. **This session judges; a worker session answers.** An admitted mention that needs any
research at all is dispatched to a fresh visible worker that owns it to its terminal outcome, and this loop is
back on the stream before that worker has read the thread. Grinding one policy question inline for the better
part of an hour does not scale: a session spins up to answer rather than flailing through it here. N
tags close together are N workers; this loop never blocks on one of them, and a worker that dies leaves a
nameable corpse the sweep reports rather than a half-dead loop. Nothing detaches. An UNTAGGED DM message is
not an address and never reaches you — the listener refuses it at the parse, so the owner's own drafts, written as
the owner, in that DM stay untouched.

**This loop owns Slack only.** An automation is a supervisor pass's decision and, when it costs a session,
runs in one `automation seat` opens for it (`skills/automation/SKILL.md`) — precisely so a scheduled row's
own investigation can never block this listener. This loop has no recipe duty at all.

The bundled CLI is `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver"`. **Use that exact quoted path for every single
invocation in this loop — never a bare `slopweaver`, even though one is also on `PATH`.** Measured, live:
direnv or another tool can prepend `PATH` ahead of this plugin's own `bin`, so a bare `slopweaver` silently
runs a DIFFERENT checkout's code while every printed line looks identical — which is exactly how a shipped
divider fix once tested as "still broken".

## The loop stays connected — `--follow`

**Read [reference/listener-stream.md](reference/listener-stream.md) before arming, and never type a
`listen --follow` line yourself** — `listen arm --background` prints the one line to run, `listen disarm`
precedes any kill. A hand-typed `--follow` still captures tags and is INVISIBLE to supervision, which is how
a second connection gets armed over a live one and Slack load-balances tags across a watched and an unwatched
listener. That page also carries the exact JSON shape of every line, the `started` hand-off you must carry
forward into `turn brief`, the `witness` line that NEVER goes there, and the indicator contract — **every live indicator a turn raises is finalised by
the turn itself, on EVERY terminal outcome; if you are about to tidy up a stuck card, a stale `:eyes:` or a
standing indicator, that is a defect in that seam and you report it.** Booted by `session respawn loop`? Run `session respawn loop --confirm` right after arming ([context-hygiene](reference/context-hygiene.md) § 3).

**Read every line as it arrives — never wait for one ask's turn to finish before reading the next.** Watch
stdout alone and never merge stderr into it. A non-whitelisted tagger's line never appears at all. A non-zero
exit with no JSON is a real listener failure: **degradable** (a transient disconnect, a rate limit) means log
and resume; **fatal** (a dead credential, anything you cannot self-serve) means stop and escalate loudly — a
stalled loop nobody notices is the single most expensive failure mode here.

## Every line runs the SAME three steps, and then you are back on the stream

```bash
# 1. Build the question this line becomes.
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn brief --channel <channel> --message-ts <messageTs> --thread-ts <threadTs> \
  --user <userId> --surface <surface> --text "<text>" --mode continuous-drain \
  --turn-id <started.turnId> --working-ts <started.workingTs>   # only when the line carried `started`

# 2. YOU judge. Compose ONE RoutingDecision JSON and write it to a file — see below for the shape.

# 3. Hand the decision to dispatch. It executes the tier YOU named, and returns.
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn dispatch --brief <the brief path turn brief printed> --decision <your decision file>
```

`turn dispatch`'s own printed output tells you exactly what happens next, by tier:

- **`no-response`** / **`for-a-human`** — nothing further; it settles `:ack:` / `:for-a-human:` itself. Next line.
- **`fresh-visible-session` — the DEFAULT for anything that needs research.** It opens a real, watched cmux
  workspace for a WORKER, pinned at boot to the model your decision named, and **returns immediately once it
  has booted**. The worker owns the ask from there —
  [reference/worker-contract.md](reference/worker-contract.md). **Read the next line right away.** Nothing
  about that ask comes back to you except through `--sweep`. It opens in THIS checkout, never a new worktree. **No capacity line holds it**: a `machine capacity` `HOLD` (on `cpu` or any subject), `hold: true` or a spawn backoff brakes the supervisor's backlog fill, never a live tag — dispatch straight through it ([fleet-capacity](../supervisor/reference/fleet-capacity.md#the-read-every-tick-in-two-commands)).
- **`inline` — the trivial-ack carve-out, and it is narrow.** A reply you can compose from the brief alone
  with ZERO research: a greeting, a thanks, an acknowledgement, a one-line answer the thread text in front of
  you already contains. Run the card clock `turn dispatch` prints FIRST; beyond it, **not one tool call, file
  read or live verb** — the moment an answer needs any, it is not `inline`. "Flailing through it itself" is
  precisely an `inline` judgement on a question that needed a worker.
- **`read-only-subagent`** — **refused outright in this loop**, and that is a GATE: run
  `slopweaver session no-subagents --why "this loop must never block on a native subagent call"` on your
  first tick and your own `Agent` tool is refused for the shift. It binds THIS session only — a worker you
  dispatch still fans out detectives. Re-judge as `inline` or `fresh-visible-session`.

**This is the whole mechanism that lets N tags arriving close together produce N independently running
workspaces without this loop ever blocking on one of them.** The proof is cheap to check: a second tag
arriving while a worker is still investigating gets its OWN brief, judgement and dispatch before the first
worker's answer exists. A rapid-tag burst from one person arrives the same way, tag by tag, and each one is
JUDGED: the brief names what that asker already has in flight, so you fold the follow-up in, answer it
separately, or decline it with `"exclude": true`. [reference/worker-contract.md](reference/worker-contract.md)
§ "A rapid-tag burst" has all three shapes and the double-answer that makes the in-flight section load-bearing.

## Routing judgement — composing the RoutingDecision

**Read [reference/routing-judgement.md](reference/routing-judgement.md)** for the exact JSON, the private
profile and owner directives that bind it, and the PR-list rendering an answer of that shape owes.

**This is the whole point of the doc this loop implements: decide the way a person would, not by matching
capability terms against the question.** A bare "yo" needs `no-response`? No — a person addressed like that
replies casually; that is `respond`/`inline`, from context and judgement, never silence and never a corpus
lookup. _"what are my open PRs?"_ needs a live verb. A question about a surface `turn brief` listed
UNAVAILABLE is the one case where a good-looking answer IS the failure — the corpus holds only people
_discussing_ it — so say plainly what you cannot see rather than judging a live tier for it.

### The investigation happens in the WORKER, not here

`slopweaver catalog` lists the verb surface; the worker reads Slack with agent-chosen depth, checks live
state and reads the repo — `skills/loop-bot/SKILL.md` specifies that behaviour in full and applies to the
worker unchanged. The spend lever is **which model produces the output**, and it is pulled at DISPATCH: name
`"model"` on the decision to right-size the worker (Opus by default for an open investigation; `sonnet` for
an ask you can see is narrow), never by this loop doing the leaf work itself. If you find yourself about to
run `grep`, read a file, or call a live verb to answer a tag, you have judged the wrong tier — stop, and
dispatch.

### Keep the card alive — a STAGE from you, a clock from the harness

**Read [reference/live-card.md](reference/live-card.md).** Both halves are required on a dispatched turn: a
card that moves only at phase boundaries is the one the owner has called "incredibly broken" more than once.
`turn status` APPENDS, so write what you LEARNED ("thread read — 47 msgs, 12 PRs named"), not what you are
about to do; then start the ticker ONCE — on a dispatched turn both are the WORKER's steps 0a and 0b, which
its `turn resume` prints. `--sweep`'s `card-stale:` is a defect report, and names a missing ticker.

### Then post exactly one answer, and open the reviewer first

**Read [reference/posting-the-answer.md](reference/posting-the-answer.md) before every send.** The order is
fixed: write the answer JSON, run `turn review` on those exact bytes (a second visible cmux session whose
instructions are composed by CODE, never by you or a worker), poll it bounded, then `turn answer --verdict` —
a send without one is REFUSED; a worker runs the same calls with `--dispatch <id>`. **The voice check is a
verdict FIELD**: an unrecorded `voice` is `ANSWER_VOICE_UNCHECKED`, and the door re-runs those rules over the post.

## Sweep, and scheduled recovery — both on every natural pause

Run BOTH at the start of this loop, on every idle tick, and right after dispatching or finishing any turn:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn dispatch --sweep
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn blocked --json
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" listen recover --bot-user <the bot's USER id> --channels <the channels it answers in> \
  --scheduled --json --deadline-ms <now-in-epoch-ms + 500>
```

The sweep relaunches nothing and is the ONLY channel through which a worker's fate reaches you —
[reference/sweep.md](reference/sweep.md) has every reading, the budget warn YOU raise, the blocked-on-human rows, and the read-only
**`UNROUTED` and `NEVER-DISPATCHED` print FIRST, each carrying the exact `turn brief` command: take those before anything else, and never leave one for a recovery pass — that posts a second card over the one already standing. `IN REVIEW — DO NOT ROUTE` is the same ask with an open reviewer and carries NO command: a session is inside that turn, the bound is held, and re-briefing it is the second card.** The near-immediate `--deadline-ms` keeps recovery from becoming a second blocking loop: most calls return
instantly with `{"kind": "clock-wake", …}`, a due one returns `{"kind": "recovery-sweep", …}`, and
[reference/scheduled-recovery.md](reference/scheduled-recovery.md) has how to read one.

**Every recovered survivor is already fully vetted, and is a turn IN PROGRESS the moment it appears.** Run each
through the same three steps a live line gets, with `--mode continuous-drain` — never `single-turn`, so
`read-only-subagent` stays refused here too. One may be a **STRANDED** ask rather than a dropped tag — already
worked, left with no answer — which a running visible session picks up exactly once (the owner's ruling), in
the same list and answered the same way. **Do not stop at capture**: the reaction, checklist and native status
already posted, so leaving a survivor un-answered recreates the checklist-freeze bug this feature exists to fix.

## The one rule everything else follows from

**No headless model, anywhere** (AGENTS.md rule 2). Not `claude -p`, not a detached child, not a fleet
drive, not a launchd job, and not a background listener that drives answers. The allowed
`listen --follow --queue` shape records input only, and no `turn` verb has a model in it — every reasoning
step happens in THIS visible session, or in the worker and reviewer sessions a dispatch opened. The
`no-headless` gate has no allowlist and no exemption marker, so the only way to reintroduce a headless one is
for **you** to shell out to `claude`/`codex` some other way. Do not.

The direct cost is accepted: **an address arriving while NO listener process is running gets no answer** — a
genuine no-op by design. With a `--follow` listener running, a tag IS captured and durably recorded even while
this loop is elsewhere in a turn. Scheduled recovery narrows the gap; what stays manual is a deliberately
WIDENED one-off pass — `--discover-channels`, which ADDS the bot's OWN membership to what you type, plus a longer
`--since` — in [reference/edge-cases.md](reference/edge-cases.md). **Never hand-type its channel list.**

## The cases that are not a plain tag

Each with its own handling, in [reference/edge-cases.md](reference/edge-cases.md): a DM from someone other
than the owner, a tag from someone not on the responder whitelist, a compound owner instruction that both
changes the whitelist and asks a question, the widened manual pass over dropped tags, and a second tag from
someone already being answered. A permanently-ignored ask never reaches you at all, and that page says
why. The cases INSIDE an admitted turn — costing a proposal before checking it exists, reading a capability
contract without clobbering the brief, an old turn's two reactions, a non-terminal grounding-id refusal —
are in [reference/turn-mechanics.md](reference/turn-mechanics.md).

## Keep going. Log what breaks.

Do not pause for confirmation on a routine send — posting the answer is the loop doing its job. Reserve a
real stop for something irreversible and unasked-for, or a blocker only the owner can clear. **And keep this
session's own context small** — [reference/context-hygiene.md](reference/context-hygiene.md).

Code records every breakage it can see (`slopweaver turn breakage --classes` names each writer). For one only
your judgement can name, record one row and carry on to the next line in the stream:

```bash
slopweaver turn breakage --thread <channel/ts> --what "<the step that broke>" --error "<verbatim>" \
  --cause "<why it broke>" --did-instead "<what you did>"
```

`--cause` is required — a row without one is refused. A breakage you did not record is the only unrecoverable kind. **A broken turn must not end the loop** — answer what you can, log the rest, and go back to reading the stream.

## What would mean this is not built

The full list of failure signatures is in [reference/not-built.md](reference/not-built.md) — read it when
something looks like it worked but you are not sure it worked for the right reason.

## Running this from Codex

This skill runs on both hosts. The Codex shape — the plugin root by absolute path, the foreground `--follow`
stream that must inherit `CODEX_THREAD_ID`, the same three steps with `--host codex` — is in
[reference/codex.md](reference/codex.md). Never run bare `slopweaver` on either host.
