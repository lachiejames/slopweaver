# Bronze coverage — what the corpus holds, and how far back

Measured live against a real `$SLOPWEAVER_HOME`, read-only (no `refresh` run for this audit —
every number below is what was already on disk). It answers four things a dogfood pass raised as open
questions: what each source's bronze actually spans, what "the channel membership is capped" means and
whether it blocks anything, whether a "0 of 12 records about a person" result means the corpus lacks them,
and whether retrieval weights newer records higher today.

## Per-source coverage

| Source              | Raw bronze rows       | Distinct entities\*                   | Dense history reaches back   | Earliest row reaches back     | Latest row               |
| ------------------- | --------------------- | ------------------------------------- | ---------------------------- | ----------------------------- | ------------------------ |
| GitHub              | tens of thousands     | tens of thousands (about 1% dup)      | about four months            | under a year (stragglers)     | the newest               |
| Linear              | hundreds of thousands | tens of thousands (nearly half dup)   | nearly three years, unbroken | about three years             | the newest               |
| Notion              | tens of thousands     | tens of thousands (about a third dup) | about eight months           | about a year (stragglers)     | the newest               |
| Slack               | hundreds of thousands | hundreds of thousands (under 1% dup)  | about four months            | over three years (stragglers) | days behind              |
| `self` (local docs) | tens of thousands     | tens of thousands (under 1% dup)      | about four months            | about four months             | a couple of weeks behind |

\* Grouped by `(container, sourceId)` — the identity key `latestRecords` (`src/corpus/latestRecords.ts:66-68`)
collapses bronze on for any real read. This is an approximation of that view (it skips the richer-content
tie-break for equal timestamps), close enough to size the gap: **the true logical count is a little lower
still.**

`self` is a fifth bronze source, not one of the four connectors — locally-authored documents captured from
the machine's own filesystem (`src/corpus/self/`), scoped to however long that documentation practice has
existed, not a backfill target.

**The owner's "three months for Slack, shorter or longer elsewhere" read is right, source by source:**

- **Slack and GitHub both land close to it.** Slack's real message volume starts nearly four months back
  from this measurement, with only a handful of pinned/bookmarked stragglers older than that — a pin or
  bookmark's own timestamp can predate the message-history window because pins/bookmarks are captured
  separately from the messages they point at. GitHub's real comment/review volume ramps from a little under four months
  back, with a few dozen rows on a handful of still-open pull/issue threads reaching back most of a year — full history on
  items search re-discovers, not a backfill boundary.
- **Notion goes meaningfully deeper** — real volume starts nearly eight months back, well past the three-month
  mark, with rare stragglers to about a year.
- **Linear is the outlier, by a wide margin**: continuous, substantial volume every month back
  **nearly three years**, because nothing in this connector filters by team, project or age (`includeArchived: true`
  on every connection that accepts it — `src/corpus/linear/queries.ts:16,239,319,327,426`) and Linear's own
  API has no per-workspace membership gate the way a Slack channel does.

## Bronze carries duplicate rows from overlapping refresh windows

Total: hundreds of thousands of raw rows, about a quarter more than the distinct entities they hold — **about a fifth of what's on disk is a duplicate capture**,
overwhelmingly from Linear (nearly half) and Notion (about a third), each of which has more than one near-complete
full-history window file sitting alongside later incremental ones (bronze is append-only, and a refresh that
fetches anything new writes it into a new window file). GitHub and Slack, around 1% or less, sit close to the ~1.26% baseline overlap
`latestRecords.ts`'s own doc comment measures from ordinary day-to-day incremental refresh. This is exactly
what `slopweaver compact run` fixes, and the `compact-corpus-daily` standing row makes it due
nightly at 02:30, for a supervisor pass to run.
Compacting would roughly halve Linear's and Notion's bronze footprint on disk without losing anything: `latestRecords` already
reads through the duplication at query time, so nothing downstream is currently wrong because of it — it's a
disk and read-time-collation cost, not a coverage gap.

## The Slack channel cap — two different limits, easily conflated as one

