---
name: cycle
description: Propose which tickets in your current Linear cycle should be closed and which projects you lead are overdue a status update, each carrying the evidence that decided it, answerable one word at a time. Use when the user asks what in their cycle is stale or dead, which tickets should be closed, why a ticket has been sitting for weeks, whether a project update is overdue, or asks for the daily cycle-hygiene card. Phrases like "what's rotting in my cycle", "what should I close", "is my cycle honest", "do I owe a project update".
argument-hint: reconcile [--json | --form] [--verify] [--post --dry-run] [--write] [--now <iso>]
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" cycle $ARGUMENTS` and report the result.

Everything below is judgement the CLI cannot express. Read it before your first invocation.

## It proposes. It never writes to Linear, GitHub or Slack.

The verb performs no Linear mutation and sends no Slack message, and its own JSON asserts that (`wrote:
false`, `proposalsOnly: true`) so a probe can check the property rather than trust this sentence. Every
action is a separate, explicitly-invoked door call the owner asked for by answering a line.

`--write` is the one local write: it publishes the `--json` report, byte for byte, to
`$SLOPWEAVER_HOME/live/hygiene/cycle-reconcile.json`, whatever stdout carries. The `linear-briefing-daily`
standing row runs it that way, with `--verify`, so a reader opens a file rather than a transcript
([hygiene documents](../automation/reference/hygiene-documents.md)).

The rail that survives every later change: **never close or comment on another person's ticket without their
word.** A ticket assigned to somebody else is their move, not a row on this card.

## The two classes, and why they are not one

- **`close-with-comment`** — the work provably shipped. Either an attached pull request is MERGED while the
  ticket is still open, or the ticket sits in `Merged`, a workflow state that means done whose Linear state
  TYPE is not `completed`, so every naive filter counts it as live work.

  **`Duplicate` is deliberately NOT in that set** (owner ruling). Its state type is `duplicate`,
  a third type beside `completed` and `canceled`, and a duplicate is already where it belongs: there is no
  further move to offer. Proposing a close on one offered the single action the owner had explicitly ruled
  out — marking it done, when the underlying ticket is not done — on a row that could then never leave the list. It is
  counted as settled rather than proposed.

- **`trace`** — something is wrong and the evidence does not say what. Propose a LOOK, never a close.

Keeping them apart is the whole design. Measured on the real corpus: of 30 stale current-cycle
items, 20 had every attached pull request CLOSED and unmerged, and **eleven of those were closed inside one
32-second window** by a bulk cleanup that touched no ticket. A closed pull request proves somebody closed a
pull request. It never proves the work happened.

## Run `--verify` before acting on a close

The default reads only the local corpus, which is fast and incomplete: measured on the real home, only 15 of
the 25 pull requests attached to the owner's stale tickets were in GitHub bronze. Those ten get a third,
honest verdict — the state is UNKNOWN here rather than absent — and `--verify` reads exactly those, live,
through the door, bounded to the tickets the card can actually mention.

Without it the card is true but vague. With it, four of those ten resolve to straight closes. An
unresolvable reference is a gap in what was looked at, never an absence in the world.

**`--verify` re-reads the overdue projects too, and there it prevents a duplicate rather than sharpening a
verdict.** Bronze knows a status update only once a refresh has walked its project — the projects lane now
selects a project whose updates moved, and the pass folds in the standalone update records — so an update
posted after the cursor is still invisible to a plain pass (measured: three projects updated after the watermark
were still proposed an hour later). A verified pass reads each named project's
`projectUpdates` connection live and DROPS the ones already updated. Dropped, not annotated: an annotated
row still carries `post`. A live read only moves a last update forward. A project whose updates it could not
read stays on bronze and is counted on the `could not see` line, never reported as never updated — reading an object document with no updates selected once
overwrote a correct history with an empty one.

## A `Merged` ticket waits for a release

The owner's ruling: the job that moves tickets from `Merged` to `Done` in Linear only runs around release
time, so generally most of these should be handled automatically, without the team's intervention. A ticket
that merged an hour ago and still sits in `Merged` is that job's work, not the owner's, and
proposing a close on it is the `already-done` friction this card exists to remove.

So a `Merged` ticket is proposed only once its own repository has shipped a release since it merged, and the
row says which of the two reasons it qualified under. A repository that publishes no releases at all is
NOT held back, because silence there would hide its tickets forever. Held-back tickets are counted on the
report's own `could not see` lines rather than vanishing, and the count and the rows come from one predicate
so they cannot disagree. Measured over the 119 tickets standing in `Merged`: 25 held back,
82 shipped-since, 12 with no release history.

## Applying a proposal, and the one rail that does not move

**A close is applied with `slopweaver linear issue update --fields-only`, and that works on a hand-filed
ticket** (owner ruling). The ownership ledger gates a body replacement, not a field change:
fields-only sends neither `description` nor `title`, so it cannot reach a word anybody wrote or rename the
ticket, and it does not ask whether slopweaver filed the ticket.

**A move to the backlog is all three of a state, a cycle removal and an unassign** (owner ruling:
Backlog always means ALL of move to Backlog state, remove from the cycle, unassign). One
fields-only form carries the lot — `stateId` to the team's backlog state, `"cycleId": null`, and
`"assignee": null`. Doing only the state leaves the ticket in the owner's cycle and on the owner's name, which is the
deviation the whole verb exists to remove, so a partial move is worse than none.

A full `update`, which replaces the body, refuses any issue slopweaver did not create. Do not route
around either guard with raw GraphQL or an MCP tool.

**A `project-update` proposal is applied with `slopweaver linear project-update create`** — a status report
posted to the project, not an edit of it. Health is required (`onTrack`/`atRisk`/`offTrack`). **Put the proposal's `movedAtIso` in
`fields.overdueSince`**: the id is then keyed by the project and that window, not the freshly drafted body,
so the same proposal cannot be answered twice however it is reworded. Note the name
collision Linear itself has: `linear project update` edits the project; `linear project-update create` is the
one that posts the report. The daily `linear-briefing-daily` row proposes each overdue update, with every other
Linear write, on one card for the owner's yes ([linear-briefing](../automation/reference/linear-briefing.md)).

**The rail that survives every one of these: it PROPOSES.** Nothing moves until the owner answers, and it never
closes or comments on another person's ticket without their word.

## Posting the card

The verb composes; `slopweaver slack post` sends.

Emit the form with `--form` and pipe it into `slopweaver slack post`, whose own bot-card flags the
[slack skill](../slack/SKILL.md) documents. `--post` without `--dry-run` is refused by the parser for that
reason, so there is one door rather than two.

The DIGEST card's layout is derived, so its voice is gated rather than reviewed: `derived-card-voice` runs
`digestToUpdate` over the registry's own digest fixture on every `pre-push` and reads the result with the
operator's real rules, which is what finds an em dash like `— owner:`. Never reach for the `voice-rules` hatch to get past a refusal — fix the
layout, which is the one place the sentence is composed.

## Habits

- **`--now <iso>` for anything reproducible.** The pass judges staleness against the cycle boundary, so a
  replay or a test without a pinned instant reports a different answer tomorrow.
- **Read the evidence before you relay a proposal.** Each one carries the URL that decided it; a proposal
  repeated without its evidence is the assertion this verb exists to replace.
- **Never lift a `stateId` from the corpus** when applying a close — run `slopweaver linear states --team
<key>`, for the reason the `linear` skill gives.
