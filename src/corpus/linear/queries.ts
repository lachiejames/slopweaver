/**
 * Every Linear GraphQL query text, in one place, plus the registry of NESTED connections that can overflow
 * their inline page.
 *
 * Split out of `fetch.ts` because the selection roughly tripled and a reviewer needs to be able to read
 * "what do we ask Linear for?" as one artefact rather than reconstructing it from six template literals
 * interleaved with paging logic.
 *
 * ## Three rules this file exists to hold
 *
 * 1. **Every field here was verified against the live schema** by introspection, including
 *    `includeDeprecated: true`. That check found two fields the connector was ALREADY selecting which Linear
 *    has deprecated: `Project.state` ("Use project.status instead") and `Team.private` ("Use `Team.visibility`
 *    instead."). Both are replaced below. Default introspection hides deprecated fields, so a naive check
 *    reports them as MISSING — worth knowing before anyone repeats it.
 * 2. **`includeArchived: true` goes everywhere it is accepted, and nowhere else.** Introspection of the
 *    argument lists is the authority, not intuition: `Issue.stateHistory`, `Comment.reactions` and the root
 *    `templates` take NO such argument, and passing it to them is a query-validation error that would fail the
 *    whole page. Every other connection here takes it. Without it a Q1-2025 control window showed 691 issues
 *    of which 152 were visible — 78% dropped — at zero extra request cost.
 * 3. **Nothing is capped where a cap can silently lose data.** Each entry in {@link NESTED_CONNECTIONS} names
 *    an inline first-page size AND is paged to exhaustion by one shared collector, so the inline size is a
 *    latency optimisation rather than a ceiling. `projectUpdates(first: 10)` used to lose 89 of 868 project
 *    updates — 10.3% of all project-status narrative — and `team.members` passed no `first:` at all, silently
 *    taking GraphQL's default of 50 and dropping 38 members from one 88-member team. The project, initiative
 *    and user registries that used to sit beside it are GONE: those connections are reached from their own
 *    root lanes or a companion document now, so there is no inline page left to overflow.
 *
 ## Complexity, and the inherited claim this file FALSIFIED
 *
 * Linear caps a single query at 10,000 complexity points. The measurement this work inherited was that
 * complexity "tracks the size of the NESTED connections and is independent of the outer page size" —
 * `history(100)` + `stateHistory(100)` costing the same 474 points at `first=1` and `first=50`. That
 * measurement was taken over connections selecting SCALARS only, and it does not generalise.
 *
 * MEASURED here, against the live API, with the first version of this selection: a page of just
 * FIVE issues cost **9,454** points — about 1,891 per issue, against roughly 2.4 per nested item in the
 * scalar-only measurement. At `first: 50` the same shape would have been ~19,000 and every page would simply
 * have failed. The teams query cost **81,430** and the users query **12,175**; both were hard errors, not
 * warnings. The inherited caveat was right that nested-inside-nested was UNMEASURED, and this is what it costs.
 *
 * What drove it was OBJECT sub-selections inside a nested connection, not the connection sizes.
 * `history(100)` with twenty-two `from*`/`to*` object selections is 2,200 object resolutions, not 100.
 *
 * So the selections below follow one rule: **inside a nested connection, prefer the scalar `*Id` field over
 * the object.** Linear exposes `fromStateId`, `toAssigneeId`, `addedLabelIds` and the rest as plain strings.
 * Four objects are kept because a digest a human reads needs NAMES rather than UUIDs — the actor and the
 * from/to workflow state — and everything else is captured by id. The ids are still the complete record of
 * what changed; they are simply not resolved to names at fetch time.
 *
 * The inline sizes are then set against the MEASURED per-connection maxima (relations 11, children 24,
 * labels 7, attachments 34; comments overflow on 0.6% of issues; history p95 20 with a true max of 478), so
 * the common case costs one request and the tail costs one more — never a per-issue fetch, which is forbidden.
 */

import { LinearDocument } from "@linear/sdk";

import type { LinearRefSpec } from "./names.js";

/** The default root page size, for the lanes with no fat nested fan-out. */
export const PAGE_SIZE = 50;

