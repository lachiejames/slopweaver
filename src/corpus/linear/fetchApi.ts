/**
 * The PRODUCER side of the Linear seam: {@link makeLinearApi} builds a {@link LinearApi} over an injected
 * {@link LinearRequest} transport, deciding which query to send, how to page it, and how to shape the raw
 * GraphQL response. Everything here is pure query/shape logic — no retry, no rate limiting, no client
 * construction, all of which live in {@link ./transport}. The exhaustive-paging CONSUMER side that calls the
 * seam this module builds lives in {@link ./fetchCollect}, {@link ./fetchLanes} and {@link ./fetchMembers}.
 */
import { appendAll } from "../../lib/arrays.js";
import { isRecord } from "../../lib/parsers.js";
import type { HistoryEventRow } from "../history/types.js";
import type { LinearApi, LinearEntityLane } from "./apiTypes.js";
import { documentsLane } from "./fetchDocuments.js";
import { initiativesLane } from "./fetchInitiatives.js";
import {
  childrenFor,
  commentsFor,
  issueActivityFor,
  projectConnectionsFor,
  projectUpdatesFor,
  relationsFor,
} from "./fetchJoins.js";
import { clampPageSize, hydrateStatus, idsOf, issueNodeId, joinedNested, joinedRows, rootPage } from "./fetchPages.js";
import type { LinearIssueItem, LinearProjectItem } from "./items.js";
import { hydrateNode, type LinearRefSpec, refsForIds } from "./names.js";
import { pageQueryVariables, projectPageQueryVariables } from "./pageVariables.js";
import { parseLinearIssueNode } from "./parse.js";
import { str } from "./parseFields.js";
import { parseProject } from "./parseProject.js";
import {
  CUSTOM_VIEWS_QUERY,
  CUSTOM_VIEWS_REFS,
  CUSTOMER_NEEDS_QUERY,
  CUSTOMER_NEEDS_REFS,
  ENTITY_PAGE_SIZE,
  EXTERNAL_USERS_QUERY,
  EXTERNAL_USERS_REFS,
  INITIATIVE_UPDATES_QUERY,
  INITIATIVE_UPDATES_REFS,
  ISSUE_LABELS_QUERY,
  ISSUE_LABELS_REFS,
  ISSUES_PAGE_SIZE,
  ISSUES_QUERY,
  ISSUES_REFS,
  PROJECT_MILESTONES_QUERY,
  PROJECT_MILESTONES_REFS,
  PROJECTS_PAGE_SIZE,
  PROJECTS_QUERY,
  PROJECTS_REFS,
  TEMPLATES_QUERY,
  TEMPLATES_REFS,
  USERS_PAGE_SIZE,
  USERS_QUERY,
} from "./queries.js";
import { fillReferences } from "./referenceFill.js";
import { type LinearReferences, NO_REFERENCES } from "./references.js";
import type { LinearRequest } from "./transport.js";

/**
 * Shape one raw `issues` GraphQL response into its RAW nodes + the page's next cursor. Pure.
 *
 * Deliberately stops at the raw nodes rather than parsing them: each node's nested connections may need
 * follow-up requests before it can be projected, and that is transport work. Splitting here keeps the whole
 * projection pure and separately testable.
 *
 * @param data the raw GraphQL `data`
 * @returns the raw issue nodes + next cursor
 */
export function shapeIssuesPage({ data }: { data: unknown }): { nodes: readonly unknown[]; nextCursor?: string } {
  return rootPage({ data, key: "issues" });
}

/**
 * Shape one raw `projects` GraphQL response into its RAW nodes + the next cursor. Pure.
 *
 * @param data one raw GraphQL `data` payload
 * @returns the nodes UNSHAPED, plus `nextCursor` only when another page exists — projection is deferred so
 *   the caller can first page each project's nested connections to exhaustion
 */
export function shapeProjectsPage({ data }: { data: unknown }): { nodes: readonly unknown[]; nextCursor?: string } {
  return rootPage({ data, key: "projects" });
}

/**
 * The issues lane: `IssuesDocument` for the page, then four joins that carry what its nested connections did.
 *
 * The loop is over raw nodes rather than parsed items because the parse needs the COMPLETED connections — the
 * old code parsed first and then patched comments back in, which is exactly why comments were the only
 * connection anyone ever paged.
 *
 * `relations` and `inverseRelations` cost NO request here at all: the reference pass walked the root
 * `issueRelations` connection once for the whole workspace and indexed it from both ends. Their endpoint
 * issues arrive as bare ids, so the identifier a citation reads is filled per page rather than per relation.
 */
