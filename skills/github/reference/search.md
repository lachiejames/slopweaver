# `github search` — a page is a sample until it says `complete`

`github search "<term>" [--repo <owner/name>] [--limit <1..100>] [--complete] [--json]` hands GitHub's own
search syntax through unchanged (`is:pr is:open`, `label:bug`, `author:x`) and scopes it to one repository.
It is discovery, not a read: a match is a number, a title and a link, and a current claim still needs
`github read` on the chosen link.

## The page bound, and why `coverage.kind` is the field to branch on

GitHub counts every match (`totalCount`) but returns at most one page (`--limit`, default 10), in its own
best-match order. **For a term-less query such as `is:pr is:open` that order is newest-first** — measured over
three reads 80 minutes apart, every page strictly descending by number — so a page that held fewer than
`totalCount` omits the OLDEST matches: for open pull requests, exactly the ones closest to landing. Membership
still moves between reads (a new PR opening pushes the oldest off a fixed page), and a query carrying real terms
may rank differently, so never read the omitted half as random or as stable. The document names which it is:

- `coverage.kind: "complete"` — every counted match came back on this page, so `matches` IS the set.
- `coverage.kind: "bounded"` — the page held fewer than `totalCount` (or a hit was dropped for a missing core
  field); `coverage.detail` says how many were withheld. `matches` is a sample.

**Anything that treats the matches as a set passes `--complete`** — a turn-path queue, a hold or drain
decision, "every open PR", "is this the only one". Under `--complete` the verb requests the whole page
(`--limit 100`, GitHub's ceiling, unless `--limit` is typed) and REFUSES a bounded one: exit 1, one
diagnostic line, **nothing on stdout** — never exit 3, which a caller reads as "the set is empty" and is the
exact false-drain a truncated enumeration produces. A shell caller that branches "0 or 3 is a set, anything
else is UNKNOWN" is therefore correct without parsing the document. A caller that wants the arithmetic rather
than the label checks `matches.length < totalCount` itself; the label is computed from exactly that.

Measured (reproduce: `slopweaver github search "is:pr is:open" --json | jq .coverage`): the
default page held 10 of 21 open pull requests, and the next three to land all came from the invisible half (three landings, so a direction and not a rate; a fast open-and-merge lands off the TOP of the page instead, so the blind spot is the AGED half specifically).
Raising `--limit` alone only moves the cliff; the refusal is the fix.

## Exit codes

| exit | meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| 0    | at least one match; the document is on stdout                                      |
| 3    | zero matches — a normal outcome, document still on stdout                          |
| 1    | a provider or repo-resolution failure, **or `--complete` refusing a bounded page** |
| 2    | usage                                                                              |

The repository is resolved from the current checkout's `origin` remote when `--repo` is absent, and the
document's `repo` field prints what was resolved — assert it when the cwd is not the repository you mean.
