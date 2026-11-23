/**
 * Pure Linear curated-layer extractors: an issue's declared relationships → explicit curated edges, its
 * attachments → ref-only metadata, and its relations → a TIMESTAMPED parallel attribute.
 *
 *  - **Sub-issues** — an issue's `children` become `sub-issue` edges (parent → child).
 *  - **Relations** — an issue's `relations` become `blocks`/`duplicate`/`relation` edges to the related issue.
 *  - **Attachments** — kept as ref-only `title (url)` lines; never bytes.
 *  - **Relation events** — every relation, from EITHER side, as a direction-normalised, timestamped line.
 *
 * All edge targets are `linear:<IDENTIFIER>` node keys (matching the issue atom's `linear:TEAM-123` node), so
 * an edge lines up with the target issue's own record.
 *
 * ## Why the timestamps are a PARALLEL attribute and not part of the edge
 *
 * `parseCuratedEdgeRef` takes everything after the FIRST `|` as the target. So appending a timestamp to
 * `"<kind>|<target>"` would not extend the encoding, it would CORRUPT the target of every existing bronze
 * record — silently, and for every reader. The existing encoding is therefore left byte-identical and the
 * timestamps live in their own attr, whose format is free precisely because nothing else parses it.
 *
 * ## Why `inverseRelations` contributes only to the parallel attr
 *
 * A relation reached from the inverse side has its direction REVERSED: `inverseRelations` on X are the
 * relations where X is the `relatedIssue`, so the real edge is other→X. Recording it on X's `curatedEdges`,
 * which are read as holder→target, would claim X blocks the thing that blocks X. Adding an inverted edge kind
 * would fix that, at the cost of changing the curated graph's vocabulary and semantics for a case the
 * measurement says is empty: over a complete sweep `inverseRelations` yields ZERO pairs the forward side does
 * not already have. It matters only for a WINDOWED refresh, where one side of a pair can be fetched without the
 * other — and this whole change is delivered by a rebuild from empty, where the forward side is always present.
 *
 * So the inverse side is captured as evidence in {@link relationEventRefs}, where the direction is explicit,
 * and the graph's edges keep exactly the direction semantics they already had.
 */
import { isRecord } from "../../lib/parsers.js";
import { type CuratedEdgeKind, encodeCuratedEdgeRef } from "../curated/types.js";

/** Linear `IssueRelation.type` → the curated edge kind (an unknown type is a generic `relation`). Pure. */
function relationEdgeKind({ type }: { type: string }): CuratedEdgeKind {
  if (type === "blocks") {
    return "blocks";
  }
  if (type === "duplicate") {
    return "duplicate";
  }
  return "relation";
}

/** The `linear:<identifier>` node key off a nested issue-like object (`child`/`relatedIssue`), or undefined. */
function issueNodeKey({ value }: { value: unknown }): string | undefined {
  const identifier = isRecord(value) && typeof value["identifier"] === "string" ? value["identifier"] : undefined;
  return identifier !== undefined && identifier.length > 0 ? `linear:${identifier}` : undefined;
}

/** The child-node keys off a complete `children` node list. Pure. */
function childEdgeRefs({ children }: { children: readonly unknown[] }): readonly string[] {
  return children
    .map((node) => issueNodeKey({ value: node }))
    .filter((key): key is string => key !== undefined)
    .map((target) => encodeCuratedEdgeRef({ kind: "sub-issue", target }));
}

/** The relation-node keys (typed) off a complete `relations` node list. Pure. */
function relationEdgeRefs({ nodes }: { nodes: readonly unknown[] }): readonly string[] {
  const refs: string[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const target = issueNodeKey({ value: node["relatedIssue"] });
    const type = typeof node["type"] === "string" ? node["type"] : "related";
    if (target !== undefined) {
      refs.push(encodeCuratedEdgeRef({ kind: relationEdgeKind({ type }), target }));
    }
  }
  return refs;
}

/**
 * The declared curated edges an issue contributes (sub-issues + typed relations), deduped and SORTED.
 *
 * Sorted because array CONTENTS participate in the dedup fingerprint: a reshuffled connection in an otherwise
 * identical response would otherwise look like a content change and append a false new version, forever.
 *
 * @param nodes the issue's complete `relations` node list
 * @param children the issue's complete `children` node list
 * @returns the encoded curated-edge refs (empty when the issue declares none)
 */
export function issueEdgeRefs({
  nodes,
  children,
}: {
  nodes: readonly unknown[];
  children: readonly unknown[];
}): readonly string[] {
  return [...new Set([...childEdgeRefs({ children }), ...relationEdgeRefs({ nodes })])].toSorted();
}

