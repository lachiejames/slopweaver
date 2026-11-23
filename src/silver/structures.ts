/**
 * The silver structural surface: turn the raw structure-bronze rows (org/team/repo/channel/usergroup/
 * workflow_state/cycle/data_source + their relations) into (1) a directory grouped by kind and (2) an
 * explicit relation graph — repo↔team permissions, team↔member, state/cycle↔team, channel↔member,
 * usergroup↔member. Unlike the cross-ref graph (`graph.ts`), this uses NO clique heuristic: every edge is a
 * declared relation. Membership edges resolve to canonical people via the PR4.1 identity resolution when one
 * is supplied. Pure + deterministic — sorted everywhere so the artifact is stable.
 */
import { absentAs } from "#lib/absent.js";
import type { StructureBronzeRow, StructureKind, StructureRelation } from "../corpus/structures/types.js";
import type { IdentityResolution } from "./identity.js";

/** A directory-facing projection of one structural entity (the curated fields + a relation count). */
interface StructureEntity {
  readonly id: string;
  readonly source: StructureBronzeRow["source"];
  readonly kind: StructureKind;
  readonly sourceId: string;
  readonly name?: string;
  readonly slug?: string;
  readonly url?: string;
  readonly attrs: StructureBronzeRow["attrs"];
  readonly relationCount: number;
}

/** One explicit relation edge between structural nodes (or a structural node and a canonical person). */
export interface StructureEdge {
  readonly from: string;
  readonly to: string;
  readonly type: StructureRelation["type"];
}

/** The structural directory: entities grouped by their plural kind, each list ranked deterministically. */
export interface StructureDirectory {
  readonly orgs: readonly StructureEntity[];
  readonly teams: readonly StructureEntity[];
  readonly repos: readonly StructureEntity[];
  readonly channels: readonly StructureEntity[];
  readonly usergroups: readonly StructureEntity[];
  readonly workflowStates: readonly StructureEntity[];
  readonly cycles: readonly StructureEntity[];
  readonly dataSources: readonly StructureEntity[];
  /** Issue labels — org vocabulary for kinds of work, with descriptions and the group hierarchy. */
  readonly issueLabels: readonly StructureEntity[];
  /** Saved views — each a durable statement about what a team treats as one body of work. */
  readonly customViews: readonly StructureEntity[];
}

/** The full silver structural artifact. */
export interface StructureArtifacts {
  readonly directory: StructureDirectory;
  readonly graph: { readonly nodes: readonly string[]; readonly edges: readonly StructureEdge[] };
  /**
   * Channels whose membership was never ASKED about — a capped or archived `conversations.members`.
   *
   * Reported rather than left implicit for the reason `../atlas/slack`'s `membershipKnown` is: a channel
   * nobody asked about and a channel nobody is in are both zero member edges, and only one of them is a
   * fact. Measured on a real workspace at the old default cap of 50: about two-thirds of hundreds of channels, while not one
   * of the 50 that WAS asked came back empty — so every zero here was an unasked question.
   *
   * Counted off the row's own `membershipResolved` attribute, so a store written before that attribute
   * existed contributes nothing and reads as fully resolved. That direction is deliberate: the alternative
   * is claiming a gap on every pre-existing row of every workspace.
   */
  readonly membershipUnresolved: number;
}

/** The channel attribute that says `conversations.members` was actually called — see {@link StructureArtifacts.membershipUnresolved}. */
const MEMBERSHIP_RESOLVED_ATTR = "membershipResolved";

/**
 * The node key for a structural entity (`<source>:<kind>:<sourceId>`). Pure.
 *
 * @param source which system the entity came from
 * @param kind what sort of entity it is (`team`, `repo`, …)
 * @param sourceId its id in that system
 * @returns the node key — kind-qualified as well as source-qualified, so a team and a repo sharing an id
 *   stay two nodes
 */
function structureNodeKey({ source, kind, sourceId }: { source: string; kind: string; sourceId: string }): string {
  return `${source}:${kind}:${sourceId}`;
}

/**
 * Keep the LATEST row per `(source, kind, sourceId)` (file order is chronological, so later wins). Pure.
 *
 * @param rows every stored row, in file order
 * @returns one row per entity — the last occurrence wins, which relies on file order being chronological
 */
export function latestStructureRows({ rows }: { rows: readonly StructureBronzeRow[] }): readonly StructureBronzeRow[] {
  const byKey = new Map<string, StructureBronzeRow>();
  for (const row of rows) {
    byKey.set(structureNodeKey({ kind: row.kind, source: row.source, sourceId: row.sourceId }), row);
  }
  return [...byKey.values()];
}

/** Project one row into a directory entity. Pure. */
function toEntity({ row }: { row: StructureBronzeRow }): StructureEntity {
  return {
    attrs: row.attrs,
    id: structureNodeKey({ kind: row.kind, source: row.source, sourceId: row.sourceId }),
    kind: row.kind,
    relationCount: row.relations.length,
    source: row.source,
    sourceId: row.sourceId,
    ...(row.identity.name !== undefined ? { name: row.identity.name } : {}),
    ...(row.identity.slug !== undefined ? { slug: row.identity.slug } : {}),
    ...(row.identity.url !== undefined ? { url: row.identity.url } : {}),
  };
}

/** Rank entities by relation count desc, then id asc. Pure. */
function rankEntities({ entities }: { entities: readonly StructureEntity[] }): readonly StructureEntity[] {
  return entities.toSorted((a, b) => b.relationCount - a.relationCount || a.id.localeCompare(b.id));
}