/**
 * Issues per page: the MAXIMUM, because for this query the outer page size is free.
 *
 * That took three rounds of measurement to establish, and the middle round drew the wrong conclusion, so the
 * whole sequence is worth recording:
 *
 *  1. The first version of this selection cost **9,454** points for FIVE issues against a 10,000 ceiling. I
 *     concluded complexity scaled with the outer page and cut the page size.
 *  2. Replacing seventeen nested OBJECT selections with their scalar `*Id` equivalents took it to **1,050** —
 *     a 9x reduction. The projects query then failed at 14,424, which I again blamed on the outer page.
 *  3. Measuring the actual matrix: `issues` costs **1,050 at first=20, 30, 40 AND 50** — dead flat — while
 *     `projects` scales linearly (5,409 at 15, 9,015 at 25, over the ceiling at 40). The inherited claim that
 *     complexity is independent of the outer page size is TRUE for this query and FALSE for that one. What
 *     actually drives the issues cost is the INLINE sizes: 1,050 / 1,556 / 2,062 / 2,568 at x1 / x1.5 / x2 / x2.5.
 *
 * So the two lanes want opposite things, and guessing which is which cost two wasted rounds. Issues takes the
 * largest page Linear allows; projects stays small (see {@link PROJECTS_PAGE_SIZE}).
 *
 * **Raised from 50 to 250 by the move onto `IssuesDocument`, and forced by arithmetic rather than chosen.**
 * MEASURED live: the SDK's document costs **31 complexity points at `first: 250`** — flat, and
 * 34x cheaper than the 1,050 our own selection cost at 50, because every nested connection has moved out of
 * it. What moved out did not become free, though: each of those connections is now its own request per PAGE,
 * so a page size of 50 would multiply the whole crawl's request count by five. At 250 the full-backfill
 * request count comes out BELOW where it started. Reproduce with the probe in
 * `~/.slopweaver/probes/linear-sdk-<date>/`.
 */
export const ISSUES_PAGE_SIZE = 250;

/**
 * Projects per page. This is the lane whose cost DOES scale with the outer page: measured 5,409 at 15, 9,015 at
 * 25, and over the 10,000 ceiling at 40. 15 sits at 54% of the ceiling, which leaves room for a project with
 * more members or labels than any in the workspace today; 25 would sit at 90% and leave none.
 */
export const PROJECTS_PAGE_SIZE = 15;

/**
 * Initiatives per page. The smallest of the lot, and measured: `initiatives(50)` with `projects(60)` is 3,000
 * nested connection items and cost **14,424** points — a constant failure, independent of any `--fetch-cap`,
 * which is how it was finally identified after two rounds of blaming the issues and projects lanes.
 *
 * The nested `projects(60)` is NOT reduced: the measured maximum is 51 projects on one initiative, and cutting
 * it below that would orphan real projects to save a budget the outer page can pay for instead. Measured
 * 2,027 at 10, 5,068 at 25, and over the ceiling at 50 — so 25, at half the ceiling.
 */
export const INITIATIVES_PAGE_SIZE = 25;

/** Documents per page. Six single-object parent bindings each, so a smaller page keeps real headroom. */
export const DOCUMENTS_PAGE_SIZE = 50;

/**
 * Page size for the flat BULK-ENTITY lanes — customer needs, milestones, labels, views, external users.
 *
 * Large, because these are measured CHEAP: `customerNeeds` costs 385 at 50 and 1,925 at 250, scaling linearly
 * from a low base, so 250 is under a fifth of the ceiling. It cuts a few thousand customer needs' requests
 * fivefold, and the request budget is the one this crawl has to spend carefully.
 */
export const ENTITY_PAGE_SIZE = 250;

