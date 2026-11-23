# Connector field coverage — what each API offers vs what we request

The owner's ruling, on the incident that made this file necessary: a GraphQL query that never requests the
user id is a defect, so every connector's queries are scrutinised to pull all the relevant data, because what
is not in bronze is not anywhere else.

Measured: 19 user-shaped Linear GraphQL sub-selections asked for `displayName` and none for
`id`, though `users(...)` returns ids happily, and the identity graph minted 299 name-keyed "phantom people"
from them. Refusing a phantom is correct; not having the id in the first place is the defect, and the class
generalises past Linear.

**The bar for this file is not "request everything."** A wider selection costs rate budget and, on Linear,
complexity points. The bar is a **deliberate, recorded decision per field** — so a field we don't have is one
someone chose not to fetch, not one nobody thought of. Identity-bearing fields (any id, email or handle for a
human) are the priority tier: a missing id is unrecoverable later without a re-fetch, while a missing body
field is merely thin.

## Identity-bearing fields — the priority tier

| Connector  | Identity key                                                                       | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Linear** | UUID (`isNativeIdShaped` — `src/silver/nativeIdShape.ts:27,60`)                    | **Correct.** Every user-shaped selection in `src/corpus/linear/queries.ts` requests `id` alongside `displayName`; `parse.ts`/`entities.ts` project the id into `CorpusRecord.author`, falling back to the display name only when a node carries no id.                                                                                                                                                                                                                                                                                                                                                                        |
| **Slack**  | `U…`/`W…`/`B…` id (`src/silver/nativeIdShape.ts:24,58`)                            | Correct for `message`/`comment` records (`author` IS the raw id — `src/corpus/slack/fetch.ts:369`). **Two known gaps**, one repaired in silver: `file`/`pin` records resolve to a display name instead of the id (`project.ts:345`, `curatedFetch.ts:50-54`) — repaired downstream by `personResolver.ts`'s `chatNativeAuthorId`, which reads the real id back out of `record.raw.user`. **`canvas` records carry no author at all** (`SlackCanvasItem.author` is never populated — `curated.ts:155-175`) — there is nothing in `raw` to repair, so a canvas's creator is genuinely unrecoverable without a connector change. |
| **GitHub** | login (`src/silver/nativeIdShape.ts:14-16,34` — "GitHub's native id IS its login") | **The accepted risk is hedged in bronze.** `CorpusRecord.author` is the `login` alone, deliberately — it is GitHub's native id for every reader here. Underneath it, every user-shaped selection in the activity lane asks `author{login __typename ... on User{databaseId}}`, so the STABLE numeric id sits in each record's `raw` beside the mutable login and a rename is recoverable from disk rather than by re-fetch. The other three sites (`fetch.ts` search hits, `curated.ts`, `members.ts`) keep the login alone — a search hit's `raw` carries `user.id` regardless; the other two do not.                        |
| **Notion** | UUID                                                                               | **Mostly correct, one silent gap.** Comment authors keep the real id (`fetchProject.ts`, `projectCommentItem`), as do rich-text `@mention` spans (`curated.ts`). **A `people`-type property value keeps only the name, discarding the id** (`fetchRender.ts`, `namesOf`) — recoverable from `raw` but not indexed. Page/row-level `created_by`/`last_edited_by` (the object's own authorship metadata, distinct from a `people` property) is never surfaced to text/attrs at all — stuck in `raw`, unindexed.                                                                                                                 |

## Linear

Measured live: `5,189` complexity / `8` requests for a 5-issue capped fetch with ids in the
selection — safely under Linear's 10,000-per-query ceiling and its 3,000,000/hour aggregate budget; adding a
bare `id` scalar to an object already being resolved does not multiply complexity the way an additional
NESTED OBJECT selection would, per `queries.ts`'s own measured complexity model.

What the connector covers, read from `src/corpus/linear/queries.ts`, `entities.ts` and `vocabularyRows.ts`:

| Entity / field                                                                                                                                          | Status                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Archived issues/projects/cycles/states                                                                                                                  | **Fixed.** `includeArchived: true` on every connection that accepts it (verified per-connection by schema introspection).                                                      |
| The eight bulk entities (customerNeeds, projectMilestones, issueLabels, initiativeToProjects, externalUsers, customViews, initiativeUpdates, templates) | **Fixed.** All eight are fetched — `entities.ts` routes each to a searchable record, a structure row (`vocabularyRows.ts`), or the members store, per entity.                  |
| Comment threading (`parentId`), reactions, external commenters                                                                                          | **Fixed.** `COMMENT_FIELDS` carries all three.                                                                                                                                 |
| `Issue.cycle`                                                                                                                                           | **Fixed.** `ISSUE_SCALAR_FIELDS` carries `cycle { id number name }`.                                                                                                           |
| Connection caps (`projectUpdates`, `team.members`, …)                                                                                                   | **Fixed.** One shared collector (`NESTED_CONNECTIONS` + `nestedConnectionQuery`) pages every nested connection to exhaustion; an overflow is reported, never silently dropped. |
| **User ids on every activity author/assignee/lead/owner/subscriber/member**                                                                             | **Fixed.** See § Identity-bearing fields.                                                                                                                                      |
| `auditEntries` (the one true org activity log)                                                                                                          | **Open — not a selection gap.** Returns HTTP 403 for this token (`Invalid role: admin required`); an admin-scoped key would be needed. Reported, not routed around.            |
| `initiativeLabels`, `customerTiers`, `agentSkills`, `initiativeRelations`                                                                               | **Open, low priority.** Empty in this workspace as measured; not fetched. Revisit if a workspace ever populates them.                                                          |
| `roadmaps`, `facets`                                                                                                                                    | **N/A.** Not root queries in Linear's schema.                                                                                                                                  |

## GitHub

`src/corpus/github/*.ts`, split REST (`@octokit/rest` — discovery/search, org/team/member enumeration,
releases/milestones/CODEOWNERS) + GraphQL (`client.graphql` — per-item review/comment/timeline enrichment,
SAML identity join, discussions).

**Entities fetched:** issues, PRs, PR reviews, review-thread comments, issue/PR comments, lifecycle timeline
events (merged/closed/reopened/ready-for-review/convert-to-draft), CI status-check-rollup (aggregate state
only), discussions, releases, milestones, CODEOWNERS, orgs, repos, teams (+ members + repo permissions).

**The selection set, and the one rule that bounds it.** `PR_ACTIVITY_QUERY`/`ISSUE_ACTIVITY_QUERY`
(`activityQueries.ts`) carry the item's own scalars — for a PR: `headRefName`/`headRefOid`,
`baseRefName`/`baseRefOid`, `headRepository`, `mergedAt`, `mergedBy`, `mergeCommit`, `additions`,
`deletions`, `changedFiles`, `merged`, `closedAt`, `id`/`databaseId` — every review's `commit`, and on every
review-thread comment its `path`, `line`, `originalLine`, `diffHunk`, `outdated` and `commit`. The parsed
node's own fields land in `raw` (connections stripped, so no comment body is stored twice) and the ones a
question filters on are promoted to `attrs`: `file`, `line`, `outdated`, `commit` on a comment; `headRef`,
`headSha`, `baseRef`, `baseSha`, `mergedBy`, `mergeCommit`, `additions` on the atom.

**What may be added here is bounded by one property: scalars and single-node sub-selections only, never a
new connection.** GitHub scores a GraphQL call off its connections' `first`/`last`, so a wider set of
scalars is more bytes on the same one call per item — which is what made the whole-population refetch cost
the same call count as the backfill that captured four fields per comment. `reviewRequests(first:n)` and
`files(first:n)` are refused on exactly that basis, not because nobody wanted them.

**Entities never touched** (confirmed absent by grep, not merely unread in a sample): individual commits (only
`commits(last:1)` for the CI rollup — no commit list, no commit author/committer, no commit messages),
requested reviewers, per-check-run detail (only the aggregate rollup), Projects v2
(explicitly deferred — `curatedFetch.ts:6-7`, "noted as a follow-on... deliberately not built here"),
reactions/emoji, branch protection, wiki content, deployments/environments, dependabot/security advisories.
Assignees, labels and milestone are not in the GraphQL set and do not need to be — the REST **search** hit
is kept verbatim as the atom's `raw` and already carries all three.

**Truncation — measured, and reported.** `PR_ACTIVITY_QUERY` requests `reviews(first:100)`,
`comments(first:100)`, `reviewThreads(first:100){...comments(first:100)}` and `timelineItems(first:100,...)`
with **no `pageInfo`/`after` on any of them**, and they do overflow: a `#<n>:review:99` sourceId stands in
bronze, which is a `reviews(first:100)` returning its hundredth node, and four pull requests carry more than
174 comment records each. Reproduce:

```bash
grep -o '"sourceId":"#[0-9]*:review:[0-9]*"' ~/.slopweaver/corpus/bronze/github/compact.jsonl \
  | sed 's/.*:review://;s/"//' | sort -n | tail -1
```

`saturatedConnections` (`activity.ts`) names every connection that came back full, and the projection puts that list on the atom as a `truncated` attr, so a row that may be cut short says so. It deliberately does NOT also set the corpus-wide `capture: partial` marker: `latestRecords.supersedes` hands a same-instant, same-text tie to the row that does not declare itself partial, and older GitHub atoms carry no marker — so marking a refetched row makes the THINNER predecessor win on exactly the giant pull requests a wider capture is for. The marker belongs with the paging fix that gives GitHub a genuine repaired row to prefer. **Paging those connections is unbuilt and is its own row**; this is the witness that says how often it matters, not the fix. Releases and milestones (`curatedFetch.ts`, `makeGithubCuratedApi`)
remain single-page REST calls with no follow-up loop and no marker.

**Two other failures are reported rather than silent** (`fetch.ts` counts them, `crawlWarnings.ts` words them), both of which a whole-population
refetch depends on:

- A per-item enrichment failure ships the atom without its activity — correct, since one bad item must never
  sink a refresh — and a selection set naming one field GitHub does not have fails EVERY item identically. `enrichFailureWarnings` reports the count, the population and the first
  cause, so that case is one line rather than a clean number over an otherwise bare whole-population refresh.
- Issue search stops at 1000 results however many exist. `searchCapWarnings` reports a window that stopped
  at the ceiling on a FULL page — the decidable difference between a truncated window and an exhausted
  one — and names `--since`/`--until` as the fix.

**Rate limiting:** a documented (not live-measured) budget registry (`github` in `src/lib/rateLimitsPlatforms.ts` —
read 5,000/hr, write 500/hr) maps every GitHub operation to a class, but only `github:write` is proactively
paced (`providerCall.ts:131`); reads rely on Octokit's own retry/throttle plugins reacting to a real 429. The
registry also does not model GraphQL's per-query points cost — every `github.graphql.*` call is charged as one
flat `read` request regardless of how many nested nodes it actually fans out to.

## Slack

`src/corpus/slack/*.ts`. Identity capture on `users.list` is solid (id, email when scoped, display/real name,
title, timezone, active/bot/guest/admin, avatar) — see § Identity-bearing fields above for the three
author-field gaps (file/pin resolved-to-name, repaired in silver; canvas author absent, unrepairable).

**Two scope/permission gaps:**

- `SLACK_REQUIRED_USER_SCOPES` (`connect/slack.ts`) omits `im:read`, `im:history`, `mpim:read`,
  `mpim:history` — yet `conversations.list` is called for every conversation class (`corpus/slack/lanes.ts`),
  so DMs and group DMs are discovered without ever declaring the scopes their history actually needs.
  **Group DMs are their own lane**: measured, `public_channel` present in the `types` list makes
  Slack serve ZERO `mpim` rows all the way to exhaustion — one combined call returned 548 public, 57
  private, 81 DMs and no group DM at all. The measurement and both registries live in `corpus/slack/lanes.ts`.
- `connect slack --check` does **not** verify granted scopes against the required list
  (`checkSlackConnection`, `connect/slack.ts`, never passes `auth.value.scopes` to the classifier) —
  contradicting `src/onboard/tiers.ts`'s header claim that it does. Correct the claim or build the check.

**One silent-truncation gap that does not warn** (contrast with the rest of the connector, where
`lib/paging.ts` pushes a warning on every cap/stuck cursor): curated pins/bookmarks are hard-capped to the top
10 most-active channels (`CURATED_PIN_CHANNEL_CAP`, `curatedFetch.ts`) — channels 11+ get none, silently.
Canvas discovery via `files.list` pages by ordinal to the last page (`slackFiles`, `api.ts`).

**Never touched:** huddles, workflow-builder objects. Per-reactor identity on a reaction is dropped to a
`:name: xN` count (`fetch.ts:328-343`) — the reactor list survives only inside the message's `raw`.

**Rate limiting:** the read client (`api.ts`) sets `rejectRateLimitedCalls: true, retries: 0`, so every 429
surfaces to the shared cross-process rate block rather than being swallowed by the SDK, per that file's own
dated measurement note. The **write path** (`writeApi.ts`) has not been separately verified — do not assume
it carries the same guarantee.

## Notion

`docs/notion-coverage.md` already covers the block-rendering/recursion/depth-cap findings from its
workspace census; this section covers the identity-field angle that file does not.

**Covered:** a page body is one `pages.retrieveMarkdown` call (`liveMarkdown.ts`), so no block-depth cap
applies to it — `--notion-block-depth` still parses and prints in the caps line, but bounds only a block
renderer nothing calls (`liveBlocks.ts`). A child page is a reference in that markdown, never inlined: its id
is queued and it is read as a page of its own (`pageFrontier.ts`).

**By design or unrequested:** `pages.properties.retrieve`, `views.*`, `blocks.meetingNotes.query` and the `unique_id` property
type are unrequested, absent by grep. Three the census listed as unrequested are in use: `dataSources.query`
always sends a descending `last_edited_time` sort, plus an `on_or_after` filter under any cutoff, so not for
`--all` (`rowQueryBounds`, `liveApiDatabases.ts`); a page body comes from one `pages.retrieveMarkdown` call
(`liveMarkdown.ts`); and `in_trash` is read and set only on the write path (`writeApi.ts`).

**Partial:** `dataSources.retrieve` is called from a _separate_ structure lane (`structures.ts`) that lands
the full property schema in a `StructureBronzeRow` — the searchable **database** record a query reads
hardcodes `description: ""` (`fetchProject.ts`), so the schema exists in a sibling store rather than in the
corpus record a query would find.

**A duplicate-identity collision, the same class of defect the Notion memory flagged for a different pair
of lanes:** the
`pages`/`search` lane (`projectPageItem`, full block body, no properties) and the
`databases`/`dataSources.query` lane (`projectRowItem`, flattened properties, no block body) both feed
`pageChunkRecord` with `sourceId: page:<id>` for the same underlying row — because a database row is itself a
Notion `page` object, `search` filtered to `object: "page"` (`liveApiPagesLane.ts`) returns rows too, and
nothing filters a search hit by `parent.type` to exclude them from the `pages` lane. `fetchNotionActivity`
then concatenates both lanes' results with no de-dup by id. Net effect: the same row can
produce two records under the identical `sourceId`, one with a body and no properties, the other with
properties and no body — unverified by any existing test either way.

## The harness-vs-standalone decision, recorded

The completeness harness, which proves a live source, owns the ROW axis — paging, auth,
redaction, rate limits. This document is the FIELD axis: whether a captured row carries every field the API
offered, not whether every row was captured. It stands alone; once that harness exists, fold these findings
into it as a field-coverage axis rather than building a third completeness lineage.
