/**
 * The JOINS that carry what `@linear/sdk`'s fragments no longer do.
 *
 * Split out of `./fetchApi.ts` (file-size ratchet) along the seam the migration itself created. A generated
 * fragment carries no nested connections, so every connection the hand-written documents used to select
 * inline is now a SEPARATE request for a whole page of holders — the root `comments` walk filtered to the
 * page's issues, the same issues document again filtered by `parent.id.in`, the activity companion, the
 * project and initiative connection companions, and the root `projectUpdates` walk.
 *
 * Each function here takes one page's ids and answers one map keyed by holder id. What a LANE then does with
 * that map — which parser it runs, what it hydrates — stays in `fetchApi.ts`, `fetchDocuments.ts` and
 * `fetchInitiatives.ts`, so this file holds request shapes and nothing about record shapes.
 */
import { collectCursorPages, pushCursorWarning } from "../../lib/paging.js";
import { isRecord } from "../../lib/parsers.js";
import { appendTo, companionConnections, idsOf, rootPage, touches } from "./fetchPages.js";
import type { LinearUpdateItem } from "./items.js";
import { hydrateNode, type LinearRefSpec } from "./names.js";
import { completeNestedConnections, connectionPage, type NestedNodes } from "./nested.js";
import { parseProjectUpdates } from "./parse.js";
import { str } from "./parseFields.js";
import {
  COMMENTS_PAGE_SIZE,
  COMMENTS_QUERY,
  COMMENTS_REFS,
  DOCUMENTS_PAGE_SIZE,
  DOCUMENTS_QUERY,
  INITIATIVE_CONNECTIONS_QUERY,
  ISSUE_ACTIVITY_QUERY,
  ISSUES_PAGE_SIZE,
  ISSUES_QUERY,
  PROJECT_CONNECTIONS_QUERY,
  PROJECT_UPDATES_PAGE_SIZE,
  PROJECT_UPDATES_QUERY,
  PROJECT_UPDATES_REFS,
} from "./queries.js";
import { fillReferences } from "./referenceFill.js";
import type { LinearReferences } from "./references.js";
import type { LinearRequest } from "./transport.js";

/**
 * Every comment on one page of issues, at the ROOT, filtered to exactly those issues.
 *
 * The `Comment` fragment carries `issueId` as a scalar, so the join back onto its issue needs no lookup at
 * all — which is the property that makes this connection reachable from the root in the first place.
 *
 * @returns each issue id to its comments, hydrated; an issue nobody commented on is simply absent
 */
export async function commentsFor({
  call,
  ids,
  references,
  warnings,
}: {
  call: LinearRequest;
  ids: readonly string[];
  references: LinearReferences;
  warnings: string[];
}): Promise<ReadonlyMap<string, readonly unknown[]>> {
  const byIssue = new Map<string, unknown[]>();
  if (ids.length === 0) {
    return byIssue;
  }
  const walked = await collectCursorPages<unknown>({
    fetchPage: async ({ cursor }) => {
      const data = await call({
        query: COMMENTS_QUERY,
        variables: {
          filter: { issue: { id: { in: ids } } },
          first: COMMENTS_PAGE_SIZE,
          includeArchived: true,
          ...(cursor !== undefined ? { after: cursor } : {}),
        },
      });
      const page = connectionPage({ holder: data, key: "comments" });
      return { hasMore: page.hasNext, items: page.nodes, nextCursor: page.hasNext ? page.endCursor : undefined };
    },
  });
  pushCursorWarning({ end: walked.end, lane: "linear comments", warnings });
  await fillReferences({ nodes: walked.items, references, request: call, spec: COMMENTS_REFS, warnings });
  for (const node of walked.items) {
    const issueId = isRecord(node) ? str({ value: node["issueId"] }) : undefined;
    if (issueId === undefined) {
      continue;
    }
    const hydrated = hydrateNode({ index: references.index, node, spec: COMMENTS_REFS });
    const bucket = byIssue.get(issueId);
    if (bucket === undefined) {
      byIssue.set(issueId, [hydrated]);
    } else {
      bucket.push(hydrated);
    }
  }
  return byIssue;
}