/**
 * The separator inside a relation-event line.
 *
 * A space, and safely so: every component is space-free (an ISO timestamp, a fixed kind word, a
 * `linear:TEAM-123` node key), so the line is unambiguous AND human-readable in a bronze row. It also contains
 * no `|` at all, so if one of these lines is ever handed to `parseCuratedEdgeRef` by mistake it is rejected
 * rather than half-parsed.
 */
const EVENT_SEP = " ";

/**
 * Every relation an issue participates in, from EITHER side, as a direction-normalised timestamped line:
 * `"<createdAt> <kind> <fromNode> <toNode>"`.
 *
 * Direction-normalised is the load-bearing word. The same relation seen from the forward side of one issue and
 * the inverse side of the other produces the BYTE-IDENTICAL line, so the two collapse to one logical link
 * instead of appearing as two — and `createdAt` is the field whose absence killed the retro census, where of
 * all the duplicate-relation pairs in the corpus exactly one had a datable "when did we notice".
 *
 * @param forward the issue's complete `relations` node list (holder → related)
 * @param inverse the issue's complete `inverseRelations` node list (other → holder)
 * @param holder the holding issue's identifier
 * @returns the deduped, sorted relation-event lines
 */
export function relationEventRefs({
  forward,
  inverse,
  holder,
}: {
  forward: readonly unknown[];
  inverse: readonly unknown[];
  holder: string;
}): readonly string[] {
  const self = `linear:${holder}`;
  const lines: string[] = [];
  for (const node of forward) {
    const line = relationEventLine({ from: self, node, otherKey: "relatedIssue", toOther: true });
    if (line !== undefined) {
      lines.push(line);
    }
  }
  for (const node of inverse) {
    const line = relationEventLine({ from: self, node, otherKey: "issue", toOther: false });
    if (line !== undefined) {
      lines.push(line);
    }
  }
  return [...new Set(lines)].toSorted();
}

/** One relation node → its normalised line, or undefined when the other side has no identifier. Pure. */
function relationEventLine({
  node,
  from,
  otherKey,
  toOther,
}: {
  node: unknown;
  from: string;
  otherKey: string;
  toOther: boolean;
}): string | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const other = issueNodeKey({ value: node[otherKey] });
  if (other === undefined) {
    return undefined;
  }
  const kind = relationEdgeKind({ type: typeof node["type"] === "string" ? node["type"] : "related" });
  const createdAt = typeof node["createdAt"] === "string" && node["createdAt"].length > 0 ? node["createdAt"] : "";
  const parts = toOther ? [from, other] : [other, from];
  return [createdAt, kind, ...parts].join(EVENT_SEP);
}

/** One attachment node → its ref-only `title (url)` line (never bytes), or undefined for a non-object. Pure. */
function attachmentRef({ att }: { att: unknown }): string | undefined {
  if (!isRecord(att)) {
    return undefined;
  }
  const title = typeof att["title"] === "string" && att["title"].length > 0 ? att["title"] : "attachment";
  const url = typeof att["url"] === "string" && att["url"].length > 0 ? att["url"] : undefined;
  return url !== undefined ? `${title} (${url})` : title;
}

/**
 * An issue's attachments as ref-only `title (url)` lines (never bytes), deduped and sorted.
 *
 * @param nodes the issue's complete `attachments` node list
 * @returns the deduped attachment ref lines (empty when none)
 */
export function issueAttachmentRefs({ nodes }: { nodes: readonly unknown[] }): readonly string[] {
  const refs = nodes.map((att) => attachmentRef({ att })).filter((ref): ref is string => ref !== undefined);
  return [...new Set(refs)].toSorted();
}

/**
 * The `project-item` curated edges an initiative declares, from its already-fetched `projects` connection.
 *
 * Without these, initiatives are orphans in the graph: the strategy layer exists as records with nothing
 * connecting it to the work underneath. Deduped and SORTED, because array contents participate in the dedup
 * fingerprint. Pure.
 *
 * Lives here (not `entities.ts`, which re-exports it) rather than in `parse.ts`, which calls it, so neither of
 * those two has to import the other for it.
 *
 * @param projectIds the ids of the projects the initiative contains
 * @returns the encoded curated-edge refs
 */
export function initiativeProjectEdges({ projectIds }: { projectIds: readonly string[] }): readonly string[] {
  return [
    ...new Set(projectIds.map((id) => encodeCuratedEdgeRef({ kind: "project-item", target: `linear:project:${id}` }))),
  ].toSorted();
}
