/*
 * The pure fixtures the Linear fetch test files share: an inline nested connection, one raw issue node in the
 * SDK fragment's shape, one shaped issue item, and a seam page of those items. Nothing here touches disk. It
 * moved here when `fetch.test.ts` was split by behaviour.
 */
import type { LinearIssuesPage } from "../../../../../corpus/linear/apiTypes.js";
import type { LinearIssueItem } from "../../../../../corpus/linear/items.js";

/**
 * An inline nested connection: its first page plus whether another follows.
 *
 * @param hasNext whether the connection claims a further page, under the cursor `cc`
 * @returns the connection, as a GraphQL reply carries it
 */
export function conn({
  nodes,
  hasNext = false,
}: {
  nodes: readonly unknown[];
  hasNext?: boolean;
}): Record<string, unknown> {
  return { nodes, pageInfo: { endCursor: hasNext ? "cc" : null, hasNextPage: hasNext } };
}

/**
 * One raw issue node, in the shape `@linear/sdk`'s `Issue` fragment returns it.
 *
 * No connections at all, and every relation a bare `{ id }` — which is the whole reason this lane now sends
 * four more documents per page. The names come back through the crawl's reference index instead.
 *
 * @param extra fields spread over the defaults, last
 * @returns the raw node
 */
export function issueNode({
  id,
  extra = {},
}: {
  id: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    assignee: { id: "u-dana" },
    createdAt: "2026-05-01T00:00:00.000Z",
    creator: { id: "u-seth" },
    description: "the retriever drops old records",
    id,
    identifier: id,
    labelIds: [],
    project: { id: "p-search" },
    state: { id: "s-doing" },
    team: { id: "t-eng" },
    title: "recall regression",
    updatedAt: "2026-05-01T00:00:00.000Z",
    url: `https://linear.app/acme/issue/${id}`,
    ...extra,
  };
}

/**
 * One shaped issue item with no comments or labels, titled after its identifier.
 *
 * @returns the item
 */
export const issue = ({ identifier }: { identifier: string }): LinearIssueItem => ({
  comments: [],
  identifier,
  labels: [],
  title: `issue ${identifier}`,
  tsIso: "2026-05-01T00:00:00.000Z",
  url: `https://linear.app/acme/issue/${identifier}`,
});

/**
 * A seam page carrying issues and no history rows — the shape most lane tests need.
 *
 * @param identifiers one shaped issue per identifier, in order
 * @param nextCursor the cursor of the following page, left off the page when absent
 * @returns the page
 */
export function issuesPage({
  identifiers,
  nextCursor,
}: {
  identifiers: readonly string[];
  nextCursor?: string;
}): LinearIssuesPage {
  return {
    historyRows: [],
    issues: identifiers.map((identifier) => issue({ identifier })),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}