/**
 * Every CHILD of one page of issues, in one request — `IssuesDocument` again, filtered by `parent.id.in`.
 *
 * The same document the lane already sends, which is the point: a child is an issue, so there is nothing to
 * express that the SDK cannot. The parser reads only each child's `identifier`, which the fragment carries.
 *
 * @returns each issue id to its child issue nodes; an issue with no children is simply absent
 */
export async function childrenFor({
  call,
  ids,
}: {
  call: LinearRequest;
  ids: readonly string[];
}): Promise<ReadonlyMap<string, readonly unknown[]>> {
  const byParent = new Map<string, unknown[]>();
  if (ids.length === 0) {
    return byParent;
  }
  const data = await call({
    query: ISSUES_QUERY,
    variables: { filter: { parent: { id: { in: ids } } }, first: ISSUES_PAGE_SIZE, includeArchived: true },
  });
  for (const node of rootPage({ data, key: "issues" }).nodes) {
    const parentId = isRecord(node) && isRecord(node["parent"]) ? str({ value: node["parent"]["id"] }) : undefined;
    if (parentId === undefined) {
      continue;
    }
    const bucket = byParent.get(parentId);
    if (bucket === undefined) {
      byParent.set(parentId, [node]);
    } else {
      bucket.push(node);
    }
  }
  return byParent;
}

/**
 * The four connections {@link ISSUE_ACTIVITY_QUERY} carries, for one page of issues, in ONE request.
 *
 * Overflow is still PAGED, per issue and per connection, exactly as it was when these rode the issue query:
 * only 0.025% of issues have more than 100 history events, so a follow-up is the rare tail rather than the
 * common case — and `projectUpdates(first: 10)` is why "rare" is never allowed to mean "unchecked".
 *
 * @returns each issue id to its four activity connections, each paged to exhaustion
 */
export async function issueActivityFor({
  call,
  ids,
  warnings,
}: {
  call: LinearRequest;
  ids: readonly string[];
  warnings: string[];
}): Promise<ReadonlyMap<string, NestedNodes>> {
  const byIssue = new Map<string, NestedNodes>();
  if (ids.length === 0) {
    return byIssue;
  }
  const data = await call({ query: ISSUE_ACTIVITY_QUERY, variables: { first: ids.length, ids } });
  for (const node of rootPage({ data, key: "issues" }).nodes) {
    const id = isRecord(node) ? str({ value: node["id"] }) : undefined;
    if (id === undefined) {
      continue;
    }
    byIssue.set(id, await completeNestedConnections({ call, id, node, warnings }));
  }
  return byIssue;
}

/**
 * One page of issues' relations, both ways, with each endpoint's identifier resolved.
 *
 * The EDGES cost no request — the reference pass walked the root `issueRelations` connection once, measured
 * live at over ten thousand relations in dozens of pages. What can cost one is the identifiers: an endpoint arrives as a bare
 * id, and a relation's other end is by definition an issue this page may not contain, so the ids the cache
 * does not know are filled in ONE bounded request per batch.
 *
 * The direction matters and is not cosmetic. A FORWARD relation's other end is its `relatedIssue`; an
 * INVERSE one's is its `issue`, because the same row read from the other side has its direction reversed —
 * see `./curated.ts` for what depends on that.
 *
 * @returns the page's relations indexed both ways: forward by their `issue`, inverse by their `relatedIssue`
 */
export async function relationsFor({
  call,
  ids,
  references,
  warnings,
}: {
  call: LinearRequest;
  ids: readonly string[];
  references: LinearReferences;
  warnings: string[];
}): Promise<{
  forward: ReadonlyMap<string, readonly unknown[]>;
  inverse: ReadonlyMap<string, readonly unknown[]>;
}> {
  const held = new Set(ids);
  const rows = [...references.issueRelations.values()].flat().filter((row) => touches({ held, row }));
  await fillReferences({ nodes: rows, references, request: call, spec: RELATION_REFS, warnings });
  const forward = new Map<string, unknown[]>();
  const inverse = new Map<string, unknown[]>();
  for (const row of rows) {
    const hydrated = hydrateNode({ index: references.index, node: row, spec: RELATION_REFS });
    fileUnderHeldEnd({ end: "issue", held, into: forward, row, value: hydrated });
    fileUnderHeldEnd({ end: "relatedIssue", held, into: inverse, row, value: hydrated });
  }
  return { forward, inverse };
}

