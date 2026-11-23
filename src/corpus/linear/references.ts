/**
 * The REFERENCE pass: walk the workspace vocabulary once, so every lane after it can resolve the bare
 * `{ id }` references `@linear/sdk`'s fragments carry without asking the provider a second time.
 *
 * ## Why these lanes, and why they are walked WHOLE
 *
 * Each one is a slowly-changing set the whole workspace shares — its people, its teams, its labels, its
 * cycles, its workflow states, its project statuses, its milestones, its customers, its initiatives and its
 * projects. They are NOT windowed by the refresh's `since`: a comment written yesterday can be authored by
 * someone who joined three years ago, and an index that only held this window's people would resolve that
 * author to nothing. Walking them whole is what makes the join total rather than best-effort.
 *
 * Every one is also a lane whose own cost is bounded by the vocabulary rather than by activity, which is why
 * the pass is affordable at all — see the measurement on {@link fetchLinearReferences}.
 *
 * ## What is deliberately NOT here
 *
 * `issues`. A working workspace holds tens of thousands of them, and walking them for an index would be
 * hundreds of requests against a 2,500/hour budget to learn that many strings of the form `TEAM-123`. So an
 * ISSUE reference is resolved from the crawl's own issue nodes instead — see `./names.ts`'s
 * {@link ../linear/names.issueRefsFrom}, which DERIVES an identifier from the `team { id }` and `number` the
 * SDK's own fragment carries — and an issue neither the crawl nor a reference lane has seen keeps its bare
 * id. That residue is stated in `./names.ts` rather than hidden.
 */
import { LinearDocument } from "@linear/sdk";

import { appendUnder } from "../../lib/arrays.js";
import { collectCursorPages, pushCursorWarning } from "../../lib/paging.js";
import { isRecord } from "../../lib/parsers.js";
import {
  type LinearNameCache,
  type LinearNameIndex,
  type LinearRef,
  type LinearRefKind,
  linearNameIndexFrom,
} from "./names.js";
import type { LinearRequest } from "./transport.js";

/**
 * One reference lane: which kind it fills, which root field it reads, and the document that reads it.
 *
 * @internal — the shape of `REFERENCE_LANES` in this file; no caller builds a lane of its own.
 */
export interface LinearReferenceLane {
  readonly kind: LinearRefKind;
  /** The root connection field on the response. */
  readonly field: string;
  /** The SDK document. */
  readonly query: string;
  /** The page size. Each of these lanes is cheap per node, so each takes the largest page Linear allows. */
  readonly pageSize: number;
  /**
   * Whether the document declares `$includeArchived`.
   *
   * TRUE almost everywhere and stated per lane rather than assumed, because sending a variable an operation
   * never declared is not a shape worth relying on a server to forgive — the same care `./structures.ts`
   * takes for the two hand-written vocabulary documents it still calls.
   */
  readonly includeArchived: boolean;
}

/**
 * The largest page Linear allows. Every lane here takes it: each is cheap per node and the request budget is
 * the one a crawl has to spend carefully, so a lane of several hundred cycles is a handful of requests rather than a dozen or more.
 */
const REFERENCE_PAGE_SIZE = 250;

/**
 * Every reference lane, in the order the pass walks them.
 *
 * `team` is FIRST and that is load-bearing rather than alphabetical: `./names.ts` derives an issue's
 * identifier from its `team { id }` and `number`, so the team map has to exist before any issue reference is
 * folded. The index builder enforces the same thing independently, which is belt and braces on purpose.
 *
 * @internal — walked by `fetchLinearReferences` in this file; the pass is what callers reach for.
 */
export const REFERENCE_LANES: readonly LinearReferenceLane[] = [
  {
    field: "teams",
    includeArchived: true,
    kind: "team",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.TeamsDocument),
  },
  {
    field: "users",
    includeArchived: true,
    kind: "user",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.UsersDocument),
  },
  {
    field: "externalUsers",
    includeArchived: true,
    kind: "externalUser",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.ExternalUsersDocument),
  },
  {
    field: "workflowStates",
    includeArchived: true,
    kind: "workflowState",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.WorkflowStatesDocument),
  },
  {
    field: "projectStatuses",
    includeArchived: true,
    kind: "projectStatus",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.ProjectStatusesDocument),
  },
  {
    field: "cycles",
    includeArchived: true,
    kind: "cycle",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.CyclesDocument),
  },
  {
    field: "issueLabels",
    includeArchived: true,
    kind: "issueLabel",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.IssueLabelsDocument),
  },
  {
    field: "projectLabels",
    includeArchived: true,
    kind: "projectLabel",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.ProjectLabelsDocument),
  },
  {
    field: "projectMilestones",
    includeArchived: true,
    kind: "milestone",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.ProjectMilestonesDocument),
  },
  {
    field: "customers",
    includeArchived: true,
    kind: "customer",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.CustomersDocument),
  },
  {
    field: "initiatives",
    includeArchived: true,
    kind: "initiative",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.InitiativesDocument),
  },
  {
    field: "projects",
    includeArchived: true,
    kind: "project",
    pageSize: REFERENCE_PAGE_SIZE,
    query: String(LinearDocument.ProjectsDocument),
  },
];

