/**
 * The store's rows turned back into the register, judged exactly as a write is: a row the port would refuse to write
 * is refused on read too, so damage — or a write that skipped the port — surfaces as `WORKSTREAM_STORED_INVALID`
 * rather than as a register that quietly reads differently from what was written.
 *
 * Orders workstreams by id and each aggregate by `./canonical.ts` (the order the port writes in), decodes each
 * `detail` against its kind and derives progress from the entries.
 *
 * Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import type {
  WorkstreamEntryRow,
  WorkstreamLinkRow,
  WorkstreamMilestoneAfterRow,
  WorkstreamMilestoneRow,
  WorkstreamRegisterMetaRow,
  WorkstreamRow,
} from "../../store/schema.js";

import { byCodeUnit, canonicalAggregate } from "./canonical.js";
import { decodeWorkstreamDetail, decodeWorkstreamMeta } from "./decode.js";
import { deriveWorkstreamProgress } from "./derive.js";
import type {
  StoredWorkstream,
  StoredWorkstreamMeta,
  WorkstreamAggregate,
  WorkstreamMilestone,
  WorkstreamRegisterSnapshot,
} from "./types.js";
import { aggregateProblems } from "./validation.js";

/** Every row of the register, as one read in one transaction returned them. */
export interface WorkstreamRegisterRows {
  readonly meta: readonly WorkstreamRegisterMetaRow[];
  readonly workstreams: readonly WorkstreamRow[];
  readonly milestones: readonly WorkstreamMilestoneRow[];
  readonly edges: readonly WorkstreamMilestoneAfterRow[];
  readonly entries: readonly WorkstreamEntryRow[];
  readonly links: readonly WorkstreamLinkRow[];
}

/**
 * Group rows under the keys that own them, every key present even when it owns nothing — a workstream with no links
 * holds no link rows, and that is absence by design, not a missing value.
 *
 * @param keys every owner, each seeded with an empty group
 * @param keyOf which owner a row belongs to
 * @returns each key's rows in the order given; a row whose owner is not a key is left out (`orphanProblems` names it)
 */
function grouped<T>({
  keyOf,
  keys,
  rows,
}: {
  keyOf: (row: T) => string;
  keys: readonly string[];
  rows: readonly T[];
}): ReadonlyMap<string, readonly T[]> {
  const groups = new Map<string, T[]>(keys.map((key) => [key, []]));
  for (const row of rows) {
    groups.get(keyOf(row))?.push(row);
  }
  return groups;
}

/**
 * The children that name a workstream the rows do not hold — impossible through the foreign keys, so a damaged store.
 *
 * @returns one problem per orphaned owner and table
 */
function orphanProblems({ rows }: { rows: WorkstreamRegisterRows }): readonly string[] {
  const held = new Set(rows.workstreams.map((row) => row.id));
  const tables: readonly (readonly [string, readonly { readonly workstreamId: string }[]])[] = [
    ["workstream_milestone", rows.milestones],
    ["workstream_milestone_after", rows.edges],
    ["workstream_entry", rows.entries],
    ["workstream_link", rows.links],
  ];
  return tables.flatMap(([table, children]) =>
    [...new Set(children.map((child) => child.workstreamId))]
      .filter((owner) => !held.has(owner))
      .map((owner) => `${table} holds rows for ${owner}, which is not a workstream`),
  );
}

/** One workstream's row and every child row it owns. */
export interface WorkstreamAggregateRows {
  readonly row: WorkstreamRow;
  readonly milestones: readonly WorkstreamMilestoneRow[];
  readonly edges: readonly WorkstreamMilestoneAfterRow[];
  readonly entries: readonly WorkstreamEntryRow[];
  readonly links: readonly WorkstreamLinkRow[];
}

/**
 * One workstream row and its children as an aggregate, its detail not yet decoded.
 *
 * @returns the aggregate in deterministic order
 */
