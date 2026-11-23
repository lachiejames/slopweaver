/**
 * The LIVE leg of a local-first Linear query: a final check that the citations the local scan produced
 * still resolve, and still say what the corpus says they say.
 *
 * ## Why this is a verification pass and not a second search
 *
 * The corpus answers the question — it holds every facet, it is complete to its last refresh, and it costs
 * no quota. What it cannot do is notice that a ticket was closed, reassigned or archived since that refresh,
 * and a citation that has quietly gone stale is worse than no citation, because it reads as evidence. So the
 * live provider is asked exactly one thing about exactly the objects being cited: are you still what we say
 * you are. Never "search Linear for this query" — that would pay for the whole answer twice and is what this
 * design deliberately avoids.
 *
 * ## One request per team, never one per citation
 *
 * The Linear transport paces itself at {@link ../../corpus/linear/transport.LINEAR_RATE_PER_SEC} = 0.55
 * req/s, so a per-citation read of a ten-row page would take eighteen seconds and a verification nobody
 * waits for is a verification nobody runs. Issues are therefore verified by FILTER — one
 * `issues(filter: { team: { key }, number: { in } })` per distinct team on the page, typically one or two
 * requests for a whole page — and projects by one `projects(filter: { id: { in } })`.
 *
 * The filter shape is also what makes a MISSING object reportable at all. `issue(id:)` aliases would batch
 * into one request too, but graphql-request throws a `ClientError` whenever a response carries `errors`, so
 * a single deleted ticket would fail the verification of every other citation beside it. A filter simply
 * does not return the row, and the identifier that came back in nothing is `gone`.
 *
 * ## Plus at most three lookups, bounded by the SCHEMA rather than by the page
 *
 * `@linear/sdk`'s fragments carry every relation as a bare `{ id }`, so the state and assignee a citation
 * asserts are resolved afterwards, in one filtered `users` read, one filtered `workflowStates` read and one
 * `projectStatuses` read — whatever the page size, and none of them at all when the page carried no such id.
 * MEASURED live against this workspace (probe in `~/.slopweaver/probes/linear-sdk-<date>/`):
 * two issue citations and one project citation cost 5 requests and 1,234 complexity points, all three
 * `confirmed`, against the 2 requests the hand-written documents took. The `requests` field on the document
 * counts the lookups, so the number an operator reads is the number that was spent.
 *
 * ## What is compared, and what deliberately is not
 *
 * State, assignee (an issue) or lead (a project), title, and whether the object has been archived. Those are
 * the claims a citation MAKES — "this is open and it is yours" — so a drift in one of them changes what the
 * reader should do. Priority, cycle and labels are read into the local hit for filtering and are not
 * compared: they move constantly, they do not invalidate the citation, and reporting them would bury the
 * drift that matters under drift that does not.
 */
import { LinearDocument } from "@linear/sdk";
import type { LinearQueryHit } from "../../corpus/linear/query.js";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { LinearLiveError } from "./errors.js";
import { parseIssueIdentifier } from "./issueIdentifier.js";
import type { LinearDrift, LinearLiveFacts, LinearVerification, LinearVerifyDocument } from "./verifyDocument.js";
import { factsByIdentifier, fieldString, type LinearNameIndex, NO_NAMES, nestedId } from "./verifyNodes.js";
import type { LinearVerifyRequest, VerifyLeg } from "./verifyRequest.js";

