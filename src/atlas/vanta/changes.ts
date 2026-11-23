/**
 * What one Vanta atlas sync changed against the generation it replaced — the record a visible session reads
 * to decide what the owner would want to hear about.
 *
 * There are no rules for what is worth reporting — the diff is usually small, and a session
 * reading it judges what the owner would want to see. So nothing here decides what MATTERS. It only makes the
 * change small enough to judge.
 *
 * The one shaping choice is how CHANGED entities are grouped: by the set of top-level detail fields that
 * moved. MEASURED over two real generations: `lastTestRunDate` moved on every test,
 * `lastCheckDate` on every computer checked in between, and the test STATUS flips were buried among them. Grouped by
 * signature and listed rarest first, the churn reads as one line and the flips as their own group. A list of
 * volatile fields to ignore would be a rule, and would go stale the day Vanta adds a timestamp.
 *
 * Only the Manage API channel is compared; `firstSeenAt`, `lastSeenAt` and `source` are bookkeeping that moves
 * on every read. A kind with no prior successful read is a BASELINE — counts only — because a first sync, a
 * sync after `atlas vanta reset` or a kind a schema bump added would otherwise list every entity as added
 * (every integration resource the account holds, among them). A kind this run did not read completely is LISTED as unread, never left
 * out, because an absent kind reads as one where nothing changed.
 *
 * Pure: generations in, one record out.
 */
import { z } from "zod";

import { isRecord } from "#lib/parsers.js";
import { stableStringify } from "#lib/stableStringify.js";
import { atlasEntityName } from "../kit/entityLabel.js";
import { VANTA_KINDS, type VantaEntity, type VantaKind } from "./model.js";

const isoSchema = z.iso.datetime();

/** Most examples kept for each changed group. */
export const VANTA_CHANGE_GROUP_EXAMPLES = 10;
/** Most examples kept for the added arm and for the removed arm, each. */
export const VANTA_CHANGE_ARM_EXAMPLES = 25;
/** Most changed groups listed per kind; the rest are counted in `groupsOmitted`. */
export const VANTA_CHANGE_GROUPS = 12;
/** Longest rendering kept of one field's before or after value. */
export const VANTA_CHANGE_VALUE_CHARS = 200;
/** The field name a change is recorded under when `detail` itself is not an object. */
export const WHOLE_DETAIL_FIELD = "(detail)";

const entityRefSchema = z.object({ name: z.string().nullable(), providerId: z.string().min(1) }).strict();

const addedRefSchema = entityRefSchema.extend({ returned: z.boolean() }).strict();

const fieldChangeSchema = z.object({ after: z.string(), before: z.string(), field: z.string().min(1) }).strict();

const changedExampleSchema = entityRefSchema.extend({ fields: z.array(fieldChangeSchema) }).strict();

const changeGroupSchema = z
  .object({ count: z.number().int().positive(), examples: z.array(changedExampleSchema), fields: z.array(z.string()) })
  .strict();

const countsSchema = z
  .object({
    added: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  })
  .strict();

const kindChangeSchema = z.discriminatedUnion("read", [
  z
    .object({
      added: z.array(addedRefSchema),
      addedMore: z.number().int().nonnegative(),
      changedGroups: z.array(changeGroupSchema),
      counts: countsSchema,
      fieldTally: z.record(z.string(), z.number().int().positive()),
      groupsOmitted: z
        .object({ entities: z.number().int().nonnegative(), groups: z.number().int().nonnegative() })
        .strict(),
      kind: z.enum(VANTA_KINDS),
      /** Why the sync still called this read failed after publishing it — a vendor companion write, today. */
      notes: z.array(z.string()),
      read: z.literal("complete"),
      removed: z.array(entityRefSchema),
      removedMore: z.number().int().nonnegative(),
      since: isoSchema,
    })
    .strict(),
  z
    .object({ entities: z.number().int().nonnegative(), kind: z.enum(VANTA_KINDS), read: z.literal("baseline") })
    .strict(),
  z.object({ kind: z.enum(VANTA_KINDS), read: z.literal("incomplete"), reasons: z.array(z.string()) }).strict(),
]);

/** One sync's change record, as written to `$SLOPWEAVER_HOME/vanta/changes/`. */
export const vantaChangeRecordSchema = z
  .object({ at: isoSchema, kinds: z.array(kindChangeSchema), version: z.literal(1) })
  .strict();

export type VantaChangeRecord = z.infer<typeof vantaChangeRecordSchema>;
export type VantaKindChange = z.infer<typeof kindChangeSchema>;
export type VantaChangeGroup = z.infer<typeof changeGroupSchema>;

/**
 * One kind as the sync left it: what it held before, what it published, and whether this run read it.
 *
 * `complete` is whether the ENTITIES were read and published, which is what a comparison needs; `notes` carry
 * the sync's own reasons when it still called that read failed. Taking the sync's verdict instead would list a
 * published read as unread, and the next sync, comparing against what this one published, would never show it.
 */