function aggregateOf({ edges, entries, links, milestones, row }: WorkstreamAggregateRows): WorkstreamAggregate {
  const after = grouped({ keyOf: (edge) => edge.milestoneId, keys: milestones.map((one) => one.id), rows: edges });
  const own: readonly WorkstreamMilestone[] = milestones.map((one) => ({
    after: after.get(one.id)!.map((edge) => edge.afterId),
    anchor: one.anchor,
    id: one.id,
    name: one.name,
    position: one.position,
  }));
  return canonicalAggregate({
    aggregate: {
      detail: row.detail,
      entries: entries.map((one) => ({
        date: one.date,
        done: one.done,
        href: one.href,
        id: one.id,
        kind: one.kind,
        milestoneId: one.milestoneId,
        position: one.position,
        text: one.text,
      })),
      id: row.id,
      kind: row.kind,
      links: links.map((one) => ({
        id: one.id,
        kind: one.kind,
        label: one.label,
        milestoneId: one.milestoneId,
        target: one.target,
      })),
      milestones: own,
      name: row.name,
      outcome: row.outcome,
      status: row.status,
      workspace: row.workspace,
    },
  });
}

/**
 * The register-level row as the stored document, or `null` when the register has none yet.
 *
 * @returns the meta, or the problems with it
 */
function metaOf({ rows }: { rows: readonly WorkstreamRegisterMetaRow[] }): Result<StoredWorkstreamMeta | null> {
  const [only, ...rest] = rows;
  if (only === undefined) {
    return ok(null);
  }
  if (rest.length > 0) {
    return err([`workstream_register_meta holds ${rows.length} rows; it is a singleton`]);
  }
  return decodeWorkstreamMeta({ value: only.document }).map((document) => ({
    document,
    revision: only.revision,
    updatedAtIso: only.updatedAt.toISOString(),
  }));
}

/**
 * Turn every row of the register into the snapshot a reader sees, refusing anything the port would refuse to write.
 *
 * @param rows every row one read returned
 * @returns the snapshot, or every problem found
 */
export function assembleWorkstreamRegister({
  rows,
}: {
  rows: WorkstreamRegisterRows;
}): Result<WorkstreamRegisterSnapshot> {
  const meta = metaOf({ rows: rows.meta });
  const problems: string[] = [...orphanProblems({ rows }), ...(meta.isErr() ? meta.error : [])];
  const ids = rows.workstreams.map((row) => row.id);
  const known = new Set(ids);
  const keyOf = (child: { readonly workstreamId: string }): string => child.workstreamId;
  const children = {
    edges: grouped({ keyOf, keys: ids, rows: rows.edges }),
    entries: grouped({ keyOf, keys: ids, rows: rows.entries }),
    links: grouped({ keyOf, keys: ids, rows: rows.links }),
    milestones: grouped({ keyOf, keys: ids, rows: rows.milestones }),
  };
  const workstreams: StoredWorkstream[] = [];
  for (const row of rows.workstreams.toSorted((a, b) => byCodeUnit({ a: a.id, b: b.id }))) {
    const stored = storedWorkstreamOf({
      knownWorkstreamIds: known,
      rows: {
        edges: children.edges.get(row.id)!,
        entries: children.entries.get(row.id)!,
        links: children.links.get(row.id)!,
        milestones: children.milestones.get(row.id)!,
        row,
      },
    });
    if (stored.isErr()) {
      problems.push(...stored.error);
    } else {
      workstreams.push(stored.value);
    }
  }
  if (problems.length > 0 || meta.isErr()) {
    return err(problems);
  }
  return ok({ meta: meta.value, workstreams });
}

/**
 * One workstream's rows as the workstream a reader sees: decoded, judged as a write would be, progress derived.
 *
 * @param rows the workstream's row and every child it owns
 * @param knownWorkstreamIds the workstreams a `workstream` link may name — the register, or the targets a write locked
 * @returns the stored workstream, or every problem with it
 */
export function storedWorkstreamOf({
  knownWorkstreamIds,
  rows,
}: {
  knownWorkstreamIds: ReadonlySet<string>;
  rows: WorkstreamAggregateRows;
}): Result<StoredWorkstream> {
  const { row } = rows;
  const aggregate = aggregateOf(rows);
  const detail = decodeWorkstreamDetail({ kind: row.kind, owner: row.id, value: row.detail });
  const problems = [...aggregateProblems({ aggregate, knownWorkstreamIds }), ...(detail.isErr() ? detail.error : [])];
  if (problems.length > 0 || detail.isErr()) {
    return err(problems);
  }
  return ok({
    ...aggregate,
    createdAtIso: row.createdAt.toISOString(),
    detail: detail.value,
    progress: deriveWorkstreamProgress({ aggregate }),
    revision: row.revision,
    updatedAtIso: row.updatedAt.toISOString(),
  });
}
