/**
 * The event log, indexed by SHAPE rather than stored.
 *
 * The rule for voluminous telemetry: never store every event; index which event kinds
 * exist, every attribute found on them, and a few sampled examples per kind — so this atlas can say what
 * the event log contains and what an entry looks like, and cannot name the exact event at 14:41 on a given
 * day. Indexing by shape is still doing the work, not skipping it.
 *
 * So one entity per distinct `action`, never one per event. The walk that feeds this is exhaustive and
 * bounded by `pagination.ts`'s own page ceiling, which means a log too large to walk becomes a refusal and
 * therefore a recorded gap, rather than a silently truncated index. Each shape carries the window it was
 * observed over (`firstSeenDate`/`lastSeenDate`) and the number of entries folded into it, so a reader can
 * see what the index is a summary OF.
 */
import type { VantaEventLogDto } from "./censusApiSchemas.js";

/** How many whole entries each shape keeps as an illustration. *
 * @internal
 */
export const VANTA_EVENT_SHAPE_SAMPLE_LIMIT = 3;

/** One event kind, and everything observed about its entries. Stored as an entity's `detail`. */
export interface VantaEventShape {
  /** The event kind — Vanta's own `action` string, and this shape's provider id. */
  readonly action: string;
  /** Every attribute path found on an entry of this kind, with the JSON types seen at it. */
  readonly attributes: readonly { readonly path: string; readonly types: readonly string[] }[];
  /** Every `actor.type` seen on an entry of this kind. */
  readonly actorTypes: readonly string[];
  /** Every `targets[].type` seen on an entry of this kind. */
  readonly targetTypes: readonly string[];
  /** How many entries of this kind the walk folded in. */
  readonly observedCount: number;
  /** The earliest and latest entry dates this shape was observed over. */
  readonly firstSeenDate: string;
  readonly lastSeenDate: string;
  /** Whole entries kept as an illustration, capped at {@link VANTA_EVENT_SHAPE_SAMPLE_LIMIT}. */
  readonly samples: readonly VantaEventLogDto[];
}

/** The JSON type name for one value, as an attribute census records it. */
function jsonTypeOf({ value }: { value: unknown }): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/** The types already seen at one attribute path, or a fresh empty set the first time the path appears. */
function typesSeenAt({ held }: { held: Set<string> | undefined }): Set<string> {
  if (held == null) {
    return new Set<string>();
  }
  return held;
}

/** Walk one value, recording every attribute path beneath `prefix` and the type seen at each. */
function recordAttributePaths({
  value,
  prefix,
  into,
}: {
  value: unknown;
  prefix: string;
  into: Map<string, Set<string>>;
}): void {
  if (prefix !== "") {
    const seen = typesSeenAt({ held: into.get(prefix) });
    seen.add(jsonTypeOf({ value }));
    into.set(prefix, seen);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      recordAttributePaths({ into, prefix: `${prefix}[]`, value: item });
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, member] of Object.entries(value)) {
      recordAttributePaths({ into, prefix: prefix === "" ? key : `${prefix}.${key}`, value: member });
    }
  }
}

/** Everything accumulated for one action while folding, before it is frozen into a {@link VantaEventShape}. */
interface EventShapeAccumulator {
  attributes: Map<string, Set<string>>;
  actorTypes: Set<string>;
  targetTypes: Set<string>;
  observedCount: number;
  firstSeenDate: string;
  lastSeenDate: string;
  samples: VantaEventLogDto[];
}

/** The accumulator an action already holds, or a fresh one dated by this entry on first sight of the action. */
function accumulatorFor({
  existing,
  entry,
}: {
  existing: EventShapeAccumulator | undefined;
  entry: VantaEventLogDto;
}): EventShapeAccumulator {
  if (existing == null) {
    return {
      actorTypes: new Set<string>(),
      attributes: new Map<string, Set<string>>(),
      firstSeenDate: entry.date,
      lastSeenDate: entry.date,
      observedCount: 0,
      samples: [],
      targetTypes: new Set<string>(),
    };
  }
  return existing;
}

/** Fold one entry into its action's accumulator, minting the accumulator on first sight of that action. */
function foldEntry({ entry, into }: { entry: VantaEventLogDto; into: Map<string, EventShapeAccumulator> }): void {
  const accumulator = accumulatorFor({ entry, existing: into.get(entry.action) });
  recordAttributePaths({ into: accumulator.attributes, prefix: "", value: entry });
  accumulator.actorTypes.add(entry.actor.type);
  for (const target of entry.targets) {
    accumulator.targetTypes.add(target.type);
  }
  accumulator.observedCount += 1;
  accumulator.firstSeenDate = entry.date < accumulator.firstSeenDate ? entry.date : accumulator.firstSeenDate;
  accumulator.lastSeenDate = entry.date > accumulator.lastSeenDate ? entry.date : accumulator.lastSeenDate;
  if (accumulator.samples.length < VANTA_EVENT_SHAPE_SAMPLE_LIMIT) {
    accumulator.samples.push(entry);
  }
  into.set(entry.action, accumulator);
}

/**
 * Index a walk of the event log into one shape per event kind.
 *
 * @param entries every entry the walk read, in whatever order Vanta returned them
 * @returns one shape per distinct `action`, ordered by action so a published file is stable between runs
 */
export function indexVantaEventShapes({
  entries,
}: {
  entries: readonly VantaEventLogDto[];
}): readonly VantaEventShape[] {
  const accumulators = new Map<string, EventShapeAccumulator>();
  for (const entry of entries) {
    foldEntry({ entry, into: accumulators });
  }
  return [...accumulators.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([action, accumulator]) => ({
      action,
      actorTypes: [...accumulator.actorTypes].toSorted(),
      attributes: [...accumulator.attributes.entries()]
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([path, types]) => ({ path, types: [...types].toSorted() })),
      firstSeenDate: accumulator.firstSeenDate,
      lastSeenDate: accumulator.lastSeenDate,
      observedCount: accumulator.observedCount,
      samples: accumulator.samples,
      targetTypes: [...accumulator.targetTypes].toSorted(),
    }));
}
