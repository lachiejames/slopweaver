# Waiting on a person — the `paused` row

A workstream waiting on somebody else is neither in flight nor finished, and the board needs a way to say so.

## Why

There are many times a reply does not come in a timely manner, but the work should still be remembered: people are
busy and what we build accounts for that. So no time limit, no deadline — just a work stream that is useful but
paused on someone else.

## What was measured

`DocStatus` was `draft|ready|in-progress|done|cancelled|rejected|unknown`. `done` takes a row off the board,
`blocked` parses to `unknown`, so the only spelling left for "waiting on somebody" was `in-progress` plus a
`blockedBy:` entry naming a PERSON — and `blockedBy:` resolves SLUGS. The board printed _"blockedBy names
\<a sentence about a human\>, which no doc on the board claims"_ under `NOT YET`, and the consistency grader
called the pair a `transition`. The row read as a typo and as work mid-flight, and it was neither.

## Why `paused` is a status when `blocked` is refused as one

`blocked` is refused because it is DERIVED: `blockedBy:` already decides it, so declaring it too would be a
second source of the same fact, and the first time the two disagreed nobody could say which was right.

A pause fails that objection on its own terms. **Nothing else on a doc carries who a row waits on.** A person
is not a slug, so `blockedBy:` cannot hold one without lying to every reader that resolves it; nothing derives
a pause; so the doc has to declare it. A declared fact with exactly one source is what a status is for.

## The verbs

```bash
slopweaver handover pause <slug> --on "<who>" [--why "<what is being waited for>"] [--since <iso>]
slopweaver handover unpause <slug> [--status ready|in-progress] [--why "<what unblocked it>"]
```

`pause` writes three fields together — `status: paused`, `pausedOn:`, `pausedSince:` — and `--why` goes to
`statusSummary:`. `unpause` clears both pause fields and puts the row back on `ready` or `in-progress`.

**Never hand-write them.** `--on` is required for the same reason a settlement needs a witness: "paused" with
nobody named is unfalsifiable parking. A `paused` row with no `pausedOn:`, or a
`pausedOn:` beside any other status, is reported as a doc PROBLEM, so the row lands in `CONTRADICTION` rather
than quietly disappearing into a state nobody can act on. A row paused on the owner names the owner by
role, `--on "the owner"`: that role is the subject the Queue's stopping section reads as the owner's
(`site/lib/workstreams.ts`'s `isOnOwner`), and the owner's own name is installation state the console never holds.
So `pause` writes the stored role word, `owner`, when `--on` names the owner by any name the install records (the
store's owner row, and the owner's identity roster entry) or by either spelling of that role word; a row an older
build paused under the pronoun spelling still reads as the owner's on every surface. When the store or `profile.json` does not answer, the subject is written as passed and
stderr says why; the check never stops a pause (`src/handover/pauseSubject.ts`).

## Nothing counts

There is no `pausedUntil:`, no cadence, no reminder and no elapsed arithmetic anywhere in the feature.
`pausedSince:` is provenance — printed verbatim, never subtracted from — because a day-count reads as a
countdown and a countdown is the thing the owner ruled out. The board remembers; a clock does not get to decide a row
has expired.

**The row keeps no clock; the thread it waits in does.** With no reply for a while, specific people get tagged with
specific questions to drive engagement, and a wait never slips unless that is intentional. So a Slack thread whose last human word is the owner's ask earns ONE tagged chase after two
business days of quiet (the owner's drops since set the wait) — a draft parked for the owner's yes by [thread-chase](../../automation/reference/thread-chase.md), never
a send, and never a change to this row.

## Where a paused row appears, and what refuses it

- **`handover list`** prints it under `PAUSED`, between `IN FLIGHT` and `AWAITING SHIP`. It is LIVE, so
  `--all` is never needed to see it — that flag is for terminal rows.
- **`session-start`** prints it below the ranked list, unnumbered. It is never ranked as THE OWNER'S move:
  another person's silence must not head the owner's morning list.
- **`handover start` and `cmux spawn` REFUSE it**, by name, saying who it waits on. Unpausing is a decision
  somebody types, never a side effect of typing the slug.
- **An open run outranks it.** A row whose journal shows an active run, or a recorded question, places under
  `IN FLIGHT`/`WAITING ON OWNER` instead — somebody is inside the work, and the owner's own move never files behind
  somebody else's silence.
- **Probes outrank it too.** A paused row whose `doneWhen:` probes all pass reads `LOOKS SHIPPED`: the work
  may have landed anyway while nobody was pushing it, and that is worth confirming.

## Where the code is

`src/handover/paused.ts` holds the rules and the one renderer every surface prints through;
`src/handover/doc.ts` parses the fields and reports the defects; `src/handover/boardEvidence.ts` places the
row;
`src/cli/commands/handover/pauseRun.ts` is the only sanctioned writer.