/**
 * Inline first-page sizes for the four connections {@link ISSUE_ACTIVITY_QUERY} still carries inline.
 *
 * Complexity is charged on the size REQUESTED, not returned, so a generous inline page spends points on
 * empty slots for every issue in order to save a follow-up REQUEST on the few that overflow. That is the
 * actual trade, and it is worth making: each size below is above the measured per-connection maximum
 * (attachments 34, subscribers 3 in a live sample of 50; only 0.025% of issues have more than 100 history
 * events), so follow-ups are the rare tail rather than 70% of all requests, which is what they were at
 * tighter sizes. MEASURED at these sizes, live: 1,917 points, flat in the outer page size.
 *
 * @internal — read by `ISSUE_ACTIVITY_CONNECTIONS` in this file; the document it sizes is not sent elsewhere.
 */
export const ATTACHMENTS_PAGE_SIZE = 40;

/**
 * Inline first-page size for an issue.s subscribers (measured: max 3 across a live sample of 50 issues).
 *
 * @internal — read by `ISSUE_ACTIVITY_CONNECTIONS` in this file; the document it sizes is not sent elsewhere.
 */
export const SUBSCRIBERS_PAGE_SIZE = 40;

/** Inline first-page size for an issue's activity history (measured: p95 is 20; only 0.025% exceed 100). */
export const HISTORY_PAGE_SIZE = 100;

/** Comments per page on the ROOT comments walk, which is filtered to one page of issues. */
export const COMMENTS_PAGE_SIZE = 250;

/**
 * Page size for the USERS lane. Smaller than the issue lane's because each user node carries a `teams`
 * connection, and the two multiply: `users(50)` with `teams(100)` measured 12,175 points — over the ceiling.
 */
export const USERS_PAGE_SIZE = 25;

/**
 * One activity event: who changed what, from what, to what, when.
 *
 * SIX object selections, and no more: `actor`, `botActor`, the from/to workflow state and the from/to assignee.
 * Those are the ones a human-readable digest cannot do without — who did it, what state it moved between, and
 * who it moved to. Everything else is captured by its scalar `*Id`, because twenty-two object selections inside
 * a 50-item connection is ~1,100 object resolutions per issue, and that is what took a FIVE-issue page to 9,454
 * points against a 10,000 ceiling.
 *
 * Nothing is LOST by this: the ids are the complete record of what changed. They are simply not resolved to
 * names at fetch time, and the corpus already holds the users, cycles, projects, teams and labels those ids
 * point at, so a reader can resolve them locally for free.
 */
const HISTORY_FIELDS = `
  id createdAt actorId
  actor { id displayName }
  botActor { name }
  fromState { name } toState { name }
  fromAssignee { id displayName } toAssignee { id displayName }
  fromPriority toPriority
  fromEstimate toEstimate
  fromTitle toTitle
  fromDueDate toDueDate
  fromCycleId toCycleId
  fromProjectId toProjectId
  fromParentId toParentId
  fromTeamId toTeamId
  addedLabelIds removedLabelIds
  archived trashed autoArchived autoClosed updatedDescription
  attachmentId
`;

/**
 * A workflow-state SPAN — additive to `history`, not a substitute. It rides the issue page free and yields
 * time-in-state directly, but it carries NO actor, so it cannot say who moved an issue. Note it also has no
 * `createdAt`: spans are keyed by `startedAt`.
 */
const STATE_HISTORY_FIELDS = `id stateId startedAt endedAt state { name }`;

/** One nested connection that must be paged to exhaustion rather than trusted to fit its inline page. */
export interface NestedConnection {
  /** The field name on `Issue`. */
  readonly key: string;
  /** The node selection. */
  readonly fields: string;
  /** The inline first-page size, and the size of each follow-up page. */
  readonly pageSize: number;
  /**
   * Whether this connection accepts `includeArchived`. VERIFIED per connection by introspecting the argument
   * lists — `stateHistory` does not take it, and passing it there fails the whole query.
   */
  readonly acceptsIncludeArchived: boolean;
  /**
   * Any FURTHER arguments the connection needs, verbatim and without a trailing comma.
   *
   * This exists because a review pass found `Initiative.projects` selecting `includeSubInitiatives: true`
   * inline while its follow-up emitted only `includeArchived`/`first`/`after`. That is worse than truncation:
   * the follow-up pages a DIFFERENT connection (direct projects only) using a cursor minted by the one that
   * included sub-initiatives. Holding the arguments on the descriptor is what makes the inline page and its
   * continuation the same connection by construction.
   */
  readonly extraArgs?: string;
}

