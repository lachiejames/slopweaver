# Hygiene documents — what the hygiene rows publish, for a reader that never re-runs them

Three standing rows (the [morning two](declared-rows.md#the-two-morning-hygiene-rows) and `linear-briefing-daily`) publish four documents
under `$SLOPWEAVER_HOME/live/hygiene/` — one each, and the board row a second beside its first. A reader — a briefing, a supervisor pass, the seated
session — opens the file. It never scrapes a transcript, and never reads the generic readings ledger that
`--record-reading` appends to: that ledger is audit history, and its newest entry is not this document.

Paths resolve through `stateHomePaths({ home }).live.hygiene` (`src/live/hygiene/paths.ts`); never join them
by hand.

## The four documents

| File                      | Producer                                                                 | Format                                                            |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `cycle-reconcile.json`    | `cycle reconcile --write` (`linear-briefing-daily`)                      | the verb's `--json` report, one pretty-printed document           |
| `sweep-board.jsonl`       | `sweep board --write --queue --settle-ended --close-shipped` (daily row) | the verb's `--json` lines: one finding per line                   |
| `sweep-board-census.json` | the same `sweep board --write` pass                                      | the verdict census of the whole board, and its findings' sha256   |
| `github-landing.json`     | `automation run-due` over the `hygiene-sweep` row, seated                | `github landing --json`'s one `kind: "read"` document, as printed |

The census exists because the JSONL holds only the findings, never the count of rows no witness can decide —
and a count that lives only on a terminal is one no later reader can report (`src/sweep/census.ts`). Each other
file is exactly what that verb's `--json` prints, plus one terminal newline per document or line —
the file and stdout come from the same serialiser, so they cannot disagree. `--write` never changes what
stdout carries: `cycle reconcile --write` still prints the human card unless `--json` asks otherwise.

**The board sweep's result also reaches THE OWNER, not only a reader.** A document is read by the briefing and the owner
does not visit boards, so `sweep-board-daily`'s `--queue` registers one Queue card a UTC day,
`sweep-board-YYYY-MM-DD`, after both board documents are written, when the pass found an `UNCARDED` page (a closed
ask of the owner's whose page never reached the owner's Queue), naming each page and its row ([sweep](../../sweep/SKILL.md)). A pass
with no such page registers nothing, and settles the sweep's own earlier cards. Before either document is written,
its `--settle-ended` settles every live ask whose question names only pull requests GitHub reports merged or closed
(`PR_ENDED`), and its `--close-shipped` closes every `SHIPPED` row, so both documents describe the board after those
acts and neither kind of row ever reaches the owner's Queue.

## How a document is replaced

**Whole and atomic, or not at all** (`src/live/hygiene/reportStore.ts`). A reader sees the previous document
or the new one, never half of either. A producer that fails — a verb exiting non-zero, a landing read that
printed no document, two documents or a skipped tick, a write the filesystem refused — leaves the previous
document exactly as it was and exits non-zero, which is never a success stamp: the row is HELD on one p1
`recipe-failing-*` finding until its fix lands ([the failure hold](holds.md#a-failure-hold--placed-by-the-store-lifted-by-the-fix)),
the shared contract every recipe row keeps. A failed morning therefore
never erases yesterday's usable document, and never passes for a clean one.

**A partial read publishes only when the document itself says where it is partial.** A landing row whose
own sub-read failed carries `dispatch.kind: "unread"` naming why, and the cycle report carries `couldNotSee`,
so each is published: yesterday's packet is staler than today's named gap. A `sweep-board.jsonl` line carries
no such marker, so a partial board is refused outright rather than published looking whole — and the census
with it: a partial read writes NEITHER board document, so the two always describe the same pass.

Owner-only: `0700` directory, `0600` file. A landing packet names people, pull requests and review threads.

## What empty means

- **`sweep-board.jsonl` at zero bytes is a CLEAN PASS** — every row was read and none is a sweep candidate.
  It is a fresh file, not a missing one.
- **A missing file means that producer has never succeeded on this install.** It is never "nothing to
  report".
- `cycle-reconcile.json`, `github-landing.json` and `sweep-board-census.json` are never empty on success: an empty cycle is a report
  with empty lists, and a landing read with nothing open is a read with empty `rows`.

## Freshness

**A document's freshness is the mtime of its last successful write**, and nothing else: a failed run does not
touch the file, so the mtime is the instant the last good pass landed. Judge staleness against the producing
row's cadence — a document older than one firing plus its tolerance means the row did not succeed that
morning, and `automation due` names which firing and why.

## The Nothing stale reader

`slopweaver briefing render --nothing-stale` is the one reader in code (`src/briefing/nothingStale.ts`, its shell
`src/cli/commands/briefing/nothingStaleProjection.ts`), and `supervisor tick close` passes it on every render. It
REPORTS and never acts — no send, close, settle, enqueue or provider call is on its path — and it reads these four
files plus `live/slack/owed.json` ([owed](../../slack/reference/owed.md)), each validated through a narrow view,
never cast, plus the run journal of each pull request's landing registration.

The rule it reports against: everything the owner owns is MOVING, WAITING ON A NAMED PERSON, or ASKING THE OWNER ONE WORD.
Anything else is STALE, and the sweep's job is to keep that count at zero.

- **Moving needs a receipt, never a verdict.** A landing verdict names an act; it does not say anybody took it.
  A pull request reads moving only when GitHub's merge queue holds it, its stack's bottom carries the act, or the
  board row its landing registration names (`registrationSlug`, `src/review/boardAtHead.ts`) has a run that is
  open right now. A queue, stack or press receipt names the read it came from by its publication instant, the
  only one it stores, since GitHub can eject or close the pull request after it. An open pull request of the owner's that
  GitHub's own list (the read's `census`) carries and no row places is a gap, and so is an unread list; a row
  or press that list no longer carries closed or merged, so it is a caveat line, never an item. Every list a
  repository has counts. A run holding a question for the owner makes the row the owner's word, above every
  receipt, so no question hides in the moving lane. A named act with no open run is KNOWN STALE — the
  case this section exists to count, measured at 55 of 75 rows with not one run open
  (`src/briefing/nothingStalePullRequests.ts` carries the `jq`). A journal that will not read is a gap, never a
  receipt and never stale — unless a sibling journal's open run or question already decides the row, when the
  line names it as not seen instead. An address that will not parse is shown as text, never refused as a link.
- **The fleet's work is never the owner's word.** A board finding still in today's document is one the chair has not
  applied, so it is stale and the fleet's; only an `ORPHANED` row — a run the owner started that nobody holds — asks the owner.
  A dispatch verdict that needs the owner's judgment, every cycle proposal and every followed thread that asks the owner a question are
  the owner's word; a thread whose last word asks nothing is outside the rule, not stale.
- **A wait names a person or it is not a wait.** A code owner or an asked person the read's own roster names.
  A wait on nobody — an `outside-the-set` row included — is stale; an `unread` row is a gap.
- **Done for you is the autonomy ledger**, pointed at, never re-counted here: the note lists only what is in
  flight on a receipt. The stale rows stand FIRST, as "Nobody has it", because they are the leading count's
  evidence, with the gaps and bounds beneath them.
- **Freshness** is the rule above, made exact: a document is current until a firing of its producing row's
  cadence passes without replacing it (`firingsBetween`, the count `automation due` uses), with no tolerance
  window — before the morning run lands, the page says so rather than reading yesterday as today; the cadence comes
  from the row as INSTALLED in this home, the one that fires, and a missing, doubled, held or paused row is a gap. The owed document is judged by its own `observedAtIso`.
- **Missing, stale or invalid is a named gap, never zero.** Any gap and the summary is `not an all-clear`; only
  complete, current coverage with no stale row may read `Nothing stale`.
- **A bound is not a gap.** The landing read's `residue`, the cycle report's two standing `couldNotSee` lines
  and a complete owed read's `coverage.residue` are stated on every run, so they are folded as caveats. The
  board's `UNWITNESSED` count is one caveat line: a row nothing can check is unproven, not stale, and never a
  card each — and only when the census's `findingsSha256` matches the findings read beside it, since the two
  files are replaced one after the other; a mismatch is the `unproven count` gap. Above zero, the count also
  rides the summary as `· N unproven`, so `Nothing stale` never stands over a number only a fold shows.
- **Over its 64 KiB budget every list is withheld whole**, its count kept and one line saying why, so one long
  quoted field never stops `tick close` rendering and no list is ever cut to fit.
