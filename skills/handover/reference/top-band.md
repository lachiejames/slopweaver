# The top band: what the fleet can actually be on

`handover reconcile` ranks the whole board, then takes a band off the top and reports which live sessions are
on it. **Only a row the fleet can be on may enter that band.** Everything else is **held** — published as a
count and a list, never as a row somebody failed to pick up.

This is the second half of [one-board](one-board.md) § "Ranking, and what 'placed' means", and the same
defect class: a band whose membership is decided by something OTHER than whether the work is available
reports findings that are artefacts of its own filter.

## `standing` — one word per row, off its board section

`src/handover/rowStanding.ts` is the whole mapping, and `standingOf` is the one function that makes it.

| standing           | section                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ready`            | `RUN NOW`, naming a `repo:`                                                                                                                                        |
| `in-flight`        | `IN FLIGHT`                                                                                                                                                        |
| `waiting-on-owner` | `WAITING ON OWNER`                                                                                                                                                 |
| `paused`           | `PAUSED`                                                                                                                                                           |
| `blocked`          | every other section, any SUPERSEDED row, a `RUN NOW` row naming no `repo:`, a trunk-moved finding, and a `RUN NOW` row whose `needs=` integration is not connected |

Supersession outranks the section, so a `role: supervisor` doc seated before the chair currently holding the
pin is `blocked` however its own section reads — a retired chair is not work anybody may pick up.

A `RUN NOW` row naming no `repo:` is `blocked` too, because `cmux spawn` refuses to seat one — there is nowhere
to cut its worktree. Only `RUN NOW` is demoted: an `IN FLIGHT` row already has its run open. `reconcile`
prints how many, NAMING the p0 and p1 ones first, then any other one the owner RULED on, with the `set-repo` that frees the first whose slug no other doc claims, and `--json` lists
them as `repolessRows` and those as `repolessUrgentRows`, with every slug two docs claim as `sharedSlugs` — one p1 finding among 1666 repoless rows was a count
nobody read. `handover set-repo <slug> --repo <checkout>` is the way back to ready — add-only, and only the top of
a MAIN checkout, never a linked worktree.

A `RUN NOW` row whose last `dispatched` has no later `started` reads, as its reason, "the last dispatch has no
started row; pickup delivery is not proof that handover start succeeded" (`pendingDispatchEvidence`,
`src/handover/boardEvidence.ts`): a seat was sent its pickup and never journalled a start, whatever it said. Its
section is unchanged, and nothing retries it.

`--json` also lists every open run its seat RELEASED (`handover release`, never a park) as `releasedRows`: `{ kind:
"read", ids }`, or `{ kind: "unread", unreadableIds, why }` when any run journal carries a line this build cannot read,
because a smaller list would hide one (`src/handover/releasedRows.ts`). The Fleet page's doctrine panel names them.

A `RUN NOW` FINDING whose evidence names a file, a verb or a pull request the trunk has changed since it was
asked is `blocked` too (`src/handover/trunkMoved.ts`). Measured: six ready p1 findings were seated
after the trunk had already answered them. `reconcile` reads one `git log` per repository from the oldest
floor, prints each held row with the commits that moved under it, and `--json` lists them as `trunkMovedRows`.
Read the commits: `handover settle` a row they answered; for one still real, `handover recheck <slug>
--still-real "<what you re-ran>"` moves its floor to now, records the trunk tip it saw so no commit that tip
carried holds it again, and offers it again. A trunk it cannot read is stated
(`trunkUnread`) and its rows are offered unchecked, never held on a guess. A path hold is coarse — any commit
touching a cited file holds the row — and a finding citing no file, verb or pull request is never held.

A `RUN NOW` row DECLARING `needs=<integration>` ([row-tags](row-tags.md)) when the secrets store holds none of
that integration's credentials is `blocked` too (`src/handover/integrationNeeds.ts`): the owner will not have a seat spent
on Fathom, Calendar or Trelica work on an install connected to none of them, and wants the rows kept. `reconcile`
prints each held row with what it needs and the command that connects it, and `--json` lists them as
`disconnectedRows` (`{ needs, path, slug }`) beside `disconnectedUnread`, the reason the store would not list or
read — then nothing is held on a guess. Only a file an integration's credential set names is opened, and only to
ask whether it is blank, as the credential reader does: a blank file connects nothing, the value is never kept or
printed, and an expired grant still counts as connected.

`register --repo` and `set-repo --repo` share ONE judge (`src/handover/repoCheckout.ts`): a path, a declared
checkout's `owner/name`, or its bare repository name, and the row records the checkout's absolute top. A bare
name is resolved through the declared checkouts' origins and never read as a directory (prefix it with `./` to mean one), so
`--repo slopweaver` never reaches a row verbatim to die in the seat's git.

`ready` on a `BoardRow` is DERIVED from this (`standing === "ready"`) rather than passed beside it, so no
second field can disagree about the same fact.

## Eligibility, and why an open run is not a seat

A row enters the band when it is:

- `ready`, or
- `in-flight` **with a live seat OBSERVED on it**.

The second arm is why the reconciliation takes a `fleet` of `observed` or `unavailable`. cmux answering is
what makes a seat observed; the fallback — the board's own open runs — proves only an unclosed journal
CYCLE, never a living agent. Unioning open runs into the band would let a dead holder hold a p0 for ever, so
with no fleet to observe that arm closes entirely rather than guessing.

**Which row a live seat is on** comes from the session ledger first. The NEWEST `spawned` row recording that
workspace's id must still be open, name a board row, and contain the workspace's current directory under its
recorded `cwd`. A workspace that now stands in a worktree naming a different board row than that `cwd` did fails
too. If it fails any of those checks, the seat is placed by its directory name instead, and no older row is
consulted. The workspace ref is never joined on, because a cmux restart renumbers refs and keeps
ids. A ledger row written before `cmux spawn` recorded the id falls back to the directory name until the seat
is reseated. One resolver, `src/cli/commands/handover/seatBinding.ts`, serves both the band and the
recipe-failure filter.

`ready`, `held` and the seated rows **COVER the whole ranked board** — every row is in at least one of the
three, which is what lets a reader treat them as the board rather than a selection off it. Cover, not
partition: a `RUN NOW` row a live session is already on is BOTH ready and seated, and `held` is the list that
is disjoint from the other two, which is what "startable by nobody" rests on. Both halves are asserted in
`src/__tests__/unit/handover/reconcile.test.ts`.

**Both claims hold while every ranked row carries its own id, and a DUPLICATE id breaks each of them.** With a
seat, two rows under one id leave the earlier in none of the three lists; with no seat and disagreeing
readiness, the id lands in `ready` off one row and `held` off the other. That is the board's duplicate-slug
defect rather than this filter's — named where it is owned (`src/handover/reconcile.ts`'s `held`) and pinned by
cases that redden when it is resolved. Do not patch it here, in a second copy that can disagree.

## Why an unstartable row is held, measured

MEASURED on one tick, a band built without `standing`, whose own document the readings ledger holds — `jq '{rankedCount,
starving: [.starving[] | {id, ready}]}' "${SLOPWEAVER_HOME:-$HOME/.slopweaver}/readings/handover-reconcile/<tick>.json"`
answers 654, five ids, and `false` five times. So the document convicts itself: every row the verb published
as a starving top row, a row it was telling the owner nobody was on, it had already marked not ready. `starving`
was 5 of 5 by construction, and that same number drove the `/workstreams` nav badge in the owner's console, which made the workstreams page unreadable as a reflection of reality. WHY each is
unstartable is its standing.

**The obvious fix is wrong**: adding `ready` to the band's own filter drives `aligned` to ZERO for ever, since `RUN NOW` and `IN FLIGHT` are mutually
exclusive by construction — the same artefact pointed the other way. `src/supervisor/outcomes/coverage.ts`'s
`belongs` carries that half, already measured.

With `standing`, the same board reads a p0 somebody is on at the top, four genuinely startable p1 rows under it, and 182 rows held. The
headline names only the four — `starving` is the one number it states ([one-board.md](one-board.md)).
Reproduce with `slopweaver handover reconcile`.

## The console reads this, it does not recompute it

`/fleet` places each seat on its row and draws that row's `standing` read back, never a grouping word of its
own. A page that derived its own sections from `ready` plus a priority would rebuild the artefact above —
`site/components/live/readWorkstreams.ts` carries that as its own rule, and `site/content/console/fleet.mdx` is
what the page itself says about it.