export interface VantaKindTransition {
  readonly kind: VantaKind;
  readonly before: readonly VantaEntity[];
  readonly after: readonly VantaEntity[];
  readonly complete: boolean;
  readonly reasons: readonly string[];
  readonly notes: readonly string[];
  /** When `before` was read (`vantaWindowStart`, `changesRecord.ts`), or `null` when never — a baseline read. */
  readonly since: string | null;
}

/** The headline numbers across every completely read kind, for the sync report's one line. */
export interface VantaChangeTotals {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  readonly baseline: number;
  readonly incomplete: number;
}

/** Cut a rendered value to the cap, saying how much was dropped so a cut never reads as the whole value. */
function cutValue({ text }: { text: string }): string {
  if (text.length <= VANTA_CHANGE_VALUE_CHARS) {
    return text;
  }
  return `${text.slice(0, VANTA_CHANGE_VALUE_CHARS)}…(+${String(text.length - VANTA_CHANGE_VALUE_CHARS)} chars)`;
}

/** The Manage API detail an entity carries while observed, or `undefined` when that channel is absent or stale. */
function observedDetail({ entity }: { entity: VantaEntity | undefined }): { detail: unknown } | undefined {
  const channel = entity?.channels["manage-api"];
  if (channel?.state !== "observed") {
    return undefined;
  }
  return { detail: channel.detail };
}

/** Every top-level detail field whose canonical rendering differs, with both renderings cut to the cap. */
function fieldChanges({
  before,
  after,
}: {
  before: unknown;
  after: unknown;
}): readonly z.infer<typeof fieldChangeSchema>[] {
  if (!isRecord(before) || !isRecord(after)) {
    const beforeText = stableStringify({ value: before });
    const afterText = stableStringify({ value: after });
    return beforeText === afterText
      ? []
      : [{ after: cutValue({ text: afterText }), before: cutValue({ text: beforeText }), field: WHOLE_DETAIL_FIELD }];
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].toSorted();
  return keys.flatMap((field) => {
    const beforeText = stableStringify({ value: before[field] });
    const afterText = stableStringify({ value: after[field] });
    return beforeText === afterText
      ? []
      : [{ after: cutValue({ text: afterText }), before: cutValue({ text: beforeText }), field }];
  });
}