/**
 * The two reads this pass makes, and the three lookups that turn their ids back into names.
 *
 * `@linear/sdk`'s `Issue` and `Project` fragments carry every relation as a bare `{ id }` — `state { id }`,
 * `assignee { id }`, `status { id }`, `lead { id }` — where our own documents selected `state { name }` and
 * `assignee { displayName }` in the same round trip. A citation asserts a NAME, so the ids have to be
 * resolved, and the whole design of this file's move onto the SDK is that they are resolved in **bounded,
 * filtered** lookups rather than per object: the distinct ids on the page are collected, and at most three
 * further requests answer all of them at once, whatever the page size.
 *
 * `status` rather than the sibling `state` field on a project, and the difference is not cosmetic: Linear
 * deprecated `state`, which now answers the status TYPE (`completed`), while the corpus records the status
 * NAME (`Completed`) exactly as `corpus/linear/project.ts` reads it. Compared against `state`, EVERY project
 * citation reported a false `Completed -> completed` drift — measured against the owner's own workspace,
 * 3 of 3 projects on the first page. The SDK's fragment selects BOTH, so the hazard survives the
 * move and {@link projectFacts} still reads `status`.
 */
const VERIFY_ISSUES_QUERY = String(LinearDocument.IssuesDocument);

const VERIFY_PROJECTS_QUERY = String(LinearDocument.ProjectsDocument);

/** Users, filtered to exactly the assignee and lead ids one page carried. */
const USERS_QUERY = String(LinearDocument.UsersDocument);

/** Workflow states, filtered to exactly the state ids one page carried. */
const WORKFLOW_STATES_QUERY = String(LinearDocument.WorkflowStatesDocument);

/**
 * Project statuses — the one lookup that cannot be filtered, because `ProjectStatusesDocument` declares no
 * `$filter` at all. It is a workspace-level vocabulary of a few rows, so the whole set is read.
 */
const PROJECT_STATUSES_QUERY = String(LinearDocument.ProjectStatusesDocument);

/** The `nodes` array under one connection field, defensively narrowed. Pure. */
function connectionNodes({ field, value }: { field: string; value: unknown }): readonly Record<string, unknown>[] {
  const root = isRecord(value) ? value[field] : undefined;
  const nodes = isRecord(root) ? root["nodes"] : undefined;
  return Array.isArray(nodes) ? nodes.filter(isRecord) : [];
}

/**
 * Shape one live `issues` node into the facts a citation asserts.
 *
 * @param node the raw issue node
 * @param names the id-to-name index the pass resolved, since the SDK's fragment carries relations as ids
 * @returns the facts, or undefined when the node carries no identifier to key on
 */
function issueFacts({
  node,
  names,
}: {
  node: Record<string, unknown>;
  names: LinearNameIndex;
}): LinearLiveFacts | undefined {
  const identifier = fieldString({ key: "identifier", node });
  if (identifier === undefined) {
    return undefined;
  }
  const assignee = nestedId({ key: "assignee", node });
  const state = nestedId({ key: "state", node });
  return {
    archived: fieldString({ key: "archivedAt", node }) !== undefined,
    identifier,
    owner: assignee === undefined ? undefined : names.users.get(assignee),
    state: state === undefined ? undefined : names.states.get(state),
    title: fieldString({ key: "title", node }) ?? identifier,
  };
}

/**
 * Shape one live `projects` node into the facts a citation asserts.
 *
 * @param node the raw project node
 * @param names the id-to-name index the pass resolved
 * @returns the facts, or undefined when the node carries no id to key on
 */
function projectFacts({
  node,
  names,
}: {
  node: Record<string, unknown>;
  names: LinearNameIndex;
}): LinearLiveFacts | undefined {
  const identifier = fieldString({ key: "id", node });
  if (identifier === undefined) {
    return undefined;
  }
  const lead = nestedId({ key: "lead", node });
  const status = nestedId({ key: "status", node });
  return {
    archived: fieldString({ key: "archivedAt", node }) !== undefined,
    identifier,
    owner: lead === undefined ? undefined : names.users.get(lead),
    state: status === undefined ? undefined : names.projectStatuses.get(status),
    title: fieldString({ key: "name", node }) ?? identifier,
  };
}

/** The display form of an absent facet, so a drift line never reads `undefined → Done`. Pure. */
const ABSENT = "(none)";