/** `includeArchived: true, ` when the connection accepts it, else nothing. Pure. */
function archivedArg({ accepts }: { accepts: boolean }): string {
  return accepts ? "includeArchived: true, " : "";
}

/**
 * Every argument a connection needs EXCEPT `first`/`after`, with a trailing separator. Pure.
 *
 * Used by both the inline selection and the follow-up query, which is the point: an argument that narrows or
 * widens a connection must appear in both or the continuation pages something else. Nothing may build these
 * arguments by hand.
 *
 * @param conn the connection descriptor
 * @returns the argument prefix, ending in ", " when non-empty
 */
function connectionArgs({ conn }: { conn: NestedConnection }): string {
  const extra = conn.extraArgs === undefined ? "" : `${conn.extraArgs}, `;
  return `${archivedArg({ accepts: conn.acceptsIncludeArchived })}${extra}`;
}

/**
 * The root issues lane, and the four joins that carry what its nested connections used to.
 *
 * `IssuesDocument` carries all nineteen issue-level scalars this connector reads — verified field by field
 * against `ISSUE_SCALAR_FIELDS` before the move — and every relation as a bare `{ id }`, which `./names.ts`
 * resolves. What it carries no connections for is where the work went:
 *
 * | was inline on the issue | is now |
 * | --- | --- |
 * | `comments` | the ROOT `comments` connection, filtered to the page's issues (`CommentFilter.issue.id.in`) |
 * | `relations`, `inverseRelations` | ONE walk of the root `issueRelations`, indexed both ways by the reference pass |
 * | `children` | `IssuesDocument` again, filtered by `parent.id.in` — the same document, one more request |
 * | `labels` | the fragment's own `labelIds`, joined against the `issueLabels` reference lane, at NO request |
 * | `subscribers`, `attachments`, `history`, `stateHistory` | {@link ISSUE_ACTIVITY_QUERY}, the one document below |
 *
 * `includeArchived: true` remains the single most valuable argument in this file — 78% of a control window
 * was invisible without it, at zero extra request cost — and `orderBy: updatedAt` is still DESCENDING, which
 * is why a capped fetch must never advance the watermark: it keeps the newest and would move the cursor past
 * everything it did not take.
 */
export const ISSUES_QUERY = String(LinearDocument.IssuesDocument);

/**
 * Which reference kind each of an issue's bare `{ id }` relations points at.
 *
 * `state` is a WORKFLOW STATE and a project's `status` is a PROJECT STATUS. Both carry `name` and `type`, so
 * resolving one against the other's index would answer with a real name belonging to a different object —
 * which is the whole reason these specs are per lane rather than global.
 */
export const ISSUES_REFS: LinearRefSpec = {
  assignee: "user",
  creator: "user",
  cycle: "cycle",
  parent: "issue",
  project: "project",
  projectMilestone: "milestone",
  state: "workflowState",
  team: "team",
};

/** An issue's comments, at the ROOT. The `Comment` fragment carries `issueId`, so the join needs no lookup. */
export const COMMENTS_QUERY = String(LinearDocument.CommentsDocument);

export const COMMENTS_REFS: LinearRefSpec = { externalUser: "externalUser", user: "user" };

