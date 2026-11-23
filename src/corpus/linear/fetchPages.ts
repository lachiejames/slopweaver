/**
 * The PURE page-and-join primitives every lane in `./fetchApi.ts`, `./fetchDocuments.ts` and
 * `./fetchInitiatives.ts` is built from.
 *
 * Split out of `fetchApi.ts` (file-size ratchet) along a real seam rather than at a convenient line: nothing
 * here sends a request or decides a lane's shape. These are the operations a lane performs on a response it
 * already has — reading a root connection page off it, clamping the size of the next one, and folding a
 * companion document's nodes back onto the holders they belong to.
 *
 * The JOIN helpers are the reason this file is worth naming. Every lane reads its joins out of a map keyed by
 * holder id, and a holder the join returned nothing for is the ordinary case, not an anomaly — an issue with
 * no comments, a project in no initiative. Saying that once, in a function whose name and doc say it, is what
 * `no-silent-fallback` asks for: the twelve `?? []` and `?? {}` expressions this replaces each made the same
 * substitution silently, and none of them said which absence it stood for.
 */
import { pushCursorWarning } from "../../lib/paging.js";
import { isRecord } from "../../lib/parsers.js";
import { hydrateNode, type LinearNameIndex, type LinearRefSpec } from "./names.js";
import { connectionPage, type NestedNodes } from "./nested.js";
import { str } from "./parseFields.js";

/**
 * One raw connection page off a GraphQL response: its nodes + the next cursor. Pure.
 *
 * @param key the root field the connection came back under
 * @returns the page's nodes, plus `nextCursor` only when the connection reports another page AND names it
 */
export function rootPage({ data, key }: { data: unknown; key: string }): {
  nodes: readonly unknown[];
  nextCursor?: string;
} {
  const connection = isRecord(data) ? data[key] : undefined;
  const nodes = isRecord(connection) && Array.isArray(connection["nodes"]) ? connection["nodes"] : [];
  const info = isRecord(connection) ? connection["pageInfo"] : undefined;
  const endCursor = isRecord(info) && typeof info["endCursor"] === "string" ? info["endCursor"] : undefined;
  const hasNext = isRecord(info) && info["hasNextPage"] === true;
  return { nodes, ...(hasNext && endCursor !== undefined && endCursor.length > 0 ? { nextCursor: endCursor } : {}) };
}

/**
 * What a join map holds for one holder: its rows, or an EMPTY list when the join returned none for it.
 *
 * The empty list is the honest answer rather than a stand-in for a failure. A join is built by walking a root
 * connection for a whole page of holders, so a holder that appears in no row of it genuinely has no rows —
 * an issue nobody commented on, a project in no initiative — and the lane goes on to project it with an empty
 * connection, which is what the corpus should record.
 *
 * @param byId the join, keyed by holder id
 * @param id the holder to read
 * @returns the holder's rows, empty when the join has none
 */
export function joinedRows<T>({ byId, id }: { byId: ReadonlyMap<string, readonly T[]>; id: string }): readonly T[] {
  const rows = byId.get(id);
  if (rows === undefined) {
    return [];
  }
  return rows;
}

/**
 * The same reading for a NESTED-connection join, whose value is a bag of connections rather than one list.
 *
 * An empty bag means every connection on that holder is absent, which the projector reads exactly as it reads
 * an empty list — see {@link joinedRows} for why absence here is an answer rather than a failure.
 *
 * @param byId the join, keyed by holder id
 * @param id the holder to read
 * @returns the holder's nested connections, empty when the join has none
 */
export function joinedNested({ byId, id }: { byId: ReadonlyMap<string, NestedNodes>; id: string }): NestedNodes {
  const nested = byId.get(id);
  if (nested === undefined) {
    return {};
  }
  return nested;
}

/**
 * The page size to actually request: the caller's, CLAMPED to the lane's own safe maximum.
 *
 * `--fetch-cap N` reaches the lane as a page size, and without this clamp it silently overrides the per-lane
 * maximum that the complexity ceiling forced. That is not a hypothetical: `--fetch-cap 40` pushed the projects
 * query to 14,424 points and the whole lane failed, while a normal uncapped run of the same code was fine.
 *
 * A fetch cap is a statement about HOW MUCH to fetch. It has no business making one query more expensive. Pure.
 *
 * @param requested the caller's page size (absent ⇒ the lane maximum)
 * @param laneMax the lane's measured-safe maximum
 * @returns the page size to send
 */