/** One compared field, or nothing when the two agree. Pure. */
function driftOf({
  field,
  local,
  live,
}: {
  field: LinearDrift["field"];
  local: string | undefined;
  live: string | undefined;
}): readonly LinearDrift[] {
  const before = local ?? ABSENT;
  const after = live ?? ABSENT;
  return before === after ? [] : [{ field, live: after, local: before }];
}

/**
 * Compare one local hit against the live facts for the same object.
 *
 * @param hit the corpus's claim about the object
 * @param facts what the provider says now, or undefined when the object did not come back at all
 * @returns the verdict, with one drift entry per field that moved
 */
export function compareHitToLive({
  hit,
  facts,
}: {
  hit: LinearQueryHit;
  facts: LinearLiveFacts | undefined;
}): LinearVerification {
  if (facts === undefined) {
    return { drifts: [], identifier: hit.identifier, status: "gone" };
  }
  const drifts = [
    ...driftOf({ field: "state", live: facts.state, local: hit.state }),
    ...driftOf({ field: "assignee", live: facts.owner, local: hit.assignee }),
    ...driftOf({ field: "title", live: facts.title, local: hit.title }),
    ...driftOf({ field: "archived", live: String(facts.archived), local: "false" }),
  ];
  return { drifts, identifier: hit.identifier, status: drifts.length === 0 ? "confirmed" : "changed" };
}

/** Group issue hits by the team key their identifier belongs to. Pure. */
function issuesByTeam({ hits }: { hits: readonly LinearQueryHit[] }): ReadonlyMap<string, readonly LinearQueryHit[]> {
  const grouped = new Map<string, LinearQueryHit[]>();
  for (const hit of hits) {
    const parsed = parseIssueIdentifier({ identifier: hit.identifier });
    const team = parsed?.team ?? UNPARSEABLE_TEAM;
    const bucket = grouped.get(team);
    if (bucket === undefined) {
      grouped.set(team, [hit]);
    } else {
      bucket.push(hit);
    }
  }
  return grouped;
}

/** The bucket every unparseable identifier lands in, so it is REPORTED rather than dropped. */
const UNPARSEABLE_TEAM = "";

/** A citation that could not be checked, carrying why. Pure. */
function unverified({ hit, reason }: { hit: LinearQueryHit; reason: string }): LinearVerification {
  return { drifts: [], identifier: hit.identifier, reason, status: "unverified" };
}

/** Every distinct id under one bare-`{ id }` relation key across a set of nodes, in first-seen order. Pure. */
function distinctIds({ nodes, key }: { nodes: readonly Record<string, unknown>[]; key: string }): readonly string[] {
  const seen = new Set<string>();
  for (const node of nodes) {
    const id = nestedId({ key, node });
    if (id !== undefined) {
      seen.add(id);
    }
  }
  return [...seen];
}

/** A `{ id, <nameField> }` connection response folded into an id-to-name map. Pure. */
function namesByIdFrom({
  value,
  field,
  nameField,
}: {
  value: unknown;
  field: string;
  nameField: string;
}): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const node of connectionNodes({ field, value })) {
    const id = fieldString({ key: "id", node });
    const name = fieldString({ key: nameField, node });
    if (id !== undefined && name !== undefined) {
      names.set(id, name);
    }
  }
  return names;
}

/**
 * Read every issue citation on the page, one request per distinct team.
 *
 * FETCH only: the nodes come back unshaped, because the names their `state` and `assignee` ids stand for are
 * not known until {@link resolveNames} has seen every node the whole pass read.
 *
 * @param hits the issue citations, in page order
 * @param request the injected GraphQL seam
 * @returns the live nodes, the citations nothing could be asked about, and the request count
 */