There are two distinct things that gate what Slack this corpus can hold, and the dogfood question ("capped at
50 of N active channels") named only the smaller, less consequential one. The exact phrase traces to a real
log line quoted in a sibling audit
(`~/.slopweaver/handovers/derived-state-built-from-partial-inputs.md` §3):
`structures slack: slack: channel-membership cap 50 applied — N active channel(s) not resolved`. The
workspace has hundreds of active channels, and a
refresh that passes no `--slack-membership-cap` resolves all of them.

**1. An OPT-IN cap — and it is on channel MEMBERSHIP metadata, not message history.** A refresh resolves
`conversations.members` for every active (non-archived) channel unless the caller passes
`--slack-membership-cap N`, which bounds how many get the call during the STRUCTURE lane — i.e., how many
channels' full "who belongs to this channel" roster gets resolved (`planChannelMembership`,
`src/corpus/slack/membershipPlan.ts`). **This cap never touches message ingestion** — the code says so
explicitly (`src/corpus/slack/fetch.ts:1004-1005`): channel discovery has "no membership pre-filter; a
channel we cannot read is dropped later, at its history call."

A capped run stays honest about what it did not ask: every channel row carries a `membershipResolved`
attribute, silver counts the `false` ones as `structures.membershipUnresolved`, and `derive` names them on
its `structures:` line. Without it a capped channel and a genuinely empty one are both zero member edges —
measured at a cap of 50: hundreds of channels were present, only the capped subset was resolved, hundreds of active channels were never asked,
and ZERO of the 50 asked came back with no members. Every such zero is an unasked question.

**2. What gates message history: the BACKFILL WINDOW, not channel access.** `is_member: false` does not mean
unreadable — never infer access from a join between captured content and that flag. Asked directly, the user token read nearly every non-archived conversation, membership or not, plus every
sampled archived one; the single refusal was a DM whose counterpart is deactivated.

