/**
 * ONE generalised collector for every nested connection on a Linear issue.
 *
 * Before this module, exactly one nested connection was paged: `comments`, by a bespoke `remainingComments`
 * loop. Everything else was capped at a hard `first: N` and quietly truncated — `attachments(first: 20)`
 * against an observed max of 34, `projectUpdates(first: 10)` losing 10.3% of all project-status narrative,
 * `team.members` passing no `first:` at all and taking GraphQL's silent default of 50. The lesson is not
 * "raise the caps"; it is that a per-connection paging loop is a thing you write once and then never write
 * again for the next connection, so the eleventh connection is always the truncated one.
 *
 * So paging lives here, driven by {@link NESTED_CONNECTIONS} as data. Adding a connection is one registry
 * entry and it is paged for free; there is no second place to forget.
 *
 * ## The cost shape, so nobody reads this as an N+1
 *
 * The inline first page rides the issue-page query and costs NOTHING extra. A follow-up request happens only
 * when a connection genuinely reports `hasNextPage`, which the measured per-connection maxima say is rare
 * (relations max 11, children 24, labels 7; comments overflow on 0.6% of issues; history >100 events on
 * 0.025%). A complete history ingest over all 24,033 issues was measured to cost 10 extra requests. This is
 * the established "inline first page, follow-up only on real overflow" pattern, generalised — never a fetch
 * per issue, which is forbidden.
 */
import { collectCursorPages, pushCursorWarning } from "../../lib/paging.js";
import { isRecord } from "../../lib/parsers.js";
import {
  ISSUE_ACTIVITY_CONNECTIONS,
  type LinearParent,
  type NestedConnection,
  nestedConnectionQuery,
} from "./queries.js";
import type { LinearRequest } from "./transport.js";

/** One connection page: its nodes plus whether (and from where) another page follows. */
export interface ConnectionPage {
  readonly nodes: readonly unknown[];
  readonly hasNext: boolean;
  readonly endCursor?: string;
}

/** An empty terminal page — the honest answer for a connection that is absent or malformed. */
const NO_PAGE: ConnectionPage = { hasNext: false, nodes: [] };

/**
 * Read a `{ nodes, pageInfo }` connection off any object. Pure, and deliberately lenient: an absent or
 * malformed connection yields an empty TERMINAL page rather than throwing, so one odd node cannot sink a
 * whole crawl — but it never invents `hasNext`, so a lost connection stops rather than spins.
 *
 * @param holder the object carrying the connection
 * @param key the connection field name
 * @returns the page
 */
export function connectionPage({ holder, key }: { holder: unknown; key: string }): ConnectionPage {
  if (!isRecord(holder)) {
    return NO_PAGE;
  }
  const connection = holder[key];
  if (!isRecord(connection) || !Array.isArray(connection["nodes"])) {
    return NO_PAGE;
  }
  const info = connection["pageInfo"];
  if (!isRecord(info)) {
    return { hasNext: false, nodes: connection["nodes"] };
  }
  const endCursor =
    typeof info["endCursor"] === "string" && info["endCursor"].length > 0 ? info["endCursor"] : undefined;
  return {
    hasNext: info["hasNextPage"] === true,
    nodes: connection["nodes"],
    ...(endCursor !== undefined ? { endCursor } : {}),
  };
}

/**
 * Page ONE overflowing nested connection to exhaustion, starting after the inline page's cursor.
 *
 * Returns the inline nodes unchanged when nothing overflowed — which is the overwhelmingly common case, and
 * the reason this costs no extra request per issue. A connection that reports `hasNextPage` but no cursor is
 * treated as terminal: following a null cursor re-serves page one forever.
 *
 * @param call the shared Linear transport
 * @param id the issue's id
 * @param conn the connection's registry entry
 * @param inline the connection's inline first page
 * @param warnings the running warning list, MUTATED in place when the walk ends incompletely
 * @param parent which entity owns the connection, since the follow-up query differs per parent
 * @returns every node across every page, in page order
 */