async function fetchIssueNodes({
  hits,
  request,
}: {
  hits: readonly LinearQueryHit[];
  request: LinearVerifyRequest;
}): Promise<Result<VerifyLeg, LinearLiveError>> {
  const nodes: Record<string, unknown>[] = [];
  // Named for the LIST rather than for the `unverified` factory above it, which this function also calls
  // through `appendUnverified` — one name for both would shadow the factory inside its own caller.
  const unverifiedHits: LinearVerification[] = [];
  let requests = 0;
  for (const [team, teamHits] of issuesByTeam({ hits })) {
    if (team === UNPARSEABLE_TEAM) {
      appendUnverified({ hits: teamHits, into: unverifiedHits });
      continue;
    }
    const response = await request({
      query: VERIFY_ISSUES_QUERY,
      variables: {
        filter: {
          number: { in: teamHits.map((hit) => parseIssueIdentifier({ identifier: hit.identifier })?.number) },
          team: { key: { eq: team } },
        },
        first: teamHits.length,
        includeArchived: true,
      },
    });
    requests += 1;
    if (response.isErr()) {
      return err(response.error);
    }
    nodes.push(...connectionNodes({ field: "issues", value: response.value }));
  }
  return ok({ nodes, requests, unverified: unverifiedHits });
}

/** Record every citation in a bucket nobody can filter on, so it is reported rather than dropped. Pure. */
function appendUnverified({ hits, into }: { hits: readonly LinearQueryHit[]; into: LinearVerification[] }): void {
  for (const hit of hits) {
    into.push(unverified({ hit, reason: "identifier is not a `TEAM-123` issue key to filter on" }));
  }
}

/**
 * Read every project citation on the page in one request. FETCH only, for {@link fetchIssueNodes}'s reason.
 *
 * @param hits the project citations, in page order
 * @param request the injected GraphQL seam
 * @returns the live nodes and the request count, or the provider failure
 */
async function fetchProjectNodes({
  hits,
  request,
}: {
  hits: readonly LinearQueryHit[];
  request: LinearVerifyRequest;
}): Promise<Result<VerifyLeg, LinearLiveError>> {
  if (hits.length === 0) {
    return ok({ nodes: [], requests: 0, unverified: [] });
  }
  const response = await request({
    query: VERIFY_PROJECTS_QUERY,
    variables: {
      filter: { id: { in: hits.map((hit) => hit.identifier) } },
      first: hits.length,
      includeArchived: true,
    },
  });
  if (response.isErr()) {
    return err(response.error);
  }
  return ok({ nodes: connectionNodes({ field: "projects", value: response.value }), requests: 1, unverified: [] });
}

/**
 * Turn the ids one pass read into the names a citation asserts, in at most three further requests.
 *
 * BOUNDED BY THE SCHEMA, NOT BY THE PAGE: the users and workflow-states lookups are filtered to exactly the
 * distinct ids that appeared, so a page of fifty citations costs the same three requests as a page of two,
 * and a page whose objects have no assignee at all costs none of them. The project-status lookup is the one
 * that cannot be filtered — `ProjectStatusesDocument` declares no `$filter` — but it reads a workspace-level
 * vocabulary of a few rows, once.
 *
 * A lookup that FAILS is not fatal and does not become a drift: an unresolved id yields `undefined`, which
 * {@link compareHitToLive} already reports as `(none)`. Reporting a lookup outage as "every citation lost
 * its assignee" would be the same class of lie this file's header refuses for a transport failure.
 *
 * @param issueNodes every live issue node the pass read
 * @param projectNodes every live project node the pass read
 * @param request the injected GraphQL seam
 * @returns the index, and how many requests building it cost
 */