/**
 * The whole reference pass's output: the id-to-name index, plus the ONE connection this pass rebuilds.
 *
 * A user's `teams` is not on the SDK's `User` fragment and it is not optional data — a member's team list is
 * how the resolver places them in the org, so losing it is a silent identity defect rather than a cosmetic
 * one. It comes from the root `teamMemberships` connection, whose every node carries `team { id }` and
 * `user { id }`, which is the same join `./structures.ts` uses to build a team's roster from the other side.
 */
export interface LinearReferences {
  /** The index every reader uses. */
  readonly index: LinearNameIndex;
  /** The SAME maps, typed for the one writer — {@link ./referenceFill.fillReferences}, and nothing else. */
  readonly cache: LinearNameCache;
  /** Team references per USER id, in the order the membership walk saw them. */
  readonly userTeams: ReadonlyMap<string, readonly LinearRef[]>;
  /** Initiative references per PROJECT id, off the root `initiativeToProjects` edges. */
  readonly projectInitiatives: ReadonlyMap<string, readonly LinearRef[]>;
  /** Project references per INITIATIVE id — the same edges, read from the other end. */
  readonly initiativeProjects: ReadonlyMap<string, readonly LinearRef[]>;
  /**
   * Every typed issue relation, indexed by BOTH of its endpoint issue ids.
   *
   * One walk of the root `issueRelations` connection for the whole workspace — MEASURED live at
   * over ten thousand relations in dozens of pages and tens of thousands of complexity points. It has no filter at all, so there is no
   * windowed version of it; walking it once per crawl is the only shape available, and it replaces what the
   * issue query used to get inline for two connections at once.
   */
  readonly issueRelations: ReadonlyMap<string, readonly unknown[]>;
  /**
   * Whether a reference pass actually ran.
   *
   * False on {@link NO_REFERENCES}, and that is what stops a caller who wanted the provider's own shapes from
   * being handed a crawl's worth of fill requests instead: with an empty cache EVERY reference is a miss, so
   * without this flag "resolve nothing" and "resolve everything from scratch" are the same call.
   */
  readonly resolves: boolean;
}

/*
 * The mutable half of the same thing: the index is a CACHE, and `fillReferences` fills a miss.
 *
 * Not an afterthought — it is what makes the ISSUE reference resolvable at all. A working workspace holds
 * tens of thousands of issues, so no reference lane walks them (see this module's header), and yet
 * `CustomerNeed.issue`, `Document.issue` and an issue's own `parent` all arrive as bare ids that a reader
 * expects to see as `ENG-42`. MEASURED live with the pass built and no fill: a customer need's
 * `issue` resolved to nothing while its `customer` and `project` resolved correctly, which is exactly the
 * hole this closes.
 *
 * A fill is BOUNDED BY THE SCHEMA rather than by the page, the same shape `src/live/linear/verify.ts` uses:
 * the distinct ids a page carried that the cache does not know are fetched in ONE filtered request per kind
 * per batch of 250, and cached — so a second page referencing the same issue costs nothing, and a lane whose
 * references are all already known costs no request at all.
 */

/** What a caller with no reference pass gets: every hydration a no-op, every node exactly as Linear sent it. */
const NO_CACHE: LinearNameCache = new Map();
export const NO_REFERENCES: LinearReferences = {
  cache: NO_CACHE,
  index: NO_CACHE,
  initiativeProjects: new Map(),
  issueRelations: new Map(),
  projectInitiatives: new Map(),
  resolves: false,
  userTeams: new Map(),
};

/** The membership edges, as their own lane — they fill {@link LinearReferences.userTeams}, not the index. */
const TEAM_MEMBERSHIPS_QUERY = String(LinearDocument.TeamMembershipsDocument);

/** The initiative↔project edges, likewise: they fill two maps rather than a kind. */
const INITIATIVE_TO_PROJECTS_QUERY = String(LinearDocument.InitiativeToProjectsDocument);

