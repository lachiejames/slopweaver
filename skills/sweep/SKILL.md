---
name: sweep
description: Find superseded context by the evidence it carries, act on it through the register's own verbs, and journal every act so what was taken stays findable. The automatic half runs as pure code with no model and no tokens; what it cannot decide it reports as UNWITNESSED for a visible session to fan detectives at. Use when a landing, a resync or a board review should prune what no longer earns its keep, when asked "what on the board is stale", "what can we close", "trim the p0 list", or when you want to know what the sweep has already taken and why.
argument-hint: "board [--priority p0] [--probe] [--verdict <name>] [--write [--queue] [--settle-ended] [--close-shipped]] | apply <slug> --session <text> [--reason <the owner's words> --anchor <where>] | list [--slug <slug>] | recheck [--limit <n>]"
---

**Delete by default, with one rail: every act is journalled with its witness, so what the sweep took stays
findable.** The owner's ruling: delete what is not providing value, and be more aggressive about it.

## The one rule that must survive every later edit

**Nothing is ever a delete candidate for being merely OLD.** Age is the proxy `actions/stale` and Linear's
auto-close judge by, and it is wrong about exactly the rows nobody has touched _because_ they are hard. Every
verdict is carried by a witness a reader can re-check without re-running the verb.

## The verbs

```bash
slopweaver sweep board [--priority p0] [--probe] [--verdict <name>] [--deadline <seconds>] [--json] [--write [--queue] [--settle-ended] [--close-shipped]]
slopweaver sweep apply <slug> --session <text> [--why <text>] [--reason "<the owner's words>" --anchor "<where the owner said it>"]
slopweaver sweep list [--slug <slug>] [--json]
slopweaver sweep recheck [--limit <n>] [--json]
```

`board` reads and classifies; it **deletes nothing** bar `--settle-ended`, `--close-shipped` and `--queue`'s own
cards (below), spawns no model and spends no
tokens. Its one read off the machine is GitHub's, one small GraphQL query per distinct pull request a live,
unattended ask's question names (`src/cli/commands/sweep/endedRead.ts`); a failed read leaves that row at the
board's own verdict, printed, never ended. That split is
AGENTS.md rule 2 rather than caution: a hook may not spawn a model, so the automatic half has to be decidable
by pure code. The classifier, the supersession reader and the ledger row are that pure code, in `src/sweep`;
`src/cli/commands/sweep` is the thin verb shell over them.

