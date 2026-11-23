# Reading the board without mistaking silence for an empty board

`slopweaver handover list` is the ONLY register of what is in flight, which makes one failure mode more
expensive than anything else it could do wrong: printing nothing. A board that says nothing reads as a board
with nothing on it, and the reader cannot tell the two apart.

## What went wrong, measured

MEASURED on the owner's own board, reproducing an earlier finding at a larger size:

|                                 |                              |
| ------------------------------- | ---------------------------- |
| Docs on the board               | 1,389 (the finding saw ~250) |
| Wall time, complete run         | **474 s**                    |
| Bytes on stdout at 7 minutes in | **0**                        |
| Bytes on stderr at 7 minutes in | **0**                        |

So a caller with any sane timeout was killed before the first byte and read an empty board. It was never a
hang and never a silent verb — it was a verb that did twelve minutes of work before saying anything at all.

**Where the time went**, from a phase profile of the same run:

| Phase                       | Time        |
| --------------------------- | ----------- |
| `commitsAhead` (per doc)    | **501.1 s** |
| Scanning 1,389 docs         | 5.9 s       |
| Reading 1,389 journals      | 3.1 s       |
| Commits-behind, 5 repos     | 2.1 s       |
| Evaluating probes, 567 docs | 0.8 s       |
| Everything else             | < 0.5 s     |

97.6% of the verb was one function. `commitsAhead` resolved the repository's trunk (a `symbolic-ref` plus up
to two `rev-parse`) and then ran one `rev-list --count` per candidate branch — **per doc**, over five
repositories whose answers do not change between docs.

## The two halves of the fix

**One `for-each-ref` per repository, not five `rev-list`s per doc.** `repoAheadIndex`
(`src/handover/evaluate.ts`) asks git for every ref's `%(ahead-behind:<trunk>)` in a single call and
`aheadFromIndex` reads counts out of it. The lookup transcribes `gitrevisions`' own precedence —
`refs/<name>`, then tags, then heads, then remotes — because `rev-list main..atlas` prefers a TAG named
`atlas` over a branch of that name, and an index that guessed heads-first would answer a different number on
the one repository carrying both. `%(ahead-behind:…)` needs git 2.41; an older git fails the whole
invocation, so `byRef` is `undefined` there and the per-candidate `rev-list` runs instead.

**A deadline that PRINTS rather than a timeout that does not.** The probe sweep runs under
`--deadline <seconds>` (default 60, `0` removes it). When it expires the board still renders, above a loud
`⚠ TRUNCATED` banner on **stdout** naming how many probe-carrying docs went unresolved and saying that those
rows fall back to their authored status. Stdout, not stderr, deliberately: a truncated board is a caveat on
the board's own content, not a diagnostic about how it was produced, and a reader piping to a file must not
lose it. Progress lines go to stderr from the first moment, before any disk work, so `… | wc -l` still sees
only the board.

## The proof

Old code and new code, run against the SAME frozen copy of a 1,389-doc board:

|                   | Old         | New                             |
| ----------------- | ----------- | ------------------------------- |
| Wall time         | 431 s       | **17 s**                        |
| Board             | 2,279 lines | 2,279 lines, **byte-identical** |
| First stderr byte | never       | immediately                     |

Reproduce the shape on any board:

```bash
time slopweaver handover list | wc -l          # the whole verb, and what it printed
slopweaver handover list --deadline 1          # the truncation banner, fired on purpose
```

The banner is a falsifiable witness rather than an absence: it does NOT appear on a complete run and DOES
appear under `--deadline 1`, which is how you check the guard can still fire.

## The board's OTHER failure mode: a printed row that is already done

A complete board that prints every row it has is still wrong if those rows are not live work, and this
failure mode is quieter than the empty board above because it looks like an answer.

**MEASURED.** A steers page ranked 121 p0 rows as "waiting" and offered
them to the owner as the fleet's queue. **113 of them carry `settlement: answered`, and 111 of those were
already settled on disk before that page was published.** The queue the owner was handed was ~92% finished
work: a board with that much stale in it is aggressively pruned of anything that does not earn its keep before
it is used.