async function resolveNames({
  issueNodes,
  projectNodes,
  request,
}: {
  issueNodes: readonly Record<string, unknown>[];
  projectNodes: readonly Record<string, unknown>[];
  request: LinearVerifyRequest;
}): Promise<{ names: LinearNameIndex; requests: number }> {
  const userIds = [
    ...new Set([
      ...distinctIds({ key: "assignee", nodes: issueNodes }),
      ...distinctIds({ key: "lead", nodes: projectNodes }),
    ]),
  ];
  const stateIds = distinctIds({ key: "state", nodes: issueNodes });
  const wantStatuses = distinctIds({ key: "status", nodes: projectNodes }).length > 0;
  let requests = 0;
  let users: ReadonlyMap<string, string> = new Map();
  let states: ReadonlyMap<string, string> = new Map();
  let projectStatuses: ReadonlyMap<string, string> = new Map();
  if (userIds.length > 0) {
    const response = await request({
      query: USERS_QUERY,
      variables: { filter: { id: { in: userIds } }, first: userIds.length, includeArchived: true },
    });
    requests += 1;
    users = response.isOk()
      ? namesByIdFrom({ field: "users", nameField: "displayName", value: response.value })
      : users;
  }
  if (stateIds.length > 0) {
    const response = await request({
      query: WORKFLOW_STATES_QUERY,
      variables: { filter: { id: { in: stateIds } }, first: stateIds.length, includeArchived: true },
    });
    requests += 1;
    states = response.isOk()
      ? namesByIdFrom({ field: "workflowStates", nameField: "name", value: response.value })
      : states;
  }
  if (wantStatuses) {
    const response = await request({ query: PROJECT_STATUSES_QUERY, variables: { first: PROJECT_STATUS_PAGE } });
    requests += 1;
    projectStatuses = response.isOk()
      ? namesByIdFrom({ field: "projectStatuses", nameField: "name", value: response.value })
      : projectStatuses;
  }
  return { names: { projectStatuses, states, users }, requests };
}

/**
 * How many project statuses to read in the one lookup that cannot be filtered.
 *
 * A workspace-level vocabulary: this one has far fewer, and Linear's own page ceiling is 250. Count yours
 * with `slopweaver atlas linear read --id type:ProjectStatus --json`.
 */
const PROJECT_STATUS_PAGE = 250;

/**
 * Verify one page of local hits against the live provider.
 *
 * @param hits the page of citations to check — never the whole match set
 * @param request the injected GraphQL seam
 * @param nowIso the clock stamping when the verification ran
 * @returns one verdict per citation, or the first provider failure (a failure to REACH Linear is not a
 *   drift, and reporting it as one would turn an outage into "every citation is gone")
 */
export async function verifyLinearHits({
  hits,
  request,
  nowIso,
}: {
  hits: readonly LinearQueryHit[];
  request: LinearVerifyRequest;
  nowIso: () => string;
}): Promise<Result<LinearVerifyDocument, LinearLiveError>> {
  const issueHits = hits.filter((hit) => hit.kind === "issue");
  const projectHits = hits.filter((hit) => hit.kind === "project");
  const issues = await fetchIssueNodes({ hits: issueHits, request });
  if (issues.isErr()) {
    return err(issues.error);
  }
  const projects = await fetchProjectNodes({ hits: projectHits, request });
  if (projects.isErr()) {
    return err(projects.error);
  }
  // One resolution pass over BOTH legs, so an assignee who also leads a cited project is looked up once.
  const resolved =
    issues.value.nodes.length + projects.value.nodes.length === 0
      ? { names: NO_NAMES, requests: 0 }
      : await resolveNames({ issueNodes: issues.value.nodes, projectNodes: projects.value.nodes, request });
  const issueFactsByIdentifier = factsByIdentifier({
    names: resolved.names,
    nodes: issues.value.nodes,
    shape: issueFacts,
  });
  const projectFactsByIdentifier = factsByIdentifier({
    names: resolved.names,
    nodes: projects.value.nodes,
    shape: projectFacts,
  });
  const checked = issueHits
    .filter((hit) => parseIssueIdentifier({ identifier: hit.identifier }) !== undefined)
    .map((hit) => compareHitToLive({ facts: issueFactsByIdentifier.get(hit.identifier), hit }));
  return ok({
    requests: issues.value.requests + projects.value.requests + resolved.requests,
    verifiedAtIso: nowIso(),
    verifications: [
      ...checked,
      ...issues.value.unverified,
      ...projectHits.map((hit) => compareHitToLive({ facts: projectFactsByIdentifier.get(hit.identifier), hit })),
    ],
  });
}