/** Entity refs ordered by provider id, so the same generations always produce the same bytes. */
function sortedByProviderId<T extends { readonly providerId: string }>({ refs }: { refs: readonly T[] }): T[] {
  return refs.toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/** Group changed entities by the fields that moved, rarest group first, ties broken by the field list. */
function groupChanged({ changed }: { changed: readonly z.infer<typeof changedExampleSchema>[] }): {
  groups: readonly VantaChangeGroup[];
  omitted: { entities: number; groups: number };
} {
  const bySignature = new Map<string, z.infer<typeof changedExampleSchema>[]>();
  for (const example of changed) {
    const signature = example.fields.map((change) => change.field).join(",");
    const members = bySignature.get(signature);
    if (members === undefined) {
      bySignature.set(signature, [example]);
    } else {
      members.push(example);
    }
  }
  const all = [...bySignature.entries()]
    .map(([signature, members]) => ({ members: sortedByProviderId({ refs: members }), signature }))
    .toSorted(
      (left, right) => left.members.length - right.members.length || left.signature.localeCompare(right.signature),
    );
  const kept = all.slice(0, VANTA_CHANGE_GROUPS);
  const dropped = all.slice(VANTA_CHANGE_GROUPS);
  return {
    groups: kept.map(({ members }) => ({
      count: members.length,
      examples: members.slice(0, VANTA_CHANGE_GROUP_EXAMPLES),
      fields: members[0]!.fields.map((change) => change.field),
    })),
    omitted: { entities: dropped.reduce((sum, group) => sum + group.members.length, 0), groups: dropped.length },
  };
}

/** How many changed entities touched each field, keys sorted. */
function tallyFields({
  changed,
}: {
  changed: readonly z.infer<typeof changedExampleSchema>[];
}): Record<string, number> {
  const tally = new Map<string, number>();
  for (const example of changed) {
    for (const change of example.fields) {
      const prior = tally.get(change.field);
      tally.set(change.field, prior === undefined ? 1 : prior + 1);
    }
  }
  return Object.fromEntries([...tally.entries()].toSorted(([left], [right]) => left.localeCompare(right)));
}

/** Where one entity present after the sync lands. `absent` is one the Manage API saw in neither generation. */
type EntityArm =
  | { readonly arm: "added"; readonly ref: z.infer<typeof addedRefSchema> }
  | { readonly arm: "removed"; readonly ref: z.infer<typeof entityRefSchema> }
  | { readonly arm: "changed"; readonly example: z.infer<typeof changedExampleSchema> }
  | { readonly arm: "unchanged" }
  | { readonly arm: "absent" };

/** Which arm one entity present after the sync belongs to, given what the store held for it before. */
function armOf({ entity, prior }: { entity: VantaEntity; prior: VantaEntity | undefined }): EntityArm {
  const now = observedDetail({ entity });
  const then = observedDetail({ entity: prior });
  const refFrom = ({ detail }: { detail: unknown }) => ({
    name: atlasEntityName({ detail }),
    providerId: entity.providerId,
  });
  if (then === undefined) {
    if (now === undefined) {
      return { arm: "absent" };
    }
    return { arm: "added", ref: { ...refFrom(now), returned: prior !== undefined } };
  }
  if (now === undefined) {
    return { arm: "removed", ref: refFrom(then) };
  }
  const fields = fieldChanges({ after: now.detail, before: then.detail });
  return fields.length === 0
    ? { arm: "unchanged" }
    : { arm: "changed", example: { ...refFrom(now), fields: [...fields] } };
}

/** Every entity of two generations, sorted into the arm it belongs to: added or returned, removed, changed, or not. */
function classifyEntities({ before, after }: { before: readonly VantaEntity[]; after: readonly VantaEntity[] }): {
  added: z.infer<typeof addedRefSchema>[];
  removed: z.infer<typeof entityRefSchema>[];
  changed: z.infer<typeof changedExampleSchema>[];
  unchanged: number;
} {
  const priorById = new Map(before.map((entity) => [entity.id, entity]));
  const added: z.infer<typeof addedRefSchema>[] = [];
  const removed: z.infer<typeof entityRefSchema>[] = [];
  const changed: z.infer<typeof changedExampleSchema>[] = [];
  let unchanged = 0;
  for (const entity of after) {
    const placed = armOf({ entity, prior: priorById.get(entity.id) });
    if (placed.arm === "added") {
      added.push(placed.ref);
    } else if (placed.arm === "removed") {
      removed.push(placed.ref);
    } else if (placed.arm === "changed") {
      changed.push(placed.example);
    } else if (placed.arm === "unchanged") {
      unchanged += 1;
    }
  }
  const afterIds = new Set(after.map((entity) => entity.id));
  for (const prior of before) {
    const then = observedDetail({ entity: prior });
    if (!afterIds.has(prior.id) && then !== undefined) {
      removed.push({ name: atlasEntityName({ detail: then.detail }), providerId: prior.providerId });
    }
  }
  return { added, changed, removed, unchanged };
}

/**
 * Compare one completely read kind's two generations.
 *
 * @param transition the kind's two generations and the sync's notes on it
 * @param since when `before` was read, which bounds the window the comparison covers
 * @returns the kind's change entry
 */
function diffKind({
  transition: { kind, before, after, notes },
  since,
}: {
  transition: VantaKindTransition;
  since: string;
}): VantaKindChange {
  const { added, changed, removed, unchanged } = classifyEntities({ after, before });
  const sortedAdded = sortedByProviderId({ refs: added });
  const sortedRemoved = sortedByProviderId({ refs: removed });
  const { groups, omitted } = groupChanged({ changed });
  return {
    added: sortedAdded.slice(0, VANTA_CHANGE_ARM_EXAMPLES),
    addedMore: Math.max(0, sortedAdded.length - VANTA_CHANGE_ARM_EXAMPLES),
    changedGroups: [...groups],
    counts: {
      added: added.filter((ref) => !ref.returned).length,
      changed: changed.length,
      removed: removed.length,
      returned: added.filter((ref) => ref.returned).length,
      unchanged,
    },
    fieldTally: tallyFields({ changed }),
    groupsOmitted: omitted,
    kind,
    notes: [...notes],
    read: "complete",
    removed: sortedRemoved.slice(0, VANTA_CHANGE_ARM_EXAMPLES),
    removedMore: Math.max(0, sortedRemoved.length - VANTA_CHANGE_ARM_EXAMPLES),
    since,
  };
}

/**
 * Compare every kind one sync touched against what the store held before it.
 *
 * @param transitions each synced kind's before and after, in the order the sync ran them
 * @param at the sync's own instant, which names the record
 * @returns the record a visible session judges
 */
export function diffVantaGeneration({
  transitions,
  at,
}: {
  transitions: readonly VantaKindTransition[];
  at: string;
}): VantaChangeRecord {
  const kinds = transitions.map((transition): VantaKindChange => {
    if (!transition.complete) {
      return { kind: transition.kind, read: "incomplete", reasons: [...transition.reasons] };
    }
    if (transition.since === null) {
      return { entities: transition.after.length, kind: transition.kind, read: "baseline" };
    }
    return diffKind({ since: transition.since, transition });
  });
  return { at, kinds, version: 1 };
}

/**
 * The headline numbers of one record.
 *
 * @returns added (returned included), removed and changed summed over completely read kinds, plus how many
 *   kinds were a baseline or unread
 */
export function vantaChangeTotals({ record }: { record: VantaChangeRecord }): VantaChangeTotals {
  let added = 0;
  let removed = 0;
  let changed = 0;
  let baseline = 0;
  let incomplete = 0;
  for (const entry of record.kinds) {
    if (entry.read === "complete") {
      added += entry.counts.added + entry.counts.returned;
      removed += entry.counts.removed;
      changed += entry.counts.changed;
    } else if (entry.read === "baseline") {
      baseline += 1;
    } else {
      incomplete += 1;
    }
  }
  return { added, baseline, changed, incomplete, removed };
}