export function clampPageSize({ requested, laneMax }: { requested: number | undefined; laneMax: number }): number {
  return requested === undefined ? laneMax : Math.min(requested, laneMax);
}

/**
 * The id to page an issue's nested connections by — the internal id, or the identifier when it carries none.
 *
 * Both are named rather than coalesced, because they are not the same kind of answer: a node with an `id` is
 * one this crawl can join against every other lane, and a node with only an `identifier` is one it can still
 * page but cannot look up.
 *
 * @param node the raw issue node
 * @returns the id to page by, or undefined when the node carries neither
 */
export function issueNodeId({ node }: { node: unknown }): string | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const internal = str({ value: node["id"] });
  if (internal !== undefined) {
    return internal;
  }
  return str({ value: node["identifier"] });
}

/**
 * Whether a relation row names an issue on this page at either end. Pure.
 *
 * @param held the issue ids the page in hand carries
 * @returns true iff either endpoint is one of them
 */
export function touches({ row, held }: { row: unknown; held: ReadonlySet<string> }): boolean {
  if (!isRecord(row)) {
    return false;
  }
  const from = isRecord(row["issue"]) ? row["issue"]["id"] : undefined;
  const to = isRecord(row["relatedIssue"]) ? row["relatedIssue"]["id"] : undefined;
  return (typeof from === "string" && held.has(from)) || (typeof to === "string" && held.has(to));
}

/** Push onto a map-of-lists, minting the list on first use. */
export function appendTo({ into, key, value }: { into: Map<string, unknown[]>; key: string; value: unknown }): void {
  const bucket = into.get(key);
  if (bucket === undefined) {
    into.set(key, [value]);
  } else {
    bucket.push(value);
  }
}

/**
 * One companion document's nodes, folded into per-holder connection node lists. Overflow WARNS. Pure.
 *
 * @param data the companion document's raw response
 * @param key the root connection the holders came back under
 * @param keys the nested connections to fold off each holder
 * @param warnings the lane's warning sink, appended to when a nested page overflowed with no cursor to follow
 * @returns each holder's nested connections, keyed by holder id
 */
export function companionConnections({
  data,
  key,
  keys,
  warnings,
}: {
  data: unknown;
  key: string;
  keys: readonly string[];
  warnings: string[];
}): ReadonlyMap<string, NestedNodes> {
  const byHolder = new Map<string, NestedNodes>();
  for (const node of rootPage({ data, key }).nodes) {
    const id = isRecord(node) ? str({ value: node["id"] }) : undefined;
    if (id === undefined) {
      continue;
    }
    const nested: Record<string, readonly unknown[]> = {};
    for (const connection of keys) {
      const page = connectionPage({ holder: node, key: connection });
      nested[connection] = page.nodes;
      if (page.hasNext) {
        pushCursorWarning({ end: { kind: "no-cursor" }, lane: `linear ${key} ${id} ${connection}`, warnings });
      }
    }
    byHolder.set(id, nested);
  }
  return byHolder;
}

/**
 * Hydrate a node's named references AND its `status`, which is a PROJECT STATUS rather than a workflow state.
 *
 * Kept out of the spec and done here because the two are one field name apart and a transposition compiles:
 * `WorkflowState` and `ProjectStatus` both have `name` and `type`, so resolving a project's `status` against
 * the workflow-state index would answer with a real name belonging to a different object.
 *
 * @param spec which reference kind each of the node's own relations points at
 * @returns the node with every reference resolved
 */
export function hydrateStatus({
  node,
  spec,
  index,
}: {
  node: unknown;
  spec: LinearRefSpec;
  index: LinearNameIndex;
}): unknown {
  return hydrateNode({ index, node: hydrateNode({ index, node, spec }), spec: { status: "projectStatus" } });
}

/**
 * The ids of a page's nodes, skipping any node that carries none. Pure.
 *
 * @returns the ids, in page order
 */
export function idsOf({ nodes }: { nodes: readonly unknown[] }): readonly string[] {
  return nodes
    .map((node) => (isRecord(node) ? str({ value: node["id"] }) : undefined))
    .filter((id): id is string => id !== undefined);
}