/**
 * The four issue connections that stay hand-written, and the measurement behind each.
 *
 * This is the one hand-written document for Issue.history +
 * Issue.stateHistory, kept so the activity digest survives — and it carries two more connections for reasons of
 * the same kind, each a COST or a SCHEMA fact rather than a preference:
 *
 * - **`history` and `stateHistory`.** `Issue_HistoryDocument` reaches them perfectly well and costs **4,442
 *   complexity points PER ISSUE** — over a hundred million for a workspace of tens of thousands of issues, against a 3,000,000/hour budget —
 *   because it selects the whole `IssueHistory` fragment with its `from*`/`to*` OBJECTS. The selection below
 *   replaces seventeen of those with their scalar `*Id` equivalents, which is what took a page from 9,454
 *   points to 1,050. Nothing is lost by it: the ids ARE the complete record of what changed, and the corpus
 *   holds the users, cycles, projects, teams and labels they point at. Six objects are kept because a digest
 *   a human reads needs NAMES — the actor, and the from/to workflow state.
 * - **`subscribers`.** Linear ships no root `subscribers` connection at all, and no filter that would reach
 *   one page of issues' subscribers. Every issue in a live sample of 50 carried some (max 3).
 * - **`attachments`.** There IS a root `attachments` connection — and `AttachmentFilter` has **no `issue`
 *   field**, verified live: `Field "issue" is not defined by type "AttachmentFilter"`. So
 *   reaching it from the root means walking every attachment in the workspace on every crawl, to keep the
 *   ones belonging to one page.
 *
 * MEASURED live: **1,917 complexity points, and FLAT in the outer page size** — identical at
 * `first: 25` and `first: 50` — which is the same property the original nested measurement found and is what
 * makes one companion request per page the right shape.
 */
// linear-sdk-documents-exempt: history is 4,442 points/issue via the SDK; subscribers and attachments have no reachable root
export const ISSUE_ACTIVITY_QUERY = `
query SlopweaverIssueActivity($ids: [ID!]!, $first: Int!) {
  issues(filter: { id: { in: $ids } }, first: $first, includeArchived: true) {
    nodes {
      id
      subscribers(first: ${String(SUBSCRIBERS_PAGE_SIZE)}, includeArchived: true) {
        nodes { id displayName }
        pageInfo { hasNextPage endCursor }
      }
      attachments(first: ${String(ATTACHMENTS_PAGE_SIZE)}, includeArchived: true) {
        nodes { id title url }
        pageInfo { hasNextPage endCursor }
      }
      history(first: ${String(HISTORY_PAGE_SIZE)}, includeArchived: true) {
        nodes { ${HISTORY_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
      stateHistory(first: ${String(HISTORY_PAGE_SIZE)}) {
        nodes { ${STATE_HISTORY_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** The four connections {@link ISSUE_ACTIVITY_QUERY} carries, in the order it selects them. */
export const ISSUE_ACTIVITY_CONNECTIONS: readonly NestedConnection[] = [
  { acceptsIncludeArchived: true, fields: `id displayName`, key: "subscribers", pageSize: SUBSCRIBERS_PAGE_SIZE },
  { acceptsIncludeArchived: true, fields: `id title url`, key: "attachments", pageSize: ATTACHMENTS_PAGE_SIZE },
  { acceptsIncludeArchived: true, fields: HISTORY_FIELDS, key: "history", pageSize: HISTORY_PAGE_SIZE },
  // NO includeArchived — the schema does not accept it here, and asking would fail the page.
  { acceptsIncludeArchived: false, fields: STATE_HISTORY_FIELDS, key: "stateHistory", pageSize: HISTORY_PAGE_SIZE },
];

/**
 * The root field a parent entity is fetched back through, for a follow-up page.
 *
 * Down to ONE member, and that is the migration's doing rather than a narrowing for its own sake: the
 * project, initiative and user lanes no longer page a nested connection at all — each reaches what it needs
 * from a root connection or a companion document — so `issue` is the only parent left with an inline page
 * that can overflow. A union of one still earns its name: it is what stops a follow-up being aimed at a
 * parent the inline page did not come from, which is the defect this type was introduced for.
 */
export type LinearParent = "issue";

/**
 * The follow-up query for ONE overflowing nested connection on ONE parent entity.
 *
 * Parameterised by the PARENT, not just by the connection, and that generalisation was forced by a review
 * finding rather than foresight: the issue lane paged every connection to exhaustion while
 * `Project.teams`/`members`/`labels`/`initiatives`/`externalLinks`, `Initiative.projects`/`links` and
 * `User.teams` selected `pageInfo { hasNextPage }` and then did nothing with it. A comment claimed overflow was
 * "detectable"; nothing read the flag, so a project with more teams than the inline page simply lost the
 * remainder — silently, which constraint 3 (`docs/constraints/hard.md`) forbids.
 *
 * @param conn the connection to page
 * @param parent the root field its holder is fetched back through
 * @returns the GraphQL document text
 */
export function nestedConnectionQuery({
  conn,
  parent = "issue",
}: {
  conn: NestedConnection;
  parent?: LinearParent;
}): string {
  return `