export async function collectNestedConnection({
  call,
  id,
  conn,
  inline,
  warnings,
  parent = "issue",
}: {
  call: LinearRequest;
  id: string;
  conn: NestedConnection;
  inline: ConnectionPage;
  warnings: string[];
  parent?: LinearParent;
}): Promise<readonly unknown[]> {
  if (!inline.hasNext) {
    return inline.nodes;
  }
  if (inline.endCursor === undefined) {
    // Linear said there is more and gave nothing to ask with. Following it is impossible; saying so is not.
    pushCursorWarning({ end: { kind: "no-cursor" }, lane: `linear ${parent} ${id} ${conn.key}`, warnings });
    return inline.nodes;
  }
  const query = nestedConnectionQuery({ conn, parent });
  const rest = await collectCursorPages<unknown>({
    fetchPage: async ({ cursor }) => {
      const data = await call({ query, variables: { after: cursor, id } });
      const page = connectionPage({ holder: isRecord(data) ? data[parent] : undefined, key: conn.key });
      return { hasMore: page.hasNext, items: page.nodes, nextCursor: page.hasNext ? page.endCursor : undefined };
    },
    firstCursor: inline.endCursor,
  });
  pushCursorWarning({ end: rest.end, lane: `linear ${parent} ${id} ${conn.key}`, warnings });
  return [...inline.nodes, ...rest.items];
}

/**
 * Complete every listed connection on one NON-issue parent, returning the node lists keyed by connection.
 *
 * The issue lane has had this since the generalised collector landed; projects, initiatives and users had the
 * `pageInfo` flag and no follow-up, which a review pass correctly called a silent truncation. One helper for all
 * three rather than three loops: the eleventh connection is always the one someone forgets.
 *
 * @param call the shared Linear transport
 * @param id the parent's id
 * @param node the raw parent node (carrying every inline first page)
 * @param connections the connections to complete
 * @param parent the root field the parent is fetched back through
 * @param warnings the running warning list, MUTATED in place when a walk ends incompletely
 * @returns each connection's complete node list
 * @internal — the parent-parameterised core `completeNestedConnections` binds to `issue`; nothing else calls it.
 */
export async function completeParentConnections({
  call,
  id,
  node,
  connections,
  parent,
  warnings,
}: {
  call: LinearRequest;
  id: string;
  node: unknown;
  connections: readonly NestedConnection[];
  parent: LinearParent;
  warnings: string[];
}): Promise<NestedNodes> {
  const collected: Record<string, readonly unknown[]> = {};
  for (const conn of connections) {
    const inline = connectionPage({ holder: node, key: conn.key });
    collected[conn.key] = await collectNestedConnection({ call, conn, id, inline, parent, warnings });
  }
  return collected;
}

/** Every nested connection's complete node list for one issue, keyed by connection name. */
export type NestedNodes = Readonly<Record<string, readonly unknown[]>>;

/**
 * Complete every nested connection on one issue node.
 *
 * Walks {@link NESTED_CONNECTIONS} in order and pages each that overflowed. Sequential rather than
 * concurrent on purpose: these requests share one rate-limited transport, so firing them in parallel would
 * only queue them behind the same scheduler while making the ordering of a 429 harder to reason about.
 *
 * @param call the shared Linear transport
 * @param id the issue's id
 * @param node the raw issue node (carrying every inline first page)
 * @param warnings the running warning list, MUTATED in place when a walk ends incompletely
 * @returns each connection's complete node list
 */
export async function completeNestedConnections({
  call,
  id,
  node,
  warnings,
}: {
  call: LinearRequest;
  id: string;
  node: unknown;
  warnings: string[];
}): Promise<NestedNodes> {
  const collected: Record<string, readonly unknown[]> = {};
  for (const conn of ISSUE_ACTIVITY_CONNECTIONS) {
    const inline = connectionPage({ holder: node, key: conn.key });
    collected[conn.key] = await collectNestedConnection({ call, conn, id, inline, warnings });
  }
  return collected;
}

/**
 * How many of an issue's nested connections overflowed their inline page — the honest per-issue extra-request
 * count, so a claim about request cost can be measured rather than asserted. Pure.
 *
 * @param node the raw issue node
 * @returns the number of connections that reported another page
 */
export function overflowingConnectionCount({ node }: { node: unknown }): number {
  return ISSUE_ACTIVITY_CONNECTIONS.filter((conn) => connectionPage({ holder: node, key: conn.key }).hasNext).length;
}