The cause is not stale rows. It is that a cheap reader filtered on the `status:` LINE, which nothing has ever
written — the exact defect [derived-row-state.md](derived-row-state.md) already measured at 25 rows
and then 60. Any reader that skips the derivation brings it back.

```bash
slopweaver handover prune --priority p0      # the TRIMMED board — survivors, with why each survived
slopweaver handover prune --verdicts         # every pruned row and the witness that pruned it
slopweaver handover prune --json             # the whole pass, for a composer
```

The first run of the first of those: **183 p0 rows read, 28 survive** — 151 already settled, 3
shipped with no settlement, 1 day-scope candidate. Every survivor prints why it survived, so a reader can
attack the reason rather than trusting the count.

**Three verdicts are conclusive and two are candidates, and they are different TYPES rather than a confidence
score.** `settled` (the register already decided; nothing to perform), `shipped-unsettled` (a `closed`
event with no settlement — the ask row never got the terminal that takes it off) and `relay-taken-up` (a voice
relay row with a row cut from it, filed into that row; one whose words landed on an `ask:` card, filed into that ask
once its row shows a run event or settlement since the relay registered; or an intake mark on its `talk:<turnId>`,
answered — 252 at the first run; `intake-mark` and `register` settle it at the act, and `handover start`/`settle` on the
ask file its answer relays, `src/handover/relayTakenUp.ts`; a relay spoken over a card answers on a mark only once
the owner's words are a ruling on that card or a seat was dispatched on the relay row, else it stays) come off the register.
`expired-day-scope` and `duplicate-sibling` come off the slug, and neither may ever be acted on
automatically: a slug such as `ten-more-vulnerability-prs-<day>` and one such as
`people-waiting-on-owner-<day>-and-every-open-ask` are syntactically indistinguishable — both name a
day, both were asked on that day — while the first is day-STAMPED and still deliverable and the second is
day-SCOPED and not. Only a session can tell, so the rule computes the candidate and never the act.

**Two rails sit above every rule.** A row the owner RULED on survives whatever the slug says, and a row paused on a
person survives because a pause is a state rather than a countdown. Both print the rail as their reason.

**`prune` never writes.** Each performable verdict prints the `slopweaver handover settle …` command,
because `settle` asks the lessons gate and the checks-read gate before it writes and a pruner splicing the
front-matter itself would bypass both. It is not always the whole command: a relay row spoken over an open
hand card also needs `--card`, which prune never guesses — `settle` refuses and names the card
([settle-card.md](settle-card.md)). The mechanics: `src/handover/prune.ts`.

## The board's THIRD failure mode: a row that contradicts and cannot say why

A CONTRADICTION is the loudest thing the board prints, so it has to be checkable. Every probe-derived one
prints the same sentence — _"declared done, but the repository currently shows its probes failing or
partial"_ — and on its own that collapses three readings: a probe that was checked and FAILED, a probe that
was never evaluated at all, and a row whose contradiction has nothing to do with probes.

**MEASURED on the live board this session: 51 rows in CONTRADICTION**, thirty-odd of them printing that one
sentence. And `slack-reply-count-oracle-implementation` was hand-checked against the main checkout
with BOTH its probes' symbols present, while the board reported it contradicting — two readings
the tool offered no way to reconcile.

Each row carries its probe evidence beneath it (`contradictionDetail`, `src/handover/boardState.ts`):

```text
  a-contradicting-row           declared done, but the repository currently shows its probes failing or partial
      ✘ fail          src/handover/probe.ts does not contain `codeBearing`
      – not evaluated command not evaluated — pass --probe to run it: yarn lint
```

Three rules, and the last is the one that closes the measured case:

- **The outcome is spelled as a WORD, not only as its glyph.** `–` is exactly what made "nothing looked"
  read as a quieter failure. `not-evaluated` is a first-class `ProbeOutcome` — a `command:` probe with no
  `--probe` runner, or a file nothing could read — and it must never be mistaken for a verdict.
- **Passes are printed too.** A reader reconciling "I checked both by hand and they pass" has to see the
  tool agreeing about the passes before the failures mean anything.
- **When nothing failed, the row says so and points at its reason** — `every probe PASSES — read the row's
reason above for what disagrees`, or a count of what was never evaluated. It stops at what the probes
  observed and claims NO origin, because a passing probe is sometimes the contradiction itself: a
  `cancelled`, `rejected` or `draft` row whose probes all pass is contradicted BY the repository, so "the
  disagreement is with the authored status, not with a probe" is false on exactly that row. Naming the rule that fired would mean
  re-deriving placement in the renderer's input, which `boardState.ts`'s own header forbids.

## A waiting run whose doc left the board

The board is built from `handovers/*.md`, so a run that recorded a question and then had its doc archived,
renamed or deleted by hand would be on NO surface: no row, no Queue card. `handover list` sweeps every journal in `runs/` that no
readable board doc claims (`src/cli/commands/handover/listRecovery.ts`; the pure half and the measurement are in
`src/handover/detachedAsk.ts`), and each one whose current cycle is waiting on the owner lands in one of three places:

- **Its doc is in `handovers/archive/`**, under its own name or any other `.md` name (matched by the slug it carries; the
  archive is read whole only when the exact paths do not yield it) — composed as an ordinary row, so it reaches the
  Queue, and kept only while `ownerWait` is not `settled`: a `done` doc or a `settlement:` ask has nothing to
  show. It composes in a pass of its OWN (`recoveredModels`), so every board row places exactly as it would
  without it — in the board's pass it would change which `blockedBy` slugs read as done. It is never PROBED,
  and it never joins the collision, stale-repository or `--json` origin-read passes, which describe live work
  and share its deadline.
- **Its doc is gone from both** — published under `detachedAsks` on `--json`, outside `rows` and never narrowed
  by `--tag`, and printed under the board as `WAITING ON OWNER, NO DOC ON THE BOARD` with the one remedy that
  fits: restore the doc, or `handover abandon <slug> --why "<why>"`. The Queue draws it as an ask card
  (`site/lib/detachedAskRow.ts`).
- **Its doc would not read**, or any board doc would not read (that one could carry the slug) — the same
  section, saying REPAIR. Abandon is offered only when absence is proven.

A journal no doc claims that will not decode whole is listed under `unreadJournals` rather than skipped. One
residue is stated rather than discovered: `handover answer` finds its run through a board doc, so the
owner's answer to a missing-doc ask is applied by restoring the doc or ending the run. A question asked after its row was settled: [settled-then-asked](settled-then-asked.md).

## The read is fast — do not build a probe cache

A standing hypothesis says the board should cache probe evaluation by `(doc hash, main sha)`. **Re-measured,
and it should not**: `slopweaver handover list` over **2,639 docs (695 carrying probes)** took
**9.51 s real, 6.26 s user, 5.57 s sys, exit 0**. The doc that raised it measured 175.78 s at 458 docs —
5.7x the docs at roughly a eighteenth of the wall time, because the `for-each-ref` index above removed the
per-doc git cost the hypothesis pointed at. Reproduce with `time slopweaver handover list > /dev/null`, and
state the doc count with any number you report.

`handover alignment-board --json` is a caller-only placement read for the console's Alignment count, never a substitute for `handover list`: no summary, question or card field. It serves `$SLOPWEAVER_HOME/alignment-board.json` (`servedFrom: "cache"`), which a whole default `list` refreshes, or rebuilds it from the board (`"live"`) when that rebuild is whole, else exits non-zero, never empty or partial ([area-handover](../../../.claude/rules/area-handover.md)).

## Steers: the board's call-anchored rows, joined to main

`slopweaver handover steers [--json]` lists every steer the owner gave on a call — a row anchored to a call turn, a
relay a run was started on, or an unanchored row naming a `turn_` id — and whether a PR from its branch, or its
settlement witness, landed on its repository's main. The console's Alignment page draws it in its steers section, and charts each week's
steers from it: a row's `askedIso` as the first time, each `againIsos` entry (one per further steer folded onto
the row, `null` where its words do not read) as a time the owner said it again. A steer registered
without `--anchor` shows flagged, and a repository, journal or PR-ledger record that would not read is printed
as a count rather than read as not landed.