function issuesLane({ call, references }: { call: LinearRequest; references: LinearReferences }): LinearApi["issues"] {
  return async ({ since, cursor, pageSize }) => {
    const data = await call({
      query: ISSUES_QUERY,
      variables: {
        ...pageQueryVariables({
          cursor,
          pageSize: clampPageSize({ laneMax: ISSUES_PAGE_SIZE, requested: pageSize }),
          since,
        }),
        includeArchived: true,
        orderBy: "updatedAt",
      },
    });
    const shaped = shapeIssuesPage({ data });
    const warnings: string[] = [];
    const ids = idsOf({ nodes: shaped.nodes });
    await fillReferences({ nodes: shaped.nodes, references, request: call, spec: ISSUES_REFS, warnings });
    const comments = await commentsFor({ call, ids, references, warnings });
    const children = await childrenFor({ call, ids });
    const activity = await issueActivityFor({ call, ids, warnings });
    const relations = await relationsFor({ call, ids, references, warnings });
    const issues: LinearIssueItem[] = [];
    const historyRows: HistoryEventRow[] = [];
    for (const node of shaped.nodes) {
      const id = issueNodeId({ node });
      if (id === undefined) {
        continue;
      }
      const parsed = parseLinearIssueNode({
        nested: {
          ...joinedNested({ byId: activity, id }),
          children: joinedRows({ byId: children, id }),
          comments: joinedRows({ byId: comments, id }),
          inverseRelations: joinedRows({ byId: relations.inverse, id }),
          labels: refsForIds({
            ids: isRecord(node) ? node["labelIds"] : undefined,
            index: references.index,
            kind: "issueLabel",
          }),
          relations: joinedRows({ byId: relations.forward, id }),
        },
        node: hydrateNode({ index: references.index, node, spec: ISSUES_REFS }),
      });
      if (parsed === undefined) {
        continue;
      }
      issues.push(parsed.item);
      appendAll({ from: parsed.historyRows, into: historyRows });
    }
    return {
      historyRows,
      issues,
      ...(shaped.nextCursor !== undefined ? { nextCursor: shaped.nextCursor } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  };
}

/**
 * The projects lane: the SDK's document, plus TWO joins that cost one request each per page.
 *
 * What used to be one inline query with five nested connections and a per-project follow-up is now the
 * generated `ProjectsDocument` plus the companion document for the three connections it cannot express, plus
 * the root `projectUpdates` walk. `labels` and `initiatives` cost no request at all: the fragment carries
 * `labelIds`, and the initiative edges were walked once by the reference pass.
 */
function projectsLane({
  call,
  references,
}: {
  call: LinearRequest;
  references: LinearReferences;
}): LinearApi["projects"] {
  return async ({ since, cursor, pageSize }) => {
    const data = await call({
      query: PROJECTS_QUERY,
      variables: projectPageQueryVariables({
        cursor,
        pageSize: clampPageSize({ laneMax: PROJECTS_PAGE_SIZE, requested: pageSize }),
        since,
      }),
    });
    const shaped = shapeProjectsPage({ data });
    const warnings: string[] = [];
    const ids = idsOf({ nodes: shaped.nodes });
    await fillReferences({ nodes: shaped.nodes, references, request: call, spec: PROJECTS_REFS, warnings });
    const companion = await projectConnectionsFor({ call, ids, warnings });
    const updates = await projectUpdatesFor({ call, ids, references });
    const projects: LinearProjectItem[] = [];
    for (const node of shaped.nodes) {
      const id = isRecord(node) ? str({ value: node["id"] }) : undefined;
      if (id === undefined) {
        continue;
      }
      const project = parseProject({
        nested: {
          ...joinedNested({ byId: companion, id }),
          initiatives: joinedRows({ byId: references.projectInitiatives, id }),
          labels: refsForIds({
            ids: isRecord(node) ? node["labelIds"] : undefined,
            index: references.index,
            kind: "projectLabel",
          }),
        },
        node: hydrateStatus({ index: references.index, node, spec: PROJECTS_REFS }),
        updates: joinedRows({ byId: updates, id }),
      });
      if (project !== undefined) {
        projects.push(project);
      }
    }
    return {
      projects,
      ...(shaped.nextCursor !== undefined ? { nextCursor: shaped.nextCursor } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  };
}

/**
 * The users lane: one page of the SDK's `User` fragment, with each user's TEAMS joined back on.
 *
 * `@linear/sdk`'s `User` fragment carries no connections, so the `teams` connection this lane used to select
 * inline — and then page per user when it overflowed — is gone from the document entirely. It is rebuilt
 * from the root `teamMemberships` walk the reference pass already made, which is strictly better than what
 * it replaced: there is no inline page to overflow, so the per-user follow-up request and the silent
 * truncation it existed to prevent are both gone.
 *
 * The team list is written BACK onto the node under `teams`, rather than handed alongside it, so
 * `parseLinearUserNode` stays a pure function of one node and needs no knowledge of any of this. A member's
 * team list is how the resolver places them in the org, so losing the tail of it would be a silent identity
 * defect rather than a cosmetic one.
 */
function usersLane({ call, references }: { call: LinearRequest; references: LinearReferences }): LinearApi["users"] {
  return async ({ cursor, pageSize }) => {
    const data = await call({
      query: USERS_QUERY,
      variables: {
        first: clampPageSize({ laneMax: USERS_PAGE_SIZE, requested: pageSize }),
        includeArchived: true,
        includeDisabled: true,
        ...(cursor !== undefined ? { after: cursor } : {}),
      },
    });
    const page = rootPage({ data, key: "users" });
    return {
      nodes: page.nodes.map((node) => withJoinedTeams({ node, references })),
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
    };
  };
}

/** One user node with the teams the root membership walk joined to it, in the shape the parser reads. Pure. */
function withJoinedTeams({ node, references }: { node: unknown; references: LinearReferences }): unknown {
  if (!isRecord(node)) {
    return node;
  }
  const id = str({ value: node["id"] });
  const teams = id === undefined ? undefined : references.userTeams.get(id);
  return teams === undefined ? node : { ...node, teams: { nodes: teams } };
}

/**
 * A cursor-only paged lane returning the connection's RAW nodes under `key`, with its references resolved.
 *
 * "Raw" still means raw, and the hydration does not change that: it puts the fields the reference index
 * already holds back onto the node under the key the reference arrived under, so what a projector reads — and
 * what lands in bronze as `raw` — is the same shape the hand-written document used to return. See
 * `./names.ts` for why that is done here rather than by threading an index through every projector.
 */
function nodeLane({
  call,
  query,
  key,
  refs,
  references,
  defaultPageSize = ENTITY_PAGE_SIZE,
}: {
  call: LinearRequest;
  query: string;
  key: string;
  refs: LinearRefSpec;
  references: LinearReferences;
  defaultPageSize?: number;
}): LinearEntityLane {
  return async ({ cursor, pageSize }) => {
    const data = await call({
      query,
      variables: {
        first: clampPageSize({ laneMax: defaultPageSize, requested: pageSize }),
        includeArchived: true,
        ...(cursor !== undefined ? { after: cursor } : {}),
      },
    });
    const page = rootPage({ data, key });
    // Fill before hydrating: the reference pass walks every lane whose size is bounded by the workspace
    // vocabulary, and this is what covers the one that is not — an ISSUE, of which there are tens of thousands. It
    // costs ONE filtered request per kind per page of misses, and nothing at all once the cache is warm.
    const warnings: string[] = [];
    await fillReferences({ nodes: page.nodes, references, request: call, spec: refs, warnings });
    return {
      nodes: page.nodes.map((node) => hydrateNode({ index: references.index, node, spec: refs })),
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  };
}

/**
 * Build the Linear seam over an injected request — a pure query/shape adapter, no transport of its own.
 *
 * It used to build a `LinearClient` and a `RateScheduler` here, and because `makeLinearApi` is called from two
 * places in one `refresh` process (activity ingest and member hydration) that meant two of each, pacing
 * independently against one shared per-user quota. The transport is now {@link ./transport}'s single shared
 * one; this function only knows which query to send and how to shape the answer.
 *
 * @param request the shared Linear transport's request
 * @param references the crawl's reference index, from `./references.ts`; omit for a caller that wants the
 *   provider's own shapes unresolved, which is what every seam test does
 * @returns the Linear seam
 */
export function makeLinearApi({
  request,
  references = NO_REFERENCES,
}: {
  request: LinearRequest;
  references?: LinearReferences;
}): LinearApi {
  const call = request;
  return {
    customerNeeds: nodeLane({
      call,
      key: "customerNeeds",
      query: CUSTOMER_NEEDS_QUERY,
      references,
      refs: CUSTOMER_NEEDS_REFS,
    }),
    customViews: nodeLane({ call, key: "customViews", query: CUSTOM_VIEWS_QUERY, references, refs: CUSTOM_VIEWS_REFS }),
    documents: documentsLane({ call, references }),
    externalUsers: nodeLane({
      call,
      key: "externalUsers",
      query: EXTERNAL_USERS_QUERY,
      references,
      refs: EXTERNAL_USERS_REFS,
    }),
    initiatives: initiativesLane({ call, references }),
    initiativeUpdates: nodeLane({
      call,
      key: "initiativeUpdates",
      query: INITIATIVE_UPDATES_QUERY,
      references,
      refs: INITIATIVE_UPDATES_REFS,
    }),
    issueLabels: nodeLane({ call, key: "issueLabels", query: ISSUE_LABELS_QUERY, references, refs: ISSUE_LABELS_REFS }),
    issues: issuesLane({ call, references }),
    projectMilestones: nodeLane({
      call,
      key: "projectMilestones",
      query: PROJECT_MILESTONES_QUERY,
      references,
      refs: PROJECT_MILESTONES_REFS,
    }),
    projects: projectsLane({ call, references }),
    templates: async () => {
      const data = await call({ query: TEMPLATES_QUERY, variables: {} });
      const nodes = isRecord(data) && Array.isArray(data["templates"]) ? data["templates"] : [];
      return { nodes: nodes.map((node) => hydrateNode({ index: references.index, node, spec: TEMPLATES_REFS })) };
    },
    users: usersLane({ call, references }),
  };
}
