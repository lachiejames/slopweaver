# `linear query` — the local-first facet query, verified live

The shape the owner asked for, in one sentence: **search the local store first, because everything is stored
locally; use live Linear as the final verification that the citations still resolve and still say what we say
they say.** Never live for everything — that pays for the whole answer twice on a rate-limited API. Never
local for everything — that is how a citation quietly goes stale and still reads as evidence.

## The facets

Every one of these is already in bronze, on the record itself. Nothing here needs a network.

| flag              | issue                                                                | project                                    |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| `--assignee`      | the assignee's Linear handle, or `me`                                | the project's LEAD                         |
| `--state`         | the workflow state by NAME (`In Review`)                             | the project status by NAME (`PRD Scoping`) |
| `--state-type`    | `triage`｜`backlog`｜`unstarted`｜`started`｜`completed`｜`canceled` | —                                          |
| `--team`          | the team key (the `ENG` in `ENG-42`)                                 | matches any of the project's teams         |
| `--project`       | the project's id, or its name                                        | the project's own id, or its name          |
| `--cycle`         | the cycle NUMBER                                                     | —                                          |
| `--label`         | comma-separated; a match carries EVERY one                           | —                                          |
| `--priority`      | `0` none, `1` urgent, `2` high, `3` medium, `4` low                  | —                                          |
| `--updated-since` | an ISO date, or `<n>d` for the last n days                           | same                                       |
| `--text`          | a substring of title or body                                         | same                                       |

**Open-set facets match WHOLE and case-insensitively, never as a substring.** `--team IN` does not answer with
every `INS` ticket. `--text` is the one deliberate substring facet, because prose is what it searches.

**`--project` takes the id for an exact answer.** Linear does not keep project names unique, so a name matches
every project sharing it; the id never does. Each issue is judged on its NEWEST capture only: bronze appends
a version per change, so an issue moved out of a project still has older rows that would otherwise match.

**Closed-set facets are validated before a byte of corpus is read**, and a bad value REFUSES naming what the
flag accepts. That is the whole reason they are closed: a mistyped `--state-type strted` returning "no
matches" is indistinguishable from an honest empty answer, and the two want opposite reactions.

## `--assignee me`

Two exact crosswalks, in order: the identity roster person whose id is `profile.json`'s own `id`, then the
person carrying the Slack user id `profile.json` declares as the owner's. The second is not redundancy — on
this install the first matches nobody, because `profile.json` carries the placeholder id `me` while
the identity roster keys the same human under `person:ada`.

Never a name guess, never a single-person fallback. When neither crosswalk resolves, the verb REFUSES with
`OWNER_UNRESOLVED` and names both fixes (repair the roster with `slopweaver identity roster replace`, or pass `--assignee <handle>`), because
answering someone else's queue as though it were yours is worse than answering nothing.

## What the live leg costs, and what it compares

**One request per distinct TEAM on the page, plus one for every project on it.** The Linear transport paces at
0.55 req/s, so a per-citation read of a ten-row page would take eighteen seconds; a page spanning four teams
costs four requests instead of ten. Issues are verified by `issues(filter: { team: { key }, number: { in } })`
and projects by `projects(filter: { id: { in } })` — a FILTER rather than aliased `issue(id:)` lookups,
because graphql-request throws whenever a response carries `errors`, so one deleted ticket would fail the
verification of every citation beside it. A filter simply does not return the row, and that row is `gone`.

Compared: **state, assignee (or a project's lead), title, and whether it has been archived** — the claims a
citation makes. Deliberately NOT compared: priority, cycle and labels. They move constantly, they do not
invalidate the citation, and reporting them would bury the drift that matters under drift that does not.

A project is compared against `status { name }`, never Linear's deprecated sibling `state`, which answers the
status TYPE (`completed`) while the corpus records the NAME (`Completed`), so every project citation would
report a false `Completed → completed` drift.

## Four verdicts, and none of them is silence

- `[confirmed]` — live Linear agrees on every compared field.
- `[changed]` — it exists and something moved; each drift prints as `field: local → live`. **Quote the live
  value.**
- `[gone]` — nothing came back for that identifier. The citation does not resolve.
- `[unverified]` — nobody checked this one, and it says why.

A page rendered with no verification at all prints `citations UNVERIFIED` and the reason — no Linear token, or
`--no-verify`. That is a different claim from `confirmed` and is never rendered as one.

## Bounds, stated

The scan streams bronze line by line and retains only matches, so the heap is a property of the ANSWER rather
than of the corpus: the owner's Linear bronze is 661 MB over 173,206 rows and a full scan measured 2.2 s at
199 MB peak RSS (`wc -l ~/.slopweaver/corpus/bronze/linear/*.jsonl`). Past 50,000 distinct matches the query
REFUSES rather than truncating, because a silently-capped count is a wrong answer to "how much is on my
plate". A bronze file the walk could not open is NAMED, and the match count is then reported as a floor.

`--corpus <dir>` scans a directory other than the state home's Linear bronze — how the replay and unit lanes
point the real verb at a fixture.

## `linear issues` — the whole set, live, when you are about to act on it

`linear query` answers "what is on the plate" from the corpus. When the next step is a WRITE over a set — move
every issue out of a team, detach every old issue from a project, restore what a run changed — the set has to
be the one Linear holds right now, all of it. `slopweaver linear issues --team <key>` and/or `--project <uuid|url>`
reads every page live (50 issues a page; the sizing is measured in `src/live/linear/issues.ts`), archived issues included and marked,
and REFUSES rather than printing a first page when a page will not say whether another follows. A walk is not a
snapshot: Linear offers no version or total to check it against, so an issue created or moved into scope DURING
the walk can be missed while the read still succeeds. After writing over the set, run it again; a row the first
walk missed shows up then.

`--creator me` keeps the issues the token's own user filed — the fleet files as the owner, so this is the fleet's
set plus the owner's own — and `--created-since <iso|Nd>` bounds it by age. Each row carries its project, state, cycle,
labels and when it joined its project; `--json` prints them all, for the receipts a move or restore owes.