`board --write` also replaces `$SLOPWEAVER_HOME/live/hygiene/sweep-board.jsonl` with exactly the `--json`
lines for the WHOLE board, whatever stdout carries, and `sweep-board-census.json` beside it with the verdict
census — the `UNWITNESSED` count a reader reports as a number, carrying the sha256 of the finding lines its
own pass wrote, so a reader refuses a census torn from those findings: a partial read — a handover file, run journal, archived
blocker or row text that did not read, probes the `--deadline` cut, a `--verdict`/`--priority` filter, or a
`--dir` other than this home's handovers — publishes neither and fails the run. **A zero-byte file is the clean pass**, not a missing
one: a reader tells "nothing to act on" from "never ran" by the file being there and fresh. A write that
fails fails the run and leaves the previous file standing. The `sweep-board-daily` standing row runs
`sweep board --write --queue --settle-ended --close-shipped`, never `--probe`: a `command:` probe is a doc's own shell string, run unrestricted, so
probing stays a hand choice ([hygiene documents](../automation/reference/hygiene-documents.md)). The Fleet
Briefing's "Nothing stale" section reads that file: a finding still in it counts as KNOWN STALE and the fleet's to
apply, and only an `ORPHANED` row asks the owner ([the reader](../automation/reference/hygiene-documents.md#the-nothing-stale-reader)).

**`--queue` is how the result reaches THE OWNER**, since the owner never opens the document. Once both documents are written
it registers ONE decision card per UTC day, `sweep-board-YYYY-MM-DD`, when the pass found an `UNCARDED` page: card
the pages or leave them (`src/sweep/dailyQueue.ts`). **The question names each page and the row that delivered it**
— the first two, then a count — because a card that names nothing makes the owner open the board to learn what it
asks. A `SHIPPED` row is never carded: `--close-shipped` closes it. Nothing on a clean pass, nothing when
today's card is already on the board, and a registration that fails fails the run. A seat answering that card cards
each page with `handover ask` on the row that delivered it.

**`--queue` also retires the sweep's OWN earlier cards** (`src/sweep/cardRetirement.ts`), each `handover settle --as
answered`, journalled with reason `SWEEP_CARD_RETIRED`: on a pass with no `UNCARDED` page every live
`sweep-board-*` card up to today settles; otherwise every earlier day's does, once today's card registered or was
already there — never when today's registration failed, so the owner is never left with neither. Measured: two
earlier days' cards sat on the owner's Queue a day after the sweep read SHIPPED 0 UNCARDED 0. Re-judged at the
write (`closureSettlePrecondition`), so a card a seat holds is left. Residue: a same-day card is not rewritten when
its page set changes, and the census may count a card retired after publication for one pass.

**`--close-shipped` closes a `SHIPPED` row by itself** — the same owner steer: _"this sounds like it doesn't need a
queue card, no need to ask about landing something i already ruled on"_. Each is `handover close`, the very call
`sweep apply` makes, at most 25 a pass, re-judged under the row's closing lock (`shippedClosePrecondition`,
`src/cli/commands/sweep/shippedClose.ts`): a run that is active, parked or waiting on the owner, a seat dispatched
but not yet started, or a journal that will not read, leaves the row. Every `handover close` gate stands, the uncarded-page gate included. A refused close
that wrote nothing leaves THAT row, printed, and the pass moves on; a verb that wrote and then exited non-zero is
journalled and stops the pass, as does an act no ledger recorded, and either fails the run
(`src/cli/commands/sweep/automaticActs.ts`). Residue: a run
start journalled without the closing lock between the read and the append, and a `cmux spawn` in the seconds before
it journals `dispatched`, are not seen.

**`--settle-ended` takes a card off the owner's Queue by itself** when it reads `PR_ENDED` — an owner steer,
after they dropped by hand a card asking them to close a pull request GitHub had closed the day before. It settles each
`--as answered` on GitHub's witness, at most 25 a pass, one at a time, re-judged at the write — the question
unedited since the read, then nobody on the row (`endedQuestionPrecondition`, `src/review/closureRowState.ts`) —
journalled in the sweep ledger and the autonomy
ledger, and STOPS at the first failure. Then it re-reads the board, so what `--write` publishes is the board after
its acts (`src/cli/commands/sweep/endedSettle.ts`).

## The verdicts, and which of them is an act

| Verdict          | What was found                                                                      | Act                                      |
| ---------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| **CONTRADICTED** | declared done, but its own state disagrees                                          | **none** — a finding to investigate      |
| **SHIPPED**      | a closed journal event, or every declared probe now passing                         | `handover close` (`--close-shipped`)     |
| **PR_ENDED**     | a live ask nobody is on whose question names only ended pull requests ‡             | `handover settle --as answered`          |
| **UNCARDED**     | a CLOSED ask of the owner's delivered a page that never reached the owner's Queue † | **none** — the daily card asks the owner |
| **ORPHANED**     | `blockedBy` reaches a terminal-unshipped prerequisite — it can never run            | `handover settle --as declined` \*       |
| **SUPERSEDED**   | a newer live row **declares** this slug superseded                                  | `handover settle --as declined` \*       |
| **OVERTAKEN**    | a row matching its top-up slug and batch brief has a later slug epoch               | **none** — a person reads it             |
| **UNWITNESSED**  | declares no probe, so nothing here can check it                                     | **none** — needs a detective             |
| **KEEP**         | nothing condemns it, or its probes were not evaluated on this sweep                 | none                                     |

\* **A decline is the owner's alone** (`declineNeedsAnchor`, `src/handover/rowKind.ts`). `apply` refuses these
before anything runs unless it carries the owner's words as `--reason` and where the owner gave them as
`--anchor`, which becomes the settle's witness; the verdict's witness is the evidence the owner decided on and
stays the ledger's. Never write either for the owner — put the row to the owner, as the briefing's "Nothing stale" section does for ORPHANED. A doc row is still
refused by `settle` itself, which ends only asks.

† **The one verdict judged over closed rows** (`src/sweep/uncarded.ts`): an ask with no `origin` whose settlement
witness or artifact is a page, with no question naming it, no ruling, no hand step and no other row's card carrying
it. Measured: nine briefings the owner asked for settled `answered` with `page:<slug>` and never carded.
`handover settle` and `finish` now refuse that closing ([running a run](../handover/reference/running-a-run.md)); this
finds the ones that closed before, and any a hatch let through.

‡ **Only the QUESTION (`summary:`) names its subject, the WHOLE question must ask to close, merge, land or abandon
pull requests, and EVERY pull request it names must have ended** (`src/sweep/endedPullRequest.ts`). An ending answers
"close it?", never "close #A and revert #B?"; any other shape keeps its card. A pull request cited in `stillReal:` or `evidence:` is evidence, and "close #A
as superseded by #B" is still owed while #A is open. A number the question names that no link it carries
accounts for (`#B`, `PR B`, a host in capitals) keeps the row, since GitHub was never asked. Only a `ready` row whose run never started or finished, the
rail `landingClosure.ts` already holds. It cannot see a card whose subject is a local reading or a page, nor a
briefing "superseded" by a later one with no declaration: `sweep recheck` lists those for the morning seat, a few
a day, and [the seat judges them](../automation/reference/queue-recheck.md).

## Three things that look like bugs and are the design

**`apply` never edits a `status:` line.** Owner ruling: derive the state, delete the second
copy. A row's state is derived from its journal, so the act IS `handover close` or `handover settle`, run in
process. Their refusals stand — a second close, or a settle on a row that is not an ask, comes back
`REGISTER_VERB_REFUSED` and the row is untouched — so does a relay row spoken over an open hand card, whose
`--card` disposition `apply` never guesses (the refusal names the card). Read
[derived-row-state.md](../handover/reference/derived-row-state.md) before proposing an edit here.

**SUPERSEDED needs a DECLARATION, never a mention.** A newer live row naming an older slug is usually CITING
it — the older row as its `evidence:` — and a citation is the opposite of a replacement. So a row declares it, in front
matter (`supersedes: <slug>` or `supersedes: [a, b]`) or in prose (`Replaces <slug>`), and the declaring row
must be strictly newer and itself still live. A board where no row declares one reads zero, correctly.
**A top-up GENERATION is OVERTAKEN, never SUPERSEDED** (`<stem>-<owner>-<repo>-<epochMs>`): a row matching
the same top-up slug and repository, with a brief parsing as that family's batch and a larger slug epoch,
settled or not, is an ATTENTION SIGNAL and nothing more. It proves no provenance — `handover register --slug`
can write the same shape with no planner — and no replacement: a planner's batch is gap-limited (alerts with
no open pull request for a vulnerability-fix top-up, open Renovate pull requests the target author does not yet cover for
a bumpfix one), so it may carry none of this row's, and this row may still hold work nobody raised. So the
witness says what matched, never that a row was minted, planned or fired. It is REPORTED, never applied:
the witness says to keep the row if one of its packages is still owed, and otherwise to settle it once nobody
holds it with whichever ending and witness the facts support — `filed`, `answered`, or the owner's `declined` — naming
only the board it read (`--home <home> --dir <dir>`), never a command. Board state can prove neither which
ending is true nor that nobody holds the row: a `cmux spawn` can open a seat before it journals the dispatch.
The time it names is the slug's epoch, never a registration instant. The archive is read too, since a
settled generation is swept there first, and `--as filed` accepts an archived witness. Order is the slug's epoch, never `askedIso` (which `handover quote` can rewrite); both still
need a valid `askedIso`, and both briefs must parse as that family's batch. Only a probe-free row reads it, in
RUN NOW, or PAUSED on exactly `the <recipe-id> recipe's next firing` set before the newer epoch — the board does
not check whether the recipe or a hand `vulnerability-fix topup` made it. A row with an unanswered dispatch takes no
edge. A doc with front-matter problems, or archived under another name, carries no evidence but still counts
against its slug's uniqueness, and a brief naming no single owner/name infers nothing (`src/sweep/supersession.ts`).

**UNWITNESSED and "not evaluated" are different rows.** A row that declares no probe is UNWITNESSED and needs
a detective. A row whose probes the deadline cut the sweep short of reads KEEP with a witness saying to re-run
— `sweep board` prints a banner naming how many. Conflating them once made `--probe` report a hundred MORE
unwitnessed rows than a bare run.

## What the first run actually found, and why it is the finding

MEASURED by the shipped verb against the live board: **814 live rows, 657 UNWITNESSED, 47
CONTRADICTED, 1 SHIPPED, 0 ORPHANED, 0 SUPERSEDED.** On the `p0` cohort: **34 live rows, 29 UNWITNESSED, and
exactly zero a pure-code verdict can act on.** The board grows daily, so a re-run gives different absolute
counts; the SHAPE — four fifths unwitnessed, nothing actable in p0 — is what the numbers are evidence for.

**You cannot sweep what carries no claim.** That is the result, not a shortfall — and it is why trimming a
cohort like p0 is the DETECTIVE half's work, in a visible session, rather than something this verb can do
alone. Reproduce both numbers with `slopweaver sweep board` and `slopweaver sweep board --priority p0`.

## Acting on one

```bash
slopweaver sweep board --priority p0 --verdict SHIPPED
slopweaver sweep apply <slug> --session "workspace:151" --why "<anything the witness does not say>"
slopweaver sweep apply <orphaned-ask> --session "workspace:151" --reason "<the owner's words>" --anchor "<permalink>"
slopweaver sweep list --slug <slug>
```

The register verb runs first and the ledger row is written after it succeeds, so there is exactly one window
where an act can land unrecorded — an unwritable ledger. On that path `apply` exits non-zero and **PRINTS the
row it could not write**, because the act has already happened and that row is the only surviving record of
what was taken and on what evidence. Re-record it by hand rather than re-running the verb.

One row at a time, and there is deliberately **no `--all`**: a wrong verdict applied to one row is a
correction, and applied to a cohort it is an incident. Adding one later would be the change that quietly
removes that property. The bounded exceptions are three, each because its witness is a record rather than a
judgement, and each capped, serial, re-judged at the write and journalled: `--settle-ended` (GitHub's record,
stopped by the first failure), `--close-shipped` (the row's own journal or probes, landing the owner already ruled on) and
`--queue`'s retirement of the sweep's own cards (a later reading of the same board).

## What this does NOT cover yet

The board leg only. The published page proposed six surfaces — skills, docs, the board, the fleet briefing
form, memory and the state home — and canon has no `askedIso` and no slug, so **the retirement register is
still owed** before a canon leg can mean anything. Say so rather than implying the sweep already covers prose.