/**
 * File one hydrated relation under ONE of its endpoints, when that endpoint is on the page in hand.
 *
 * The `held` check is what keeps this a per-PAGE join: a relation whose other end is an issue this page does
 * not contain is still carried — from the end that IS here — but never indexed under the end that is not.
 *
 * @param end which endpoint field to read the id off
 * @param held the issue ids this page carries
 * @param into the direction's map, MUTATED in place
 * @param row the raw relation row, read for its endpoint id
 * @param value the hydrated row to file
 */
function fileUnderHeldEnd({
  end,
  held,
  into,
  row,
  value,
}: {
  end: "issue" | "relatedIssue";
  held: ReadonlySet<string>;
  into: Map<string, unknown[]>;
  row: unknown;
  value: unknown;
}): void {
  const id = isRecord(row) && isRecord(row[end]) ? str({ value: row[end]["id"] }) : undefined;
  if (id === undefined || !held.has(id)) {
    return;
  }
  appendTo({ into, key: id, value });
}

/** Which reference kind a relation row's two endpoints point at. Both are ISSUES. */
const RELATION_REFS: LinearRefSpec = { issue: "issue", relatedIssue: "issue" };

/**
 * The three connections `@linear/sdk` ships no way to reach, for one page of projects, in ONE request.
 *
 * Addressed by the ids the SDK document just returned rather than one project at a time — see
 * `./queries.ts`'s {@link PROJECT_CONNECTIONS_QUERY} for the measurement that makes per-project impossible.
 * An overflow is not reachable at the inline sizes a working workspace measures, and is still REPORTED, because
 * "not reachable today" is how `projectUpdates(first: 10)` came to lose about a tenth of its updates.
 *
 * @returns each project id to its `teams`, `members` and `externalLinks` nodes
 */
export async function projectConnectionsFor({
  call,
  ids,
  warnings,
}: {
  call: LinearRequest;
  ids: readonly string[];
  warnings: string[];
}): Promise<ReadonlyMap<string, NestedNodes>> {
  if (ids.length === 0) {
    return new Map();
  }
  const data = await call({ query: PROJECT_CONNECTIONS_QUERY, variables: { first: ids.length, ids } });
  return companionConnections({ data, key: "projects", keys: ["teams", "members", "externalLinks"], warnings });
}

/**
 * An initiative's `links`, for one page of initiatives, in ONE request. Same shape and same reason.
 *
 * @returns each initiative id to its `links` nodes
 */
export async function initiativeConnectionsFor({
  call,
  ids,
  warnings,
}: {
  call: LinearRequest;
  ids: readonly string[];
  warnings: string[];
}): Promise<ReadonlyMap<string, NestedNodes>> {
  if (ids.length === 0) {
    return new Map();
  }
  const data = await call({ query: INITIATIVE_CONNECTIONS_QUERY, variables: { first: ids.length, ids } });
  return companionConnections({ data, key: "initiatives", keys: ["links"], warnings });
}

/**
 * Every status update for one page of projects, at the ROOT and filtered to exactly those projects.
 *
 * The connection was once capped at `first: 10` and never paged, which lost 89 of 868 project updates —
 * 10.3% of all project-status narrative. Reading it from the root closes that by construction: there is no
 * inline page to overflow, and the filter narrows it to the page in hand.
 *
 * @returns each project id to its status updates, parsed
 */