/** The empty directory buckets (kept explicit so the shape is stable even with no rows). Pure. */
function emptyBuckets(): Record<StructureKind, StructureEntity[]> {
  return {
    channel: [],
    custom_view: [],
    cycle: [],
    data_source: [],
    issue_label: [],
    org: [],
    repo: [],
    team: [],
    usergroup: [],
    workflow_state: [],
  };
}

/**
 * Group + rank the deduped entities by kind into the {@link StructureDirectory}.
 *
 * @param rows the rows to group, already deduped by {@link latestStructureRows}
 * @returns the directory, grouped by kind and ranked within each kind
 */
export function buildStructureDirectory({ rows }: { rows: readonly StructureBronzeRow[] }): StructureDirectory {
  const buckets = emptyBuckets();
  for (const row of latestStructureRows({ rows })) {
    buckets[row.kind].push(toEntity({ row }));
  }
  return {
    channels: rankEntities({ entities: buckets.channel }),
    customViews: rankEntities({ entities: buckets.custom_view }),
    cycles: rankEntities({ entities: buckets.cycle }),
    dataSources: rankEntities({ entities: buckets.data_source }),
    issueLabels: rankEntities({ entities: buckets.issue_label }),
    orgs: rankEntities({ entities: buckets.org }),
    repos: rankEntities({ entities: buckets.repo }),
    teams: rankEntities({ entities: buckets.team }),
    usergroups: rankEntities({ entities: buckets.usergroup }),
    workflowStates: rankEntities({ entities: buckets.workflow_state }),
  };
}

/** Resolve a `member` relation's `<source>:<nativeId>` target to a canonical `person:<id>` node. Pure. */
function personNode({ targetId, resolution }: { targetId: string; resolution: IdentityResolution }): string {
  const idx = targetId.indexOf(":");
  if (idx <= 0) {
    return `person:${targetId}`;
  }
  const key = `${targetId.slice(0, idx)} ${targetId.slice(idx + 1)}`;
  const canonical = resolution.index.get(key);
  return `person:${absentAs({ value: canonical, whenAbsent: targetId })}`;
}

/** The target node key for a relation — a canonical person node, else a `<source>:<kind>:<id>` entity node. Pure. */
function targetNode({ relation, resolution }: { relation: StructureRelation; resolution: IdentityResolution }): string {
  if (relation.targetKind === "person") {
    return personNode({ resolution, targetId: relation.targetId });
  }
  return structureNodeKey({ kind: relation.targetKind, source: relation.targetSource, sourceId: relation.targetId });
}

/** The empty resolution — so `buildStructureGraph({ rows })` works without an identity map. */
const EMPTY_RESOLUTION: IdentityResolution = { candidates: [], conflicts: [], index: new Map(), people: [] };

/**
 * Build the explicit structural graph: one node per deduped entity (plus each relation's target node) and one
 * edge per declared relation. Member relations resolve to canonical people via `resolution`. Deterministic.
 *
 * @param rows the structure-bronze rows
 * @param resolution the PR4.1 identity resolution (defaults to empty ⇒ per-source person nodes)
 * @returns the sorted structural nodes + edges
 */
export function buildStructureGraph({
  rows,
  resolution = EMPTY_RESOLUTION,
}: {
  rows: readonly StructureBronzeRow[];
  resolution?: IdentityResolution;
}): { nodes: readonly string[]; edges: readonly StructureEdge[] } {
  const nodes = new Set<string>();
  const edges = new Map<string, StructureEdge>();
  for (const row of latestStructureRows({ rows })) {
    const from = structureNodeKey({ kind: row.kind, source: row.source, sourceId: row.sourceId });
    nodes.add(from);
    for (const relation of row.relations) {
      const to = targetNode({ relation, resolution });
      nodes.add(to);
      edges.set(`${from}|${to}|${relation.type}`, { from, to, type: relation.type });
    }
  }
  return {
    edges: [...edges.values()].toSorted(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type),
    ),
    nodes: [...nodes].toSorted(),
  };
}

/**
 * Build the full silver structural artifact (directory + explicit graph) from the structure-bronze rows.
 *
 * @param rows the structure-bronze rows (all sources)
 * @param resolution the PR4.1 identity resolution for member-edge canonicalisation (defaults to empty)
 * @returns the structural directory + graph
 */
export function buildStructures({
  rows,
  resolution = EMPTY_RESOLUTION,
}: {
  rows: readonly StructureBronzeRow[];
  resolution?: IdentityResolution;
}): StructureArtifacts {
  return {
    directory: buildStructureDirectory({ rows }),
    graph: buildStructureGraph({ resolution, rows }),
    membershipUnresolved: countMembershipUnresolved({ rows }),
  };
}

/**
 * How many channels carry `membershipResolved: false` — the ones nobody asked about. Pure.
 *
 * A row with no such attribute is NOT counted: it predates the attribute rather than reporting a gap, and
 * inventing one for every pre-existing row would be exactly the over-claim this measurement exists to stop.
 *
 * @param rows the structure-bronze rows (all sources; only channels carry the attribute)
 * @returns the count of channels whose membership was never resolved
 */
function countMembershipUnresolved({ rows }: { rows: readonly StructureBronzeRow[] }): number {
  return latestStructureRows({ rows }).filter((row) => row.attrs[MEMBERSHIP_RESOLVED_ATTR] === false).length;
}
