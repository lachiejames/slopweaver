/**
 * The field lines `responseCodegen.ts` writes into a strict object, the lag fields it admits beside the declared
 * ones, the census folded under one map's keys, and the lag rows the inventory lists. None of these descends into
 * a specification node; the walk that does is `responseCodegen.ts`'s.
 */
import { err, ok, type Result } from "#lib/result.js";

import { isPrototypeName, ownCensusEntry, type ResponseStructure } from "../kit/responseStructure.js";

import { type DatadogCodegenError, DatadogCodegenErrors } from "./responseCodegenErrors.js";
import {
  type Context,
  childPath,
  type DatadogSpecLag,
  type Outcome,
  type Place,
  propertyName,
  SCALARS,
  withNull,
} from "./responseCodegenPlace.js";

/** The token a map's values are filed under once its keys are folded together; no recorded key carries `<`. */
export const MAP_VALUE = "<value>";

/** The key names measured directly under one object path. */
function measuredChildren({ structure, path }: { structure: ResponseStructure; path: string }): readonly string[] {
  const prefix = path === "" ? "" : `${path}.`;
  const keys = new Set<string>();
  for (const each of Object.keys(structure.paths)) {
    const rest = each.slice(prefix.length);
    const isChild = each.startsWith(prefix) && rest.length > 0 && !/[.[]/.test(rest);
    if (isChild) {
      keys.add(rest);
    }
  }
  return [...keys];
}

/**
 * One field's line, recording the cut a cut outcome lands on it.
 *
 * @param child the field's own census path, which a recorded cut names
 * @param required whether the field is required, rather than `.optional()`
 * @returns its source, `z.unknown()` for a cut, or a name only when never measured
 */
export function fieldLine({
  ctx,
  key,
  child,
  outcome,
  required,
}: {
  ctx: Context;
  key: string;
  child: string;
  outcome: Outcome;
  required: boolean;
}): string {
  const name = propertyName({ key });
  const optional = required ? "" : ".optional()";
  if (outcome.kind === "source") {
    return `${name}: ${outcome.source}${optional}`;
  }
  if (outcome.kind === "cut") {
    ctx.cuts.push({ path: child, reason: outcome.reason });
    return `${name}: z.unknown()${optional}`;
  }
  return `${name}: z.unknown().optional()`;
}

/**
 * Every key the census measured under an object the specification does not declare, each admitted and recorded as
 * lag. An admitted key is always optional — no specification arm requires it — and declares its measured scalars,
 * or is cut `unspecified` when it was measured as structure the specification says nothing of.
 *
 * @param declared the fields the specification declares there, which are not lag
 * @returns each lag field's key and line; or an `UNDECLARABLE` refusal naming the key
 */
export function lagFields({
  place,
  declared,
}: {
  place: Place;
  declared: ReadonlyMap<string, unknown>;
}): Result<readonly (readonly [string, string])[], DatadogCodegenError> {
  const fields: (readonly [string, string])[] = [];
  for (const key of measuredChildren({ path: place.path, structure: place.structure })) {
    if (declared.has(key)) {
      continue;
    }
    const line = lagField({ key, place });
    if (line.isErr()) {
      return err(line.error);
    }
    fields.push([key, line.value]);
  }
  return ok(fields);
}

/** One lag key's field line, recording its lag or its cut; or an `UNDECLARABLE` refusal naming the key. */
function lagField({ place, key }: { place: Place; key: string }): Result<string, DatadogCodegenError> {
  const { ctx, structure, path } = place;
  const child = childPath({ key, parent: path });
  const unsafe = key === "<unsafe>" || isPrototypeName({ name: key });
  if (unsafe) {
    const why = "a key no path or schema can carry: path notation, empty, or an Object.prototype name";
    return err(DatadogCodegenErrors.undeclarable({ path: child, surface: ctx.surface, why }));
  }
  if (key.startsWith("<")) {
    const why = `a data-shaped key (${key}) where the specification declares fields`;
    return err(DatadogCodegenErrors.undeclarable({ path: child, surface: ctx.surface, why }));
  }
  const kinds = Object.keys(ownCensusEntry({ key: child, record: structure.paths })!.kinds);
  // Measured structure is cut first, as at a declared field: nothing in a cut is read, a non-finite number included,
  // and the cut inventory lists the key in place of its lag.
  if (kinds.includes("object") || kinds.includes("array")) {
    return ok(fieldLine({ child, ctx, key, outcome: { kind: "cut", reason: "unspecified" }, required: false }));
  }
  if (kinds.includes("non-finite")) {
    const why = "a number too large for JSON to read back, which no number schema admits";
    return err(DatadogCodegenErrors.undeclarable({ path: child, surface: ctx.surface, why }));
  }
  ctx.lag.push({ lag: "key", path: child });
  const arms = SCALARS.filter(([kind]) => kinds.includes(kind)).map(([, source]) => ({ anyKeys: false, source }));
  const outcome: Outcome = withNull({ arms, nullable: kinds.includes("null") });
  return ok(fieldLine({ child, ctx, key, outcome, required: false }));
}

/** Where a path under a map's keys is filed once they are folded together, or `null` for a path outside the map. */
function mapValueTarget({ from, prefix }: { from: string; prefix: string }): string | null {
  const rest = from.slice(prefix.length);
  const key = /^[^.[]*/.exec(rest)![0];
  const isEntry = from.startsWith(prefix) && key.length > 0 && key !== MAP_VALUE;
  return isEntry ? `${prefix}${MAP_VALUE}${rest.slice(key.length)}` : null;
}

/**
 * The structure with every path under one map's keys also filed under {@link MAP_VALUE}, counts summed, so the
 * map's one value schema is checked against what every key carried and its requiredness counts every value.
 *
 * @param path the map's own census path
 * @returns a copy of the structure, the input left untouched
 */
export function foldedMapValues({
  structure,
  path,
}: {
  structure: ResponseStructure;
  path: string;
}): ResponseStructure {
  const prefix = path === "" ? "" : `${path}.`;
  const folded: ResponseStructure = { objects: { ...structure.objects }, paths: { ...structure.paths } };
  for (const [from, count] of Object.entries(structure.objects)) {
    const to = mapValueTarget({ from, prefix });
    if (to !== null) {
      addCount({ counts: folded.objects, key: to, count });
    }
  }
  for (const [from, entry] of Object.entries(structure.paths)) {
    const to = mapValueTarget({ from, prefix });
    if (to === null) {
      continue;
    }
    const sum = foldedEntry({ key: to, paths: folded.paths });
    sum.present += entry.present;
    sum.emptyArrays += entry.emptyArrays;
    const kinds: Partial<Record<string, number>> = sum.kinds;
    for (const [kind, seen] of Object.entries(entry.kinds)) {
      addCount({ count: seen, counts: kinds, key: kind });
    }
    folded.paths[to] = sum;
  }
  return folded;
}

/** The counts already folded under a target, or fresh ones: the first path folded under a target starts them. */
function foldedEntry({
  paths,
  key,
}: {
  paths: ResponseStructure["paths"];
  key: string;
}): ResponseStructure["paths"][string] {
  const held = ownCensusEntry({ key, record: paths });
  if (held !== undefined) {
    return held;
  }
  return { emptyArrays: 0, kinds: {}, present: 0 };
}

/** Add a count under a key, starting it there when the key holds none of its own. */
function addCount({
  counts,
  key,
  count,
}: {
  counts: Partial<Record<string, number>>;
  key: string;
  count: number;
}): void {
  const prior = ownCensusEntry({ key, record: counts });
  counts[key] = prior === undefined ? count : prior + count;
}

/**
 * One operation's lag as the inventory lists it: each place once, ordered by path and then lag, so a regeneration
 * over the same census writes the same rows and a diff shows only what moved.
 *
 * @param surface the registry operation's name, which every row carries
 * @param lag the lag its boundary admitted, in the order generation met it
 * @returns the rows, deduplicated and ordered
 */
export function datadogLagInventory({
  surface,
  lag,
}: {
  surface: string;
  lag: readonly DatadogSpecLag[];
}): readonly (DatadogSpecLag & { readonly surface: string })[] {
  const byKey = new Map(lag.map((entry) => [`${entry.path}\u0000${entry.lag}`, entry]));
  return [...byKey.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([, entry]) => ({ lag: entry.lag, path: entry.path, surface }));
}