export async function projectUpdatesFor({
  call,
  ids,
  references,
}: {
  call: LinearRequest;
  ids: readonly string[];
  references: LinearReferences;
}): Promise<ReadonlyMap<string, readonly LinearUpdateItem[]>> {
  const byProject = new Map<string, unknown[]>();
  if (ids.length === 0) {
    return new Map();
  }
  const nodes = await collectCursorPages<unknown>({
    fetchPage: async ({ cursor }) => {
      const data = await call({
        query: PROJECT_UPDATES_QUERY,
        variables: {
          filter: { project: { id: { in: ids } } },
          first: PROJECT_UPDATES_PAGE_SIZE,
          includeArchived: true,
          ...(cursor !== undefined ? { after: cursor } : {}),
        },
      });
      const page = connectionPage({ holder: data, key: "projectUpdates" });
      return { hasMore: page.hasNext, items: page.nodes, nextCursor: page.hasNext ? page.endCursor : undefined };
    },
  });
  for (const node of nodes.items) {
    const projectId = isRecord(node) && isRecord(node["project"]) ? str({ value: node["project"]["id"] }) : undefined;
    if (projectId === undefined) {
      continue;
    }
    const bucket = byProject.get(projectId);
    const hydrated = hydrateNode({ index: references.index, node, spec: PROJECT_UPDATES_REFS });
    if (bucket === undefined) {
      byProject.set(projectId, [hydrated]);
    } else {
      bucket.push(hydrated);
    }
  }
  return new Map([...byProject].map(([id, raw]) => [id, parseProjectUpdates({ nodes: raw })]));
}

/**
 * Every team id the reference pass walked, or none when no pass ran — and then no per-team request is sent.
 *
 * @returns the team ids {@link documentTeamsFor} walks
 */
export function knownTeamIds({ references }: { references: LinearReferences }): readonly string[] {
  const teams = references.resolves ? references.index.get("team") : undefined;
  if (teams === undefined) {
    return [];
  }
  return [...teams.keys()];
}

/**
 * Which team each team-scoped document belongs to, for the WHOLE workspace, through the SDK's own document.
 *
 * `Document.team` is a real schema field — live introspection lists 28 fields on `Document` and
 * `team: Team` is one of them — that `@linear/sdk`'s `Document` fragment does not select, and no root
 * connection carries the edge. The old hand-written document selected `team { key }`, so the migration
 * silently dropped `attrs.team` and the searchable `Team:` line from every team-scoped document; a fallback
 * review over the migrated tree found it, not a test. What the SDK DOES declare is `DocumentFilter.team`,
 * so the edge is reached by sending `DocumentsDocument` once per team with `filter: { team: { id: { eq } } }`.
 * MEASURED live (`.cache/linear-probe/probe-document-teams.ts`): one request per team,
 * a few dozen across dozens of teams. A hand-written companion per page would cost about half that and a
 * fifth exemption; the extra requests buy the field with none.
 *
 * @param teamIds every team in the workspace, from the reference pass
 * @returns each document id to the id of its team; a document with no team is simply absent
 */
export async function documentTeamsFor({
  call,
  teamIds,
  warnings,
}: {
  call: LinearRequest;
  teamIds: readonly string[];
  warnings: string[];
}): Promise<ReadonlyMap<string, string>> {
  const byDocument = new Map<string, string>();
  for (const teamId of teamIds) {
    const walked = await collectCursorPages<unknown>({
      fetchPage: async ({ cursor }) => {
        const data = await call({
          query: DOCUMENTS_QUERY,
          variables: {
            filter: { team: { id: { eq: teamId } } },
            first: DOCUMENTS_PAGE_SIZE,
            includeArchived: true,
            ...(cursor !== undefined ? { after: cursor } : {}),
          },
        });
        const page = connectionPage({ holder: data, key: "documents" });
        return { hasMore: page.hasNext, items: page.nodes, nextCursor: page.hasNext ? page.endCursor : undefined };
      },
    });
    pushCursorWarning({ end: walked.end, lane: `linear documents team ${teamId}`, warnings });
    for (const id of idsOf({ nodes: walked.items })) {
      byDocument.set(id, teamId);
    }
  }
  return byDocument;
}