/** The typed issue relations, walked whole because `issueRelations` declares no filter of any kind. */
const ISSUE_RELATIONS_QUERY = String(LinearDocument.IssueRelationsDocument);

/**
 * The `{ nodes, pageInfo }` under one root connection field, defensively narrowed. Pure.
 *
 * @returns the connection's nodes, whether another page follows, and the cursor that reaches it
 */
export function connectionOf({ data, field }: { data: unknown; field: string }): {
  nodes: readonly unknown[];
  hasNext: boolean;
  endCursor: string | undefined;
} {
  const connection = isRecord(data) ? data[field] : undefined;
  const nodes = isRecord(connection) && Array.isArray(connection["nodes"]) ? connection["nodes"] : [];
  const info = isRecord(connection) ? connection["pageInfo"] : undefined;
  const endCursor = isRecord(info) && typeof info["endCursor"] === "string" ? info["endCursor"] : undefined;
  return { endCursor, hasNext: isRecord(info) && info["hasNextPage"] === true, nodes };
}

/**
 * Page ONE reference lane to exhaustion. A failure warns and yields nothing, never fails the refresh.
 *
 * Best-effort for the reason `./entities.ts` records for its own lanes: a workspace or plan may not expose an
 * entity, and `auditEntries` is the proof of that shape — present in the schema, HTTP 403 for this token. A
 * lane that does not answer leaves its references unresolved, which `./names.ts` already treats as "absent",
 * so degrading is strictly better than refusing to refresh at all.
 */
async function collectLane({
  lane,
  request,
  warnings,
}: {
  lane: LinearReferenceLane;
  request: LinearRequest;
  warnings: string[];
}): Promise<readonly unknown[]> {
  try {
    const walked = await collectCursorPages<unknown>({
      fetchPage: async ({ cursor }) => {
        const data = await request({
          query: lane.query,
          variables: {
            first: lane.pageSize,
            ...(lane.includeArchived ? { includeArchived: true } : {}),
            ...(cursor !== undefined ? { after: cursor } : {}),
          },
        });
        const page = connectionOf({ data, field: lane.field });
        return { hasMore: page.hasNext, items: page.nodes, nextCursor: page.hasNext ? page.endCursor : undefined };
      },
    });
    pushCursorWarning({ end: walked.end, lane: `linear ${lane.field} reference`, warnings });
    return walked.items;
  } catch (error: unknown) {
    warnings.push(
      `linear ${lane.field} reference lane unavailable, so its names will not resolve: ` +
        `${error instanceof Error ? error.message : "unknown"}`,
    );
    return [];
  }
}

/**
 * Walk every reference lane and build the crawl's id-to-name index.
 *
 * MEASURED live through this repo's gated transport, walking every lane below to exhaustion
 * against a workspace of dozens of teams, over a hundred users, hundreds of external users, cycles and
 * workflow states, over a thousand issue labels, milestones and projects, and a handful of customers: **a few
 * dozen requests and under a hundred thousand complexity points**, the whole pass. That is a few percent of
 * the 2,500 requests and the 3,000,000 complexity points Linear allows in an hour, and it buys every name in the
 * workspace for every lane that follows. Reproduce with the probe in
 * `~/.slopweaver/probes/linear-sdk-<date>/`.
 *
 * The two lanes worth knowing the shape of: `projects` is about half the requests because its page size is
 * capped by its own fragment's width, and `projectMilestones` is about a fifth of the points. Neither is close to
 * mattering, and both are here rather than derived because a milestone name and a project name are what a
 * reader of a record actually sees.
 *
 * @param request the shared Linear transport
 * @returns the index, and any lane that could not be walked
 */
