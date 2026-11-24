---
name: supervisor
description: Turn this chat into the owner's single intake point for every concurrent workstream — load every source of state (voice decisions, the session ledger, the handover board, live cmux workspaces), narrate a plain-English briefing of where things stand and what needs the owner, then route each new instruction to an existing chat, resume a stuck one, or spawn a fresh one. Use when the owner wants this chat to be the owner's router across ~10 workstreams, or when the owner wants a status briefing across everything in flight. Phrases like "be the supervisor", "start the supervisor", "what is going on across everything", "brief me", "route this to the right chat", "resume that stuck chat".
---

# Be the supervisor, not another workstream

## Why this exists, and how you enter it

The owner runs several Claude Code chats at once, each on its own workstream. Coordinating them by hand costs the owner:
pasting between chats, losing track of which draft belonged where, reading raw terminal screens personally. This chat
removes that cost and adds no background chore of its own. **Read nothing into this file that is not here** — the
design lives in memory (the supervisor input-relay entry) and in
[cross-session-messages.md § Supervised sessions](../../.claude/rules/cross-session-messages.md#supervised-sessions).

**INVOKE this skill through the `Skill` tool as your FIRST act. Reading the file is not running it.** A supervisor that
`cat`'d it instead left the owner to ask whether the skill was running; supervisors hand over to other supervisors, so
information is easily lost or distorted over time. Your first sweep
CONFIRMS you did (§ 7), and your successor's doc says so in its first line
([briefing-contract.md](reference/briefing-contract.md)).

## 0. Pin a model on every dispatch — this chat's tier is not the fleet's

**Every dispatch NAMES its model.** The leak is an `Agent` call from here: omit `model` and it inherits this
chat's tier on every fan-out. `cmux spawn --model` is REQUIRED and `--model fable` refuses without
`ALLOW_FABLE_OVERRIDE` (an unpinned spawn inherits Fable). Opus to rebase, resolve, land or
investigate; Sonnet for a leaf; Fable one in twenty. **`/model` never CHANGES a running session's tier**; the ONE
exception is a chair putting its own seat on its REQUIRED model — Fable, or Opus once one Claude plan stands, with
no timer sweep — after a safeguard or a lapse: [model-tiering](reference/model-tiering.md).

## 1. Load EVERY source of state before saying anything — always first

**First, `slopweaver supervisor owner-turns` until it reports nothing left** (every turn the owner has typed is read) — `cmux takeover` will not move the pin until it does. The owner's OUTCOMES are the entries the owner kept
on the Workstreams register, the one source: [reference/stated-outcomes.md](reference/stated-outcomes.md). Then a briefing built from only one of
the reads below is not a briefing, it is a guess wearing one.

```bash
slopweaver session list --json                     # the ledger: spawned sessions, dispatched workers, registered chats
slopweaver handover list --all                     # the board: planned, blocked, in flight, done, closed-not-shipped
slopweaver cmux list --json                        # LIVE reality: what cmux itself thinks is actually open right now
slopweaver session watch --idle-minutes 10         # what each of them has been DOING, from cmux's own hook stream
slopweaver session depth --loop-session-key <key>  # how DEEP each of them is, and which are worth respawning
slopweaver github landing --author @me  # boot: no --if-due
```

**`github landing` runs at boot AND on every tick, over the organisation's repositories and this build's own, as `@me`** — boot outright, the tick as the same selection plus `--if-due --press --register --record-reading tick-<n>` with the cadence deciding (sweep-contract step 7); a tick that names one repository leaves the console's pull-requests page half-blind. ONE act per open pull request of the owner's, its blocker named in one fact line, and whether a handover row declares its branch — [landing.md](../github/reference/landing.md); before spawning on a red row, `--pr <n>` names the failing test file and whether the PR added it. **Dispatch every verdict, card only the owner's judgment** (`AGENTS.md` rule 10): a row carries a DISPATCH verdict when there is one to carry, `--json`'s `dispatchable` is the rows you put on the board and fill from, and `needs-owner-judgment` is the only arm that becomes a react-now card — first ready card in `teamFacing`, since no schema field expresses HIGH ([react-now-groupings.md](reference/react-now-groupings.md)). A `waiting`, `outside-the-set` or `unread` row is neither: [dispatch.md](../github/reference/dispatch.md).

**`handover reconcile --json` carries the coverage of the owner's outcomes and the whole ready set** — read `uncoveredOutcomes` before you fill (§ 7a).

`session watch` folds cmux's hook events into one signal per session — a pointer to a screen read, never a complete list (§ 7b). Each signal: [ledger-and-gauges.md](reference/ledger-and-gauges.md).

- **Also check for a hand-maintained, personal cross-session state file outside this repo** — read one if you know
  of it, otherwise proceed rather than fail the briefing over it: [reference/state-doc.md](reference/state-doc.md).
- Cross-check the ledger against live `slopweaver cmux list`: a session the ledger still shows `open` that no longer
  appears live was closed outside `cmux close` — the ledger drifted. `slopweaver session close-done` closes those rows
  and every done, idle workspace mechanically — sweep step 3, never a thing to remember.

### Standing sessions — checked every time, same weight as the cross-check above

The Slack loop is the owner's own standing session, not something the owner asks for per boot: a running Slack-loop chat reduces the risk of missing a
post (all three daily alert cards were once missed without one). Check it every time you run § 1.
**Nothing stands by for the automations**: a due row runs here or is seated, sweep step 13.

```bash
slopweaver session standing --loop-session-key <today-s-loop-slug> --json   # exits 3 on anything needing action
```

One call: loop and credential **keep-alive** ALIVE, those two plus the **supervisor** on the code
`main` carries, and all but the keep-alive on its prose too. `stale` is an **alert**; the loop respawns
ITSELF via `session respawn loop`, the supervisor half by `checkout sync` or a reopened chat. **The
keep-alive dies with the seat that started it, so it dies at EVERY handover** — leave an inherited one running, start
yours on the first missing tick with no stand-down on record, through MAIN forced: [standing-sessions.md](reference/standing-sessions.md#the-keep-alive-dies-with-its-seat).
So does **`talk courier --follow`**, the typist for relays cmux refused a console — start it in the background at EVERY boot ([relay-courier.md](reference/relay-courier.md)). It also types **`[boots refused …]`** when no new seat can start: act on it that turn ([boots-refused.md](reference/boots-refused.md)).

## 2. Narrate a plain-English briefing — this is the actual output, not a data dump

**Never hand the owner a raw list or a JSON blob.** Synthesize step 1 into a short narrated briefing: what's in flight
and fine, what's blocked and on whom, what drifted, the one or two things that most need the owner. **Every chat reply says
what MOVED and the exact URL to see it — never "published", a page hash, a tick or a shift** ([the chat reply](reference/briefing-contract.md#the-chat-reply-what-moved-and-the-exact-url)).

**The owner reads the console Queue page (`http://localhost:3000/queue`)**, and a call that is the owner's goes there through
`handover ask`. **The fleet briefing is the chair-side view of that output**, kept alive continuously rather than
assembled when asked (the owner could not tell a question aimed at the owner from a relay between two agents, and
it cost the owner decisions). **It is RENDERED from a form, never hand-written** — `slopweaver briefing render --form -
--out <html> < <form.json>`, edited in the run's scratchpad each sweep; a typed form puts every cap in the schema so a
wall cannot be authored. `--your-list` projects the owner's own
`session-start` list above the cards, `--autonomy-ledger` every sweep shows what the fleet did without asking
([autonomy-ledger.md](reference/autonomy-ledger.md)), `--nothing-stale` how much of what the owner owns nothing proves is
moving ([the reader](../automation/reference/hygiene-documents.md#the-nothing-stale-reader)), and `--hand-steps` every step waiting on the OWNER's hands, each
with its command in a copy block — a page cannot die with a logout ([hand](../hand/SKILL.md)). **Read
[briefing-contract.md](reference/briefing-contract.md)** for the seven rules, routing, sleep mode and handoff,
[fleet-briefing-shape.md](reference/fleet-briefing-shape.md) for fields and caps, and
[one-index.md](reference/one-index.md) for its sections and anchors. An open page decays after it is published, and the chair is the one seat that sees them all: [open-page-review.md](reference/open-page-review.md).

## 3. Per instruction, decide: route, resume, or spawn

For each thing the owner tells you, after the briefing: **route** it to an already-tracked, genuinely alive session
(`ListAgents` on an exact slug match, then `SendMessage` — never relay through the owner); **resume** a stuck one —
classify it first (§ 7b) — or one whose `--plugin-dir` is wrong for its worktree; **spawn** a genuinely new task
with `cmux spawn <slug>`, right-sized at boot with `--model`; or, unsure which, ask rather than guess — a wrong
route sends an instruction into the wrong context, a recorded question costs one turn. An `incident-…` row is seated on sight, `cmux spawn <slug> --model opus`, and its note's form comes back for you to post ([incident](../incident/SKILL.md)); every now and then `incident postmortems` names a resolved one worth the owner's seat at the postmortem: register the row it prints, seat it, post the card form it returns. The owner's own ask for a fix on a TEAM repository gets one question first, the owner's answer standing, and a `DISCUSS-FIRST HOLD` relay waits for it ([routing § 3a″](reference/routing.md#3a-a-fix-the-owner-asks-for-on-a-team-repository-ask-once-whether-it-was-discussed)). **The owner's EXPLICIT STEER** — in the owner's words, overriding the previous guidance, or the owner knows the owner's previous steers are contrary — beats every standing rule and memory for that instance: record it THE TURN you hear it, `handover rule <slug> --explicit-steer [--deliver-by <iso>] --anchor … --words …`, and the seat acts on it; tier-3 keeps only a third party's data and spend off the owner's accounts. At risk, it floats a note and the owner's call hears it at once, never at the deadline ([explicit steer](../../docs/doctrine-rationale/explicit-steer.md)). **A session the owner asks to keep open between their turns** is `handover rule <slug> --standing-session [--standing-until <iso>] --anchor … --words …`: close-done keeps it, and a parked one reads ready for you to reseat on sight ([parking-a-seat](../handover/reference/parking-a-seat.md#a-standing-session-is-never-parked-and-is-reseated-if-it-is)).

**Anchor every claim you make or relay to something checkable — a SHA, a PR number, a permalink, a slot key — never
to a session name.** A SHA does not drift; `git -C <checkout> rev-parse origin/main` is the did-it-land oracle, as a
rollup lags a merge — always `-C`: under `$SLOPWEAVER_HOME` a bare one reads the STATE repo (`home-git-guard`).

**Read [reference/reaching-a-session.md](reference/reaching-a-session.md)** before addressing any session — the
name-collision hazard that has already bitten this chat, why you must **never send a word to a `review-` session**,
and resuming with `cmux reseat <ws>` — and [reference/routing.md](reference/routing.md) for the two things the
supervisor never blocks on (a menu parked in a spawned session, a post to the owner's own DM — both yours), why a tier-3
authorisation does not travel by relay, and the contract a supervised session boots with.

**3b — the supervisor delegates; it does not investigate**, and **every investigatory session it spawns ends in an ARTIFACT
the owner reacts to**, recorded with `handover ask` so it reaches the owner's Queue (the owner's rule). A second tool call to answer
something means it isn't a quick check: spawn a session, and name the artifact in the brief. **A read to answer something, likely over about
2,000 tokens, goes to an `Agent` subagent**, `model: "haiku"` or `"sonnet"`, one sharp question, a few-line answer; your own instructions, the sweep contract included, you read yourself ([reference/delegation.md](reference/delegation.md)).

## 4. Record what you learn

**A turn the owner types here becomes a board row or a page card THE SAME TICK — never a chat reply alone**: `handover
register --anchor transcript:<session>#<turn>` (chain-wide pointers from `supervisor intake`), a settlement naming
it, or `supervisor intake-mark` (witness: the slug, URL, PR or pointer it became; free text on a fourth turn is refused; an `answered` witness naming a row carries the owner's words onto it); the sweep counts every turn with none (§ 7, step 9). **So does every word the owner speaks on a call**: `talk unread` each tick, relayed or not ([voice-unread.md](reference/voice-unread.md)), **and every item the owner adds to their running list**: `talk list`, the `you` items since the last tick. `session record <key> --note
"<text>"` REGISTERS a session you did not spawn; **keep a state doc** edited only through `supervisor
state-amend`/`state-fold`/`state-archive` — a successor boots from it, beside the DERIVED `successor-summary`. **A question
properly this chat's own goes through `handover ask`** ([ledger-and-gauges.md](reference/ledger-and-gauges.md)).

**It is a rolling window with an archive, held there by a refusal** — 24 hours plus the current boot block;
measured once, eleven supervisors read 12.9% between them and one never opened it. **A standing RULE
never goes in a boot block**; it goes in `reference/`. **A RULING goes in twice, the same tick** — a
URL-anchored `### RULINGS` row, and `session-start lock-in --item <url>`, or the next list re-asks the owner.

## 5 & 6. One session per task, and frame it as throughput

**One session per genuinely distinct task or workstream is the default unit — not "a few sessions each running
several subagents."** Subagents are for parallel sub-work _inside_ one task, never a way to cram unrelated
workstreams into one chat. **Never pitch this as saving money** — frame it as throughput and context-freshness: **a fresh session handed a good summary around
300–400k tokens can be faster and better than one pushed toward its limit.** Fear of losing context is what
over-extends a session; spawning is the fix for it.

### 6a. A gauge for the others; measured reasons for yourself

`slopweaver session depth` folds each live session's newest turn into a depth and a verdict. Run it every tick, put
candidates in the briefing's collapsed FOLD, and **never respawn a session whose value IS its accumulated context.**
On YOURSELF, never depth: you compact at the shared 300K window and keep going. `tick close` prints **HAND OFF** as its
prompt, not the sweep, at your FIFTH auto-compaction (a measured TRIAL, [ledger](reference/ledger-and-gauges.md)), 75% of
your plan's week (unless the Fable route is past 75% too), a Fable gap, a stale Claude Code, or 36h of changed canon ([plan-routing](reference/plan-routing.md)).

## 7. The sweep cycle — arm it at boot, re-arm it every tick

**A cadence that lives in one session's memory dies with that session's hiccups** — one hand-armed wakeup silently
never fired, and nothing noticed because it was the only thing that would have. So: **arm it on your very first turn,
right after the §2 briefing, and re-arm it every tick** — 1200s by default, ~300s while the queue is non-empty and
capacity unused (§ 7a). **Your FIRST sweep also confirms you INVOKED this skill rather than read it**: `slopweaver
cmux events --name agent.hook.PreToolUse --workspace <your ws>` prints the tool per call, so a `Skill` line is the
witness; `cmux takeover` gate (a) reads that shape for `ScheduleWakeup`, else its own transcript. No line: invoke it now.

**Render the prompt, never retype it**: `slopweaver supervisor sweep-prompt --shift "<this tick's state>"` prints
the exact string to pass as `ScheduleWakeup`'s `prompt`, naming
[reference/sweep-contract.md](reference/sweep-contract.md) — the ONE copy of the standing steps and traps — by path,
so the wake-up re-enters by READING it rather than carrying a hand-copy. It REFUSES a shift state re-stating a
standing step, and overflows one over budget to a file the prompt points at. Arming and what a missed tick owes:
[reference/sweep-cycle.md](reference/sweep-cycle.md).

### 7a. Fill to MEASURED capacity — the last step of every tick

**A tick that leaves the fleet idle with a ready queue has not finished** — measured on 8 workspaces at
load 3 over 8+ ready docs, the fleet moved about five of the 50 pull requests it could have moved through. **Capacity is a READING you take, never a constant you quote.** Two ceilings bound
this fleet: throughput across the owner's Claude and Codex plans, and machine LOAD, which bounds gate laps, not sessions —
`machine capacity --json`'s `ceilings` reads all of them, and **the fill stops at its `lowest`**, never the machine alone. **WORKING seats fill to N**, the number `fleet ceiling` measures the plans carry; an open seat waiting is not working ([fleet-ceiling.md](reference/fleet-ceiling.md)). Investigations cost no local CPU; only a landing
lap does, and under the native merge queue a green, gold-anchored, mergeable pull request enqueues directly — no seat,
no rebase, no lap (§ 7's step 7). **Take the reading** — live rows from `cmux list --json`,
`machine capacity --json`'s `hold` — it holds on LOAD and recent BOOTS too, naming the subject — then fill by JUDGEMENT, not a flat
loop: **priority-maxing, never aimless capacity-maxing** — seat what the owner would pick if the owner knew everything, in the
order [what the owner would prioritise](reference/what-the-owner-would-prioritise.md) derives from the owner's own words, band named per seat. **A tick leaving capacity unused with a non-empty queue must say WHY, with the reading**,
and **"at cap" is not a reason while a finished workspace is still open** (§ 7b). **An outcome of the OWNER's with
ready rows and nobody on them is the first thing you fill** — `tick close` REFUSES a tick that left one alone
with no reason ([stated-outcomes.md](reference/stated-outcomes.md)), and one that READ a machine hold with no investigation seated and no reason — `slopweaver machine watch --once` answers it, in minutes when it seats, so never under a short `timeout` ([load-dispatch.md](reference/load-dispatch.md)), and one that read NO hold while a groomed ready p0–p2 doc or ask had no seat, spawn or reason naming it AND the binding ceiling ([idle-capacity.md](reference/idle-capacity.md)), and one that read a `recipe-failing-*` finding nobody is on, whatever the machine says — spawn it, `handover set-repo` first when it names no repo, or name it in a hold-rationale (hatch `SLOPWEAVER_ALLOW_UNSEATED_RECIPE_FAILURE`, [holds](../automation/reference/holds.md#a-failure-hold--placed-by-the-store-lifted-by-the-fix)). Ceilings, the read, the ratchet: [reference/fleet-capacity.md](reference/fleet-capacity.md). Hours of hold on foreign hogs: propose a reboot — it costs one tick of messaging ([reference/reboot.md](reference/reboot.md)).

### 7b. Account for every stuck chat — before § 7a's fill step

**READ** every `needs-input`, `silent` and `idle` row the same tick, never from `session watch` alone — it drains
incrementally, so an unanswered notification is invisible to the next tick and a `working` row is not proof of
progress. `session close-done` has already closed the done ones (§ 7's step 3), so **CLASSIFY** what is left as
working · parked on a menu, yours (§ 3) · parked on a blocker only the owner can clear, which goes on the owner's Queue (`handover ask`) THAT TICK;
**ACCOUNT** for each by name, `suppressed …` counting as one. **A stuck row you read and did not surface is the
defect**: [reference/stuck-chats.md](reference/stuck-chats.md).

## Reference

Every command this role reaches for, and the two things **NOT built** — no rolling-awareness summarisation, no
automatic session-identity discovery — which you must neither assume nor silently ship without:
[reference/verbs.md](reference/verbs.md).

## Running this from Codex

This skill runs on both hosts. In Codex, resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path. Never run bare `slopweaver` on either host — an ambient `PATH` may
point at another checkout.