query ParentConnection($id: String!, $after: String) {
  ${parent}(id: $id) {
    ${conn.key}(${connectionArgs({ conn })}first: ${String(conn.pageSize)}, after: $after) {
      nodes { ${conn.fields} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
}

/**
 * The projects lane, and the ONE companion document the SDK cannot replace.
 *
 * `ProjectsDocument` carries every scalar this connector reads — `content`, the project's full rich-text
 * brief, included — plus `status { id }`, `lead { id }` and `labelIds`. What it carries NO connections for at
 * all is `teams`, `members` and `externalLinks`, and unlike an issue's comments or labels there is no ROOT
 * connection to page them from either: Linear ships no `projectTeams`, no `projectMembers` and no
 * `entityExternalLinks`. The only SDK-expressible alternative is `Project_TeamsDocument` and friends, one
 * request PER PROJECT — and MEASURED live a working workspace holds **over a thousand projects**,
 * every one carrying teams, most carrying members and some carrying external links. Three requests per
 * project is thousands of requests against a 2,500/hour budget to fetch data the old document got inline, which is the exact
 * N+1 this connector exists to refuse.
 *
 * So {@link PROJECT_CONNECTIONS_QUERY} below stays hand-written, selecting those three connections and
 * NOTHING else, addressed by the same page of ids the SDK document just returned. One extra request per
 * page, measured at 5,360 complexity points for fifteen projects.
 */
export const PROJECTS_QUERY = String(LinearDocument.ProjectsDocument);

/** A project's `status` is a PROJECT STATUS, never a workflow state — resolving it against the wrong index
 * would report `Completed` as an issue state that happens to share the name. */
export const PROJECTS_REFS: LinearRefSpec = { lead: "user" };

/**
 * The three project connections `@linear/sdk` ships no way to reach, and the reason this document exists.
 *
 * Selecting `id` and the three connections only: it is a COMPANION to `ProjectsDocument` rather than a
 * replacement for it, addressed by the ids that document just returned, so every scalar still comes from the
 * SDK. The inline sizes are 50 against measured maxima of 7 teams, 6 members and 5 links, so an overflow is
 * not reachable in practice — and `pageInfo` is still selected and still READ, because
 * "not reachable today" is how `projectUpdates(first: 10)` came to lose about a tenth of its updates.
 */
// linear-sdk-documents-exempt: teams/members/externalLinks have no root connection, and per-project is thousands of requests
export const PROJECT_CONNECTIONS_QUERY = `
query SlopweaverProjectConnections($ids: [ID!]!, $first: Int!) {
  projects(filter: { id: { in: $ids } }, first: $first, includeArchived: true) {
    nodes {
      id
      teams(first: 50, includeArchived: true) { nodes { key } pageInfo { hasNextPage endCursor } }
      members(first: 50, includeArchived: true) { nodes { id displayName } pageInfo { hasNextPage endCursor } }
      externalLinks(first: 50, includeArchived: true) { nodes { label url } pageInfo { hasNextPage endCursor } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * A project's status updates, at the ROOT and filtered to the page of projects being crawled.
 *
 * This connection was once capped at `first: 10` and never paged, which lost 89 of 868 project updates —
 * 10.3% of all project-status narrative, and the most deliberately-authored content Linear holds. Reaching it
 * from the root closes that by construction: there is no inline page to overflow, and
 * `ProjectUpdateFilter.project.id.in` narrows it to exactly the page in hand (verified live, 505
 * complexity points).
 */
export const PROJECT_UPDATES_QUERY = String(LinearDocument.ProjectUpdatesDocument);

/** Updates per page on that root walk. It is filtered to one page of projects, so the ceiling is generous. */
export const PROJECT_UPDATES_PAGE_SIZE = 250;

export const PROJECT_UPDATES_REFS: LinearRefSpec = { user: "user" };

/**
 * The project↔initiative edges, at the ROOT — one walk, joined locally in BOTH directions.
 *
 * It replaces a nested `initiatives` connection on the projects lane AND a nested `projects` connection on
 * the initiatives lane, which is why it lives in the reference pass rather than in either. MEASURED live:
 * hundreds of links in a handful of pages, a few thousand complexity points for the whole workspace.
 *
 * One thing it does NOT reproduce, stated rather than discovered: the old initiatives document asked for
 * `projects(includeSubInitiatives: true)`, so a parent initiative listed its children's projects as its own.
 * The root edges are DIRECT links only. The expansion is a local join instead — the SDK's `Initiative`
 * fragment carries `parentInitiative { id }`, so the tree is walkable without asking the provider.
 *
 * @internal — sent by `./references.ts`.s initiative-to-projects lane, which lives beside this file.
 */
export const INITIATIVE_TO_PROJECTS_QUERY = String(LinearDocument.InitiativeToProjectsDocument);

/**
 * The initiatives lane — the top-level strategy artefact, and its own companion document.
 *
 * Same shape as the projects lane and the same reason: `InitiativesDocument` carries every scalar including
 * `content`, the full brief, plus `owner { id }` and `labelIds`; its `links` connection has no root
 * equivalent in the SDK at all. There are only 90 initiatives in this workspace, so the companion is ONE
 * request for the whole lane rather than one per page.
 */
export const INITIATIVES_QUERY = String(LinearDocument.InitiativesDocument);

export const INITIATIVES_REFS: LinearRefSpec = { owner: "user" };

/** An initiative's external links — the one connection with no root equivalent. */
// linear-sdk-documents-exempt: Initiative.links has no root connection, and per-initiative is one request each
export const INITIATIVE_CONNECTIONS_QUERY = `
query SlopweaverInitiativeConnections($ids: [ID!]!, $first: Int!) {
  initiatives(filter: { id: { in: $ids } }, first: $first, includeArchived: true) {
    nodes {
      id
      links(first: 50, includeArchived: true) { nodes { label url } pageInfo { hasNextPage endCursor } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Every org member, and the per-lane maps that put the SDK's bare `{ id }` references back together.
 *
 * From here down, every document is `@linear/sdk`'s own generated operation and every nested object a
 * projector reads is resolved from `./references.ts`'s index rather than selected inline. Each lane
 * therefore carries a {@link LinearRefSpec} beside its document: which reference KIND each nested field on
 * that lane's node points at. Per lane rather than one global map, because the same field name means
 * different things on different types — `issue.parent` is an ISSUE and `issueLabel.parent` is a LABEL, and
 * resolving one against the other's index would silently produce a name from the wrong object.
 *
 * `title` on a user, `description` on a label and the rest are unchanged: the generated fragments are WIDER
 * than the hand-written selections they replace, so nothing scalar is lost on any of these lanes.
 * `includeDisabled: true` still rides the users lane — the SDK's document declares it — so a deactivated
 * teammate's past work still has an author.
 *
 * The team membership a user's `teams` connection used to carry is NOT on the `User` fragment, and it is not
 * missing: the root `teamMemberships` connection carries every `team { id }` / `user { id }` edge and
 * `./structures.ts` already walks it, which is where a team's roster is filed.
 */
export const USERS_QUERY = String(LinearDocument.UsersDocument);

/**
 * A user node carries no nested reference a projector reads — every field it needs is a scalar.
 *
 * @internal — declared for symmetry with every other lane's ref spec; the users lane hydrates nothing.
 */
export const USERS_REFS: LinearRefSpec = {};

/**
 * The documents lane. The parent bindings were ALL dropped by the original connector, so documents landed in
 * the corpus context-free — a spec with no indication of what it specifies. The SDK's `Document` fragment
 * carries FIVE of the six as ids; `team` it does not select at all, and it is joined per page from a
 * per-team walk of this same document (`./fetchJoins.ts`'s `documentTeamsFor`). The spec below is what
 * turns all six back into names.
 */
export const DOCUMENTS_QUERY = String(LinearDocument.DocumentsDocument);

export const DOCUMENTS_REFS: LinearRefSpec = {
  creator: "user",
  initiative: "initiative",
  issue: "issue",
  owner: "user",
  project: "project",
  // Not on the fragment at all: joined per page from the per-team walk in `./fetchJoins.ts`, then resolved here.
  team: "team",
};

/*
 * The EIGHT bulk entities the connector never fetched, all reachable at the root with no per-parent N+1.
 *
 * In a working team's workspace each runs from dozens to thousands of rows: customer needs (carrying real
 * customer prose), project milestones, issue labels (only label NAMES rode the issue query, so every
 * description and the whole label hierarchy were lost), initiative→project links, external users (the
 * non-member commenters who were anonymous), custom views, initiative updates and templates.
 *
 * `roadmaps` and `facets` no longer exist as root queries — do not chase them. `initiativeLabels`,
 * `customerTiers`, `agentSkills` and `initiativeRelations` are often empty. `auditEntries` exists and
 * answers a non-admin key HTTP 403 (`Invalid role: admin required`): it is the only true org activity log in
 * the API and a non-admin key cannot read it. Reported, not routed around.
 */

/**
 * Customer needs — the one entity here that carries verbatim CUSTOMER prose rather than internal chatter,
 * which is why it earns its own searchable record kind rather than an attribute somewhere.
 */
export const CUSTOMER_NEEDS_QUERY = String(LinearDocument.CustomerNeedsDocument);

export const CUSTOMER_NEEDS_REFS: LinearRefSpec = {
  creator: "user",
  customer: "customer",
  issue: "issue",
  project: "project",
};

/** Project milestones — the dated checkpoints a project is actually measured against. */
export const PROJECT_MILESTONES_QUERY = String(LinearDocument.ProjectMilestonesDocument);

export const PROJECT_MILESTONES_REFS: LinearRefSpec = { project: "project" };

/** Initiative updates — the strategy layer's equivalent of a project status update. */
export const INITIATIVE_UPDATES_QUERY = String(LinearDocument.InitiativeUpdatesDocument);

export const INITIATIVE_UPDATES_REFS: LinearRefSpec = { initiative: "initiative", user: "user" };

/**
 * Templates — the org's own scaffolding for how work gets written down.
 *
 * `Query.templates` is `[Template]`, NOT a connection: it takes NO arguments at all, so it cannot be paged and
 * cannot be asked to include archived rows. The only one of the eight with that shape, and worth stating
 * because a paging loop written against it would silently do nothing. The SDK's document has the same shape.
 */
export const TEMPLATES_QUERY = String(LinearDocument.TemplatesDocument);

export const TEMPLATES_REFS: LinearRefSpec = { creator: "user", team: "team" };

/**
 * Issue labels, with the DESCRIPTIONS and the hierarchy the issue query never saw. A label group and its
 * children are org vocabulary — how the team names kinds of work — so these land in the structure store rather
 * than as activity records.
 *
 * Its `parent` is a LABEL, not an issue. That is the whole reason these specs are per lane.
 */
export const ISSUE_LABELS_QUERY = String(LinearDocument.IssueLabelsDocument);

export const ISSUE_LABELS_REFS: LinearRefSpec = { creator: "user", parent: "issueLabel", team: "team" };

/**
 * Custom views — saved filters. Structure rather than activity: a view is a durable statement about what a
 * team considers one body of work, which is exactly the org-scaffolding the structure store is for.
 */
export const CUSTOM_VIEWS_QUERY = String(LinearDocument.CustomViewsDocument);

export const CUSTOM_VIEWS_REFS: LinearRefSpec = { creator: "user", owner: "user", team: "team" };

/**
 * External users — non-member commenters. They land in the MEMBERS store, not as records: they are identity
 * substrate, and each carries an email, so the resolver can join a customer contact to the comments they left.
 */
export const EXTERNAL_USERS_QUERY = String(LinearDocument.ExternalUsersDocument);

/** Flat: an external user carries no reference at all. */
export const EXTERNAL_USERS_REFS: LinearRefSpec = {};