export async function fetchLinearReferences({ request }: { request: LinearRequest }): Promise<{
  references: LinearReferences;
  warnings: readonly string[];
}> {
  const warnings: string[] = [];
  const lanes: Partial<Record<LinearRefKind, readonly unknown[]>> = {};
  for (const lane of REFERENCE_LANES) {
    lanes[lane.kind] = await collectLane({ lane, request, warnings });
  }
  const index = linearNameIndexFrom({ lanes });
  const memberships = await collectLane({
    lane: {
      field: "teamMemberships",
      includeArchived: true,
      kind: "team",
      pageSize: REFERENCE_PAGE_SIZE,
      query: TEAM_MEMBERSHIPS_QUERY,
    },
    request,
    warnings,
  });
  const links = await collectLane({
    lane: {
      field: "initiativeToProjects",
      includeArchived: true,
      kind: "initiative",
      pageSize: REFERENCE_PAGE_SIZE,
      query: INITIATIVE_TO_PROJECTS_QUERY,
    },
    request,
    warnings,
  });
  const relations = await collectLane({
    lane: {
      field: "issueRelations",
      includeArchived: true,
      kind: "issue",
      pageSize: REFERENCE_PAGE_SIZE,
      query: ISSUE_RELATIONS_QUERY,
    },
    request,
    warnings,
  });
  return {
    references: {
      cache: index,
      index,
      initiativeProjects: edgesBy({ from: "initiative", index, nodes: links, to: "project" }),
      issueRelations: relationsByEndpoint({ nodes: relations }),
      resolves: true,
      projectInitiatives: edgesBy({ from: "project", index, nodes: links, to: "initiative" }),
      userTeams: userTeamsFrom({ index, nodes: memberships }),
    },
    warnings,
  };
}

/**
 * Index every relation row by BOTH of the issue ids it names. Pure.
 *
 * A row appears under two keys on purpose: the issues lane reads it as a FORWARD relation from one end and
 * as an INVERSE one from the other, and the direction is not cosmetic — a relation reached from the inverse
 * side has its direction reversed (see `./curated.ts`).
 *
 * @param nodes the raw `issueRelations` nodes
 * @returns issue id to every relation row naming it at either end
 * @internal — exported for this module's own unit tests; the pass is what a caller reaches for.
 */
export function relationsByEndpoint({ nodes }: { nodes: readonly unknown[] }): ReadonlyMap<string, readonly unknown[]> {
  const byIssue = new Map<string, unknown[]>();
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    for (const end of ["issue", "relatedIssue"]) {
      const id = isRecord(node[end]) ? node[end]["id"] : undefined;
      if (typeof id !== "string") {
        continue;
      }
      appendUnder({ into: byIssue, key: id, value: node });
    }
  }
  return byIssue;
}

/**
 * Index a two-ended join table by one end, resolving the OTHER end to a reference. Pure.
 *
 * One function for both directions of the `initiativeToProjects` edges, because a project's initiatives and
 * an initiative's projects are the same 899 rows read from opposite ends — and reading them twice would be
 * two walks of the provider for one fact.
 *
 * @param nodes the raw join rows
 * @param from the end to key BY
 * @param to the end to resolve into a reference
 * @param index the reference index
 * @returns the `from` id to the `to` references, in the order the walk saw them
 * @internal — exported for this module's own unit tests; the pass is what a caller reaches for.
 */
export function edgesBy({
  nodes,
  from,
  to,
  index,
}: {
  nodes: readonly unknown[];
  from: LinearRefKind;
  to: LinearRefKind;
  index: LinearNameIndex;
}): ReadonlyMap<string, readonly LinearRef[]> {
  const targets = index.get(to);
  const byKey = new Map<string, LinearRef[]>();
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const key = isRecord(node[from]) ? node[from]["id"] : undefined;
    const targetId = isRecord(node[to]) ? node[to]["id"] : undefined;
    const target = typeof targetId === "string" ? targets?.get(targetId) : undefined;
    if (typeof key !== "string" || target === undefined) {
      continue;
    }
    appendUnder({ into: byKey, key, value: target });
  }
  return byKey;
}

/**
 * Index the root membership edges by USER, resolving each team id to the team reference. Pure.
 *
 * The mirror of `./structureRows.ts`'s `teamMembersFromMemberships`, which indexes the same edges by TEAM. Both
 * directions are wanted and neither is derivable from the other without a second walk of the map.
 *
 * @param nodes the raw `teamMemberships` nodes
 * @param index the reference index, for the team each edge points at
 * @returns user id to the team references that user belongs to
 * @internal — exported for this module's own unit tests; the pass is what a caller reaches for.
 */
export function userTeamsFrom({
  nodes,
  index,
}: {
  nodes: readonly unknown[];
  index: LinearNameIndex;
}): ReadonlyMap<string, readonly LinearRef[]> {
  const teams = index.get("team");
  const byUser = new Map<string, LinearRef[]>();
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const userId = isRecord(node["user"]) ? node["user"]["id"] : undefined;
    const teamId = isRecord(node["team"]) ? node["team"]["id"] : undefined;
    const team = typeof teamId === "string" ? teams?.get(teamId) : undefined;
    if (typeof userId !== "string" || team === undefined) {
      continue;
    }
    appendUnder({ into: byUser, key: userId, value: team });
  }
  return byUser;
}
