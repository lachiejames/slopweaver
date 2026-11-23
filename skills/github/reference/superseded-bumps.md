# `close-superseded` — the bump drive closes the owner's bumps that are already in the base

When a Renovate pull request merges that does what one of the owner's bump pull requests does, the obvious answer is
to close the superseded one. One left open for a few hours is not the end of the world; days or weeks afterwards is
a concern. MEASURED: an owner bump (`@ai-sdk/openai` to v3.0.119) stayed open for two days after a Renovate pull
request (to v3.0.124) merged into `staging`.

So it rides the job that already runs every four hours, never a new one: `github bump-drive`'s FIRST act, before
the ladder, on both `bump-drive-<repo>` rows. A Renovate merge is answered within one cadence.

```bash
slopweaver github bump-drive --repo acme/acme-admin --dry-run   # every close it would make, nothing written
```

## Its own read, never the fleet read's rows

The fleet read stops at `--limit` (100), and MEASURED on `acme-admin` it saw two of the owner's five open
Renovate-worded bumps. So the act reads **the owner's whole open list** off `viewer.pullRequests`, checked against GitHub's
own `totalCount`, and **Renovate's merges** by search, checked against `issueCount`
(`src/live/github/supersedeReads.ts`, each node parsed by `supersedeNodes.ts`). A list that does not add up is a FAILED read, never a short one: a failed
open read closes nothing, a failed merged read leaves only the no-diff arm, and the report's `notes` says which.
Every pass also prints one coverage line per repository — how many open bumps of the owner's it found, how many
change only dependency files, out of how many open pull requests read whole, and how many are superseded — so the
denominator is never a guess.

Every Renovate identity is a GitHub App and search spells it `app/<login>`: `app/renovate`, plus one per bare login
in the organisation's `dependencyBots` (`renovateSearchAuthors`, `src/organisation/dependencyBots.ts`, pinned by a
test). MEASURED against the team repository's self-hosted Renovate App: the bare `author:<login>` is a 422
through REST and an EMPTY list through GraphQL, which would read as "Renovate merged nothing". With no organisation
configured only `app/renovate` is searched and the notes say so; an organisation that will not read stops the pass. Every node the search
returns is checked against what it asked — the same repository, a `Bot` author whose `login` is the searched
identity, merged at or after the searched instant — and one that is not FAILS the read rather than being dropped.
On both lists a node's `url` must be the pull request its own repository and number name.

## Two arms, each a fact rather than a resemblance

The rule is pure, in `src/review/bumpSupersede.ts`. Only a title of the owner's that leads with a bump qualifies — a
Renovate-style wording, `fix(security):` opened by a dependency verb and followed by a target or a dependency (`to 17.13.8`, `past <advisory>`, `dependency`), after any `[ABC-123]` ticket prefixes, or the current `fix(RRRR-640): clear … (CVSS 7.5)` shape, opened by a clearing or dependency verb and ending with the advisory score; `[DO NOT MERGE]` never does.

- **`renovate-merged`** — a Renovate pull request merged into the SAME base, AFTER the owner's was opened, bumping the
  same subject to a target at least as new (`v3.0.124` ≥ `v3.0.119`; `^0.13.0` reads as its floor). When either
  target is not a plain version — a digest, a prerelease, a group with no `to` — only an identical title counts.
  The merge-after rule holds everywhere, because a group title recurs and an old merge says nothing about a
  pull request raised since.
- **`no-diff`** — GitHub's test merge (`potentialMergeCommit`) of the owner's head into the base has exactly the
  base tip's tree, and its parents are exactly the base's current tip and the owner's current head. A conflicting, unknown or
  stale test merge is unanswerable, never a close; a parent list short of its own `totalCount`, or a parent with
  no oid, is a FAILED read, never a two-parent one.

Either arm closes only a pull request that changes dependency files and nothing else (`package.json`, a lockfile,
`.yarnrc.yml`; a list past 100 files is not judged, and one naming a path twice is a failed read): a title is a resemblance, and a Renovate merge of the bare bump
never carried code the owner wrote beside it. A Renovate merge is preferred when both hold, because it is the one the
comment can NAME.

## The close

Through `github close --why "<comment>"`, in process, so the door records it and refuses a pull request already
closed or merged. The comment names the evidence — ``Superseded by #<n> (…), which Renovate merged into
`staging` at <instant> …`` or the head and base tip of the empty merge — and ends `reopen it if this is wrong`.
Each close is an autonomy-ledger row, `<repo>-<n>-bump-close`, kind `close-superseded-pull-request`.

- **Re-read just before the close.** The plan is one read and the closes run one by one, so each pull request is
  read again first (`src/live/github/supersedeRecheck.ts`) and closed only while it is open, is the SAME pull request it asked about, at the SAME head, on
  the same kind of evidence; otherwise it is skipped, and a failed re-read closes nothing. The close then passes
  `--expect-head` with that head, so `github close`'s own read — the last before the comment and the close — refuses
  one pushed to since, and one it read about any other pull request. The head is what that last read guards,
  because the head is the work a close could lose: a title or label edited in the one round trip after the re-read
  is not re-judged, and GitHub's close mutation itself takes no expected head, so a push after that read is not
  caught either. Both are the stated residue.
- **Only the owner's pull requests.** The read is the viewer's own; a bot's or a colleague's can never be closed here.
  Ownership rests on that connection alone: no node's author is read back, because `viewer.pullRequests` cannot
  answer with another user's pull request — the one input this read trusts GitHub for.
- **An opt-out label holds it back**, as it holds back every act.
- **Capped at 10 per pass**, oldest number first; the next firing takes the rest.
- **The ladder never touches a superseded bump**, capped and failed ones included: pressing it to merge is the
  one wrong act left on it.
- `--dry-run` closes nothing and writes nothing.
