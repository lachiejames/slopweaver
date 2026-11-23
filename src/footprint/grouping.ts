/**
 * Hard edges between footprint nodes, and the components they form.
 *
 * ## This is provenance, not discovery — and the measurement says so
 *
 * MEASURED over the owner's fourteen days: 292 nodes joined by shared canonical entity produced
 * **285 components**, only five of them multi-node, absorbing twelve nodes. A 2.4% reduction. So entity
 * joining is not how workstreams are found, and shipping it as though it were would dress a rounding error
 * as a mechanism.
 *
 * It is kept because it is free, explainable and never wrong once keys are canonical and subject-scoped:
 * two nodes naming the same pull request really are about the same thing. Its job is to supply
 * high-confidence evidence when a node is assigned to a workstream, not to invent the workstreams.
 * Topical grouping — which is what the owner means by the word — is composed in the visible session and
 * recorded through `./ledger.ts`, because a hidden model call inside a sweep is banned outright
 * (`AGENTS.md` rule 2).
 *
 * ## A hub entity joins nothing
 *
 * An entity naming many nodes is a shared context rather than a shared subject — a repository everyone
 * touches, a ticket cited as background. Union-ing on one chains unrelated work into a single component
 * through a node that has nothing to do with either end, and connected components make that silent and
 * unrecoverable. Above {@link HUB_THRESHOLD} an entity is treated as context and contributes no edge.
 *
 * Pure: no clock, no filesystem, no network.
 */

import { pushInto } from "#lib/collections.js";
import type { EntityKey } from "./entities.js";
import type { FootprintNode } from "./nodes.js";

/**
 * How many nodes an entity may join before it counts as shared context rather than a shared subject.
 *
 * Four, from the shape of the real data rather than taste: the largest TRUE group measured on the owner's
 * fourteen days was three nodes (the same three security pull requests chased to three colleagues in three
 * separate direct messages), so a threshold of four admits every real group observed and still refuses a
 * chain. Re-measure with `slopweaver footprint scan --json` if the corpus shape changes.
 */
export const HUB_THRESHOLD = 4;

/** One hard edge, carried so a grouping can explain itself rather than merely assert. */
export interface HardEdge {
  readonly left: string;
  readonly right: string;
  /** The canonical entity both nodes are about. */
  readonly via: EntityKey;
}

/** A set of nodes joined by hard edges, with the edges that joined them. */
export interface Component {
  readonly nodeIds: readonly string[];
  readonly edges: readonly HardEdge[];
}

/**
 * Which entities are shared context rather than shared subject.
 *
 * @param nodes the nodes to read
 * @returns the entity keys that join more nodes than {@link HUB_THRESHOLD} allows
 */
export function hubEntities({ nodes }: { nodes: readonly FootprintNode[] }): ReadonlySet<EntityKey> {
  const counts = new Map<EntityKey, number>();
  for (const node of nodes) {
    for (const entity of node.entities) {
      // An entity's tally opens at its first node.
      if (!counts.has(entity)) {
        counts.set(entity, 0);
      }
      counts.set(entity, counts.get(entity)! + 1);
    }
  }
  const hubs = new Set<EntityKey>();
  for (const [entity, count] of counts) {
    if (count > HUB_THRESHOLD) {
      hubs.add(entity);
    }
  }
  return hubs;
}

/**
 * Every hard edge between the given nodes, hub entities excluded.
 *
 * @param nodes the nodes to join
 * @returns the edges, each naming the entity that justified it
 */
export function hardEdges({ nodes }: { nodes: readonly FootprintNode[] }): readonly HardEdge[] {
  const hubs = hubEntities({ nodes });
  const byEntity = new Map<EntityKey, string[]>();
  for (const node of nodes) {
    for (const entity of node.entities) {
      if (hubs.has(entity)) {
        continue;
      }
      pushInto({ buckets: byEntity, key: entity, value: node.id });
    }
  }
  const edges: HardEdge[] = [];
  for (const [via, ids] of byEntity) {
    const [first] = ids;
    if (first === undefined) {
      continue;
    }
    for (const other of ids.slice(1)) {
      edges.push({ left: first, right: other, via });
    }
  }
  return edges;
}

/**
 * The connected components the hard edges form.
 *
 * Every node appears in exactly one component, including the singletons — a node joined to nothing is its
 * own component rather than absent, so the caller can report the true yield instead of only the merges.
 *
 * @param nodes the nodes to group
 * @returns one component per group, each carrying the edges inside it
 */
export function componentsOf({ nodes }: { nodes: readonly FootprintNode[] }): readonly Component[] {
  const parent = new Map<string, string>();
  for (const node of nodes) {
    parent.set(node.id, node.id);
  }
  // Every id `find` walks is one of these nodes' ids, seeded above as its own parent: it is called with a
  // node's id or a hard edge's end, and `hardEdges` joins only these same nodes' ids. Every `parent.set`
  // below maps a node id to a node id, so no walk can step off the seeded keys.
  const find = ({ id }: { id: string }): string => {
    let cursor = id;
    let seen = parent.get(cursor)!;
    while (seen !== cursor) {
      const grand = parent.get(seen)!;
      parent.set(cursor, grand);
      cursor = seen;
      seen = parent.get(cursor)!;
    }
    return cursor;
  };
  const edges = hardEdges({ nodes });
  for (const edge of edges) {
    const left = find({ id: edge.left });
    const right = find({ id: edge.right });
    if (left !== right) {
      parent.set(left, right);
    }
  }
  const grouped = new Map<string, string[]>();
  for (const node of nodes) {
    const root = find({ id: node.id });
    pushInto({ buckets: grouped, key: root, value: node.id });
  }
  const components: Component[] = [];
  for (const [root, nodeIds] of grouped) {
    const inside = edges.filter((edge) => find({ id: edge.left }) === root);
    components.push({ edges: inside, nodeIds });
  }
  return components;
}
