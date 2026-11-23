# `steer-at-risk`: a deliverable the owner explicitly steered, at risk, the minute it is known

The owner's ruling: a steered deliverable at risk gets a floating note AND a voice cut-in the minute it is
known, never at the deadline. Why, and the SUP-4293 case it was built from:
[explicit steer](../../../docs/doctrine-rationale/explicit-steer.md). Declared in `src/monitor/steerAtRisk.ts`,
judged by `src/handover/steerRisk.ts`.

- **What it reads** (`src/monitor/steerAtRiskSource.ts`). Every run journal under `$SLOPWEAVER_HOME/runs/`
  carrying a `ruling` with an `explicitSteer` — written only by `handover rule <slug> --explicit-steer
[--deliver-by <iso>]` — judged against its row document. A row with no such ruling is never read.
- **What trips it**, one reason per row, the first that stands:
  - a seat named the risk, `handover risk <slug> --why "<the uncertainty>"` (`--clear` takes it back);
  - a question to the owner is open on the row and `ownerWaitOf` calls it the owner's — the verdict the owner's Queue draws the ask card
    off; one a later ruling answered, or on a paused row, has no card, so it reads as a park. A registered ask with
    no run that `registeredAskOf` lists, declaring no `blockedBy`, is the owner's the same way;
  - the seat parked on a clock, or with no wake at all — a park on its own CI is work in motion, and is not;
  - the run was abandoned, or its seat died (orphaned);
  - the `--deliver-by` instant passed with the run not finished.
- **Clears when** the reason clears — the risk cleared, the owner's question answered, a seat open on the row again —
  or the row ships, settles or finishes, or a later ordinary ruling replaces the steer.

## A notice, raised the moment it is known

The note is a NOTICE, never `stopsWork`. It draws in front of every note already up, with a later note cascading
below it and its title still showing; nothing already up closes for it. It says what is true about who waits (a vulnerability-fix postmortem showed why):

- **On the owner's question**, leading or standing behind a named risk, it opens "waiting on you:", the question, then
  "answer it on your Queue" — the question cut before the Queue clause ever is — and its no-link line says the same.
  The owner's question and the park it becomes once answered or paused carry their own identities, and a question behind
  the lead joins the key, so asking or answering it re-cuts the note: a note's id is cut from its key, and the old
  one departs and settles. It carries no link: the question's own ask card is on the Queue, and a note opening
  `ask:<slug>` could absorb it.
- **Otherwise** it opens `nothing waits on you — <the reason>`, and its no-link line claims nothing of the fleet: a
  parked row's reason says nobody is on it.

The voice reads the reason back with `steerRiskReasonOf`, beside the writer, so it says the whole waiting line too.
One note per row, keyed on the slug and the reason's identity: a changed reason — a second park after a reseat — is
a new note, and one the owner closed is held while that same reason stands.

## Raised three ways, so no clock is waited on

- **In-process, at once**, when `handover park`, `ask`, `risk`, `rule --explicit-steer` or an orphaning writes the
  line that put the row at risk, or `session close-done` parks an idle seat on a steered row
  (`src/cli/commands/handover/steerRiskCard.ts`). The pass reports on the HOST verb's stderr (`hostedPassDeps`), so
  `close-done --json`'s stdout stays one document.
- **At every `supervisor tick open`**, FIRED after `profile-unloaded` (`monitor check --only steer-at-risk --fire`,
  reading `steer-at-risk`). `tick close` refuses a tick that read one with its note down, or could not read the
  set — the `unescalated-steer-risk` hatch (`src/cli/commands/supervisor/steerRiskRead.ts`). Two rows at risk are
  two notes, stacked, and each one is owed.
- **Said on a live call.** The console asks `/api/talk/call/<id>/steer-risk` on a short cadence and the server
  reads the OPEN steer notes itself (`slopweaver talk steer-risk`), so the voice names exactly what the owner's screen
  does and never one the owner answered (Done, Later, a running snooze). It is the one window notice that cuts in over the owner's speech and a running
  turn, held only by the server's own writes, the owner's typed turn being handed in included (`site/lib/steerRiskWatch.ts`); the voice remembers what it said per console process, so a restart may
  say one note twice.
