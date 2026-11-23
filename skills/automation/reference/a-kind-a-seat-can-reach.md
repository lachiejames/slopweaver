# A kind a seat can reach

Why a managed resync row's kind is derived from the build on every write rather than chosen by a flag, and
what `automation due` prints when a row is unreachable anyway.

## The rule

`slopweaver automation register-resyncs` writes every row it owns on the kind its TARGET needs, read from the
build at the moment of the write: `resync` (`RESYNC_KIND` in `src/live/automation/kinds.ts`) for a target that
walks a provider, and `verb-run` for a COMPILE-ONLY atlas — at least one filled surface, every one of them
`acquisition: "compiled"` (`isCompileOnlyDescriptor`, `src/atlas/kit/contract.ts`). That atlas presents
no credential, drives no browser and needs no model — braze and gemini-ai-studio do re-fetch PUBLIC vendor
documents — and a pass takes seconds once cached (braze's first, cold, took 2m32s), so it runs in the chair's
own tick with no seat. There is no flag to type, no install-scoped state and nothing to
remember. A row that a hand repair, a deletion or a reinstall recreated on the other managed kind is
REPAIRED on the next ordinary pass, by a verb that already runs at every decision point,
and a descriptor that starts walking a provider moves its row back to the seat the same way.

`automation seat` takes the kinds `src/live/automation/definitionShape.ts` answers `spawn` for — `resync`,
minutes of provider walking the chair must not sit through, `hygiene-sweep`
([§ A hygiene-sweep row](../SKILL.md#a-hygiene-sweep-row)), `bump-fix` ([bump-fix](bump-fix.md)) and the other
seated kinds [the skill](../SKILL.md) lists. Every other kind answers `run-here` (a `datadog-alert-digest` row
with shots is the one per-row exception), and `src/cli/commands/automation/seat.ts` seats `shape === "spawn"` rows
only. A managed resync row on any other kind therefore runs nowhere, however late it gets.

## The failure it was written from

MEASURED, with a `--to-seat` flag deciding the kind and defaulting to `verb-run`. A hand
repair moved all 44 rows to `$SLOPWEAVER_HOME/live/recipe/definitions-pre-resync-repair-<date>/` and
re-ran `register-resyncs`; with the files absent, the plan saw a CREATE rather than an update, the default
applied, and every row came back on `verb-run` in one command.

The install then read:

```text
43 actionable · 0 want a session · 0 claimed · 66 row(s) read
```

Every number there is what a healthy install with nothing due also reads. Behind it, 43 rows sat 2.2 hours
late with 4 to 19 firings missed each, and 38 of them had never recorded a single attempt. The rows existed,
parsed, were due and were actionable, so nothing on the tally could say otherwise.

Reproduce the shape of it:

```bash
slopweaver automation due | tail -1
grep -ho '"kind": "[^"]*"' "$SLOPWEAVER_HOME"/live/recipe/definitions/resync-*.json | sort | uniq -c
```

**Never ask a doc whether this install's rows are on a seated kind. Read the count.** A doc asserting it is
true on the day it is written and a confident lie afterwards.

## The line `automation due` prints

`src/live/automation/strandedResync.ts` answers one question per row: does its argv run `automation resync` while the
row's shape is not `spawn`, and it is not exactly a tick row this build writes — a `verb-run` row on a tick
id whose argv runs that id's own atlas? It asks the shape rather than naming `resync`, so a second seated
kind never reads as stranded; and the tick exemption checks kind, id AND target, so an `investigate` row on a
tick id is stranded, and so is a tick id edited to run a seated atlas's walk. Rows that fail are
STRANDED, and `dueAskLines` prints them above every other line with the count repeated on the tally as
`N STRANDED`:

```text
!! 43 row(s) run `automation resync` on a kind no seat picks up (e.g. resync-atlas-airtable), so `automation seat`
can never reach them however late they get — repair with `slopweaver automation register-resyncs`
```

It sits above a late row for the same reason a DELETED row does: the tally reads healthy while it is true. It
sits BELOW a missing declared row, because a row that does not exist at all is strictly worse than one that
exists and cannot be seated.

**It is a `automation due` line and not a monitor card by construction.** `src/monitor/registry.ts` carries
alert-only monitors over a live service; this is a property of local state that a pass already reads, and a
card for it would be a second surface saying what the verb in front of the reader already says.

**A hand-edited kind is stranded on the same criterion, deliberately.** The row still runs a resync and still
cannot be seated, so the line names it. `register-resyncs` then REPORTS it as a conflict rather than
rewriting somebody's edit, which is the next step a reader needs and not a contradiction of the line.