Discovery includes archived channels (`exclude_archived: false`, `src/corpus/slack/api.ts`) — archived
conversations are readable too — and each channel carries its own cursor, so one created, joined,
un-archived or missed by an earlier walk is crawled from the window floor rather than from a workspace-wide
watermark (measured without it: many reachable conversations had zero bronze rows before per-channel cursors). Measurements, design
and [the proof](slack-reach/provenance-coverage-and-proof.md#proof-of-the-backfill):
**[slack-reach/gaps-archived-and-cursors.md](slack-reach/gaps-archived-and-cursors.md)**.

**Net answer to "do we not use all the data at our disposal": the membership cap is not the gate.** It is
an opt-in scale guard on structure metadata that never touches message ingestion, and a capped run reports
what it skipped. Message coverage is gated by the backfill window, and `slopweaver refresh --source slack
--coverage` reports the remaining gap and exits non-zero while any exists.

## What "coverage" means per connector, concretely

- **GitHub is org-wide by default, not a curated list.** Refresh's org-enumeration mode has no default
  `--repo-cap` and empty default `--include-repo`/`--exclude-repo` filters (`src/cli/commands/refresh/core.ts:65-69,168-169,202`)
  — every repository the token can see gets its own incremental cursor
  (`.github-repos.watermark.json`), and the set grows automatically as the org creates repos. Nothing is
  silently excluded by this repo's own code: enumeration walks 20 pages of 100 by default
  (`DEFAULT_GITHUB_PAGE_CAP`, `src/corpus/github/orgApi.ts`), and an org that outruns that ceiling gets a warning
  naming the count reached and `--github-page-cap`, which raises it — a truncated walk can never read as a
  whole org. The only other ceiling is what the GitHub token itself can see.
  Measured: the watermark tracks dozens of repositories; fewer than half actually hold bronze activity, and the
  rest read as genuinely idle in-window rather than dropped — personal config, template and take-home
  test repos with a same-day cursor stamp, not a repo the connector chose not to fetch.
- **Linear has no team/project scope at all** — the root list queries (issues, projects, initiatives,
  documents, users) are workspace-wide, which is exactly why its history runs almost three years deep above.
- **Notion is the one connector actually bounded by an external grant, not by anything in this repo.** A
  Notion internal integration only sees pages/databases a human has explicitly shared with it inside Notion's
  own UI — there is no "give me everything in the workspace" call to make. A grant widening that access does
  not retroactively backfill anything; the newly-visible pages appear in bronze after the next `refresh
--source notion`. This is the one source where "do we have all the history" is a question about a
  permission the owner controls outside this codebase, not a connector defect. **Treat this audit's Notion
  figures as a snapshot**: the on-disk marker `corpus/bronze/notion/.capture-coverage.json`
  (`src/corpus/notion/captureCoverage.ts`) records when full-coverage confidence starts — its `coveredSinceIso` sat two days before the newest
  row at this measurement.

## Recency is an order, not a weight

There is no relevance score to weight. `store read`/`store cite` select with
Postgres full text plus structured filters and return rows newest first; `--since`/`--until` are how a caller
bounds the window deliberately.

## Glossary

- **Roster row / member row** — one line in `corpus/members/<source>.jsonl`, typed `MemberBronzeRow`
  (`src/corpus/members/types.ts:45`): a single per-source user/member fetch (e.g. one `slack.users.list`
  entry, or one `slack.message.user_profile` recovery for a person `users.list` structurally cannot return —
  see `src/corpus/slack/connectMembers.ts`), BEFORE cross-source identity resolution runs. This is the pre-resolution sense of "roster" — a
  person can hold several roster rows (one per source, sometimes several per source across refreshes if
  their profile keeps changing) before `derive` ever collapses them into one canonical `Person`. Confirmed
  against how the term was actually used when it was coined for the misspelled-name case below: "three
  roster rows across two sources, **plus** a resolved person in the derived silver people index" — the two
  are explicitly distinct, and "roster row" names the first.
- **Derived roster vs. human roster** — two DIFFERENT, non-interchangeable stores, easy to conflate with the
  member rows above (`src/silver/derivedRoster.ts:5-13`): the store's identity roster is the
  human-maintained override/seed (always wins); `corpus/silver/index/identities.json` is `slopweaver derive`'s
  own cross-source resolution over the member rows, rebuilt every `derive` run.
- **Held name link** — a low-confidence, name-only match between two identities that the resolver found but
  refused to auto-merge, surfaced instead as a candidate for a human to confirm
  (`src/silver/identity.ts:54-61`, `src/silver/derivedRoster.ts:15-18,37-38`). "Held" means proposed, never
  applied — a wrong automatic merge is expensive, a held candidate is cheap.
- **Single-source person** — a canonical `Person` (post-resolution) whose `confidence` is `"single-source"`:
  built from exactly one member row, never linked to any identity in another source
  (`src/silver/identity.ts:42`, `src/silver/personResolver.ts:229`).
- **Container** — the corpus record field naming what a record lives inside (a Slack channel id, a GitHub
  `owner/repo`, a Linear team, a Notion parent page/database). Together with `sourceId` it is a record's
  logical identity; for GitHub specifically the container is load-bearing because issue/PR numbers repeat
  per-repository (`src/corpus/latestRecords.ts:11-21`).

## The "0 of 12 records about a person" case: coverage, or retrieval?

A recent dogfood question asked about a real person by a misspelled name and got zero matching records back,
which read as a coverage gap. It wasn't one. The corpus held that person correctly — three rows in
`corpus/members/`, under the correct spelling, across two sources — and re-asking with the correct spelling
returned three records about them out of twelve. What happened: **the read did not consult
`corpus/members/`** to catch a near-miss spelling or offer a "did you mean", so a name one character off from
the roster produced a clean, silent miss rather than a match or a warning. That is a name-reconciliation gap
in the read, not a bronze gap, and it is recorded here so the finding travels with the coverage question that
surfaced it.

## Left open by this audit

- **The exact logical (post-`latestRecords`) record count** — approximated here by identity-key grouping
  only; the real number (after the richer-content tie-break) is a little lower still, and re-measuring it
  precisely would need a full read through `latestRecords` itself rather than a shell aggregation.
- **Compacting bronze** (Linear/Notion's third-to-half duplication) is the `compact-corpus-daily` standing row's job
  (`slopweaver compact run`), not this audit's — this audit stayed read-only per its own rails.
