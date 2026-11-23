/**
 * The structural half of a response census: every key path an answer carried, its JSON kinds and how often it was
 * present — NEVER a value. An atlas that generates strict response boundaries from live answers folds each answer
 * through {@link observeResponseStructure}; what it adds around that (statuses, carriers, which surface an answer
 * belongs to) is its own. JumpCloud's `responseCensus.ts` and Datadog's are the two that do.
 *
 * ## A path is written the way a generator reads it
 *
 * The root is `""`, an object's key is `parent.key` (`key` at the root), and an array's items are `parent[]`.
 * `objects` counts every object seen at a path, so a key is present on EVERY object at its parent exactly when its
 * `present` equals the parent's `objects` count — which is what makes a key required rather than optional.
 *
 * ## A key that is data is normalised
 *
 * Some answers key a map by an id: a workflow run's inputs, a system's per-hash records. Kept raw, each id would be
 * declared a field and the next one refused. So a key shaped like an object id, a UUID, an email address, a
 * SHA-256 digest or a bare integer is recorded under one placeholder, and a generator declares that object a
 * record. `@timestamp`, which Directory Insights sends on every event, is a field name rather than an address. A key
 * carrying `.`, `[`, `]`, `<` or `>` would be misread as a path or a placeholder, the empty key as the root's own
 * path, and a name `Object.prototype` carries as an inherited member, so each is recorded as `<unsafe>`. A generator
 * refuses one wherever it would have to DECLARE the key; under a map, whose keys are data, it checks the value and
 * declares nothing (Datadog's `responseCodegen.ts`), and JumpCloud's, which infers maps from the keys, refuses it
 * outright.
 */
import { z } from "zod";

/** Every JSON kind the census counts, a number that overflowed to `Infinity` on parsing counted apart. */
export const RESPONSE_JSON_KINDS = ["array", "boolean", "non-finite", "null", "number", "object", "string"] as const;

/** A JSON value's kind as the census counts it. */
export type ResponseJsonKind = (typeof RESPONSE_JSON_KINDS)[number];

/**
 * One key path's tally across every answer a surface gave.
 * @internal
 */
export interface ResponsePathCensus {
  /** How many times the path was present — once per parent object, or once per array item. */
  present: number;
  /** How many times each kind was seen there. */
  kinds: Partial<Record<ResponseJsonKind, number>>;
  /** How many of the arrays seen there were empty. */
  emptyArrays: number;
}

/** The structure of every answer one surface gave: objects counted per path, and every key path's tally. */
export interface ResponseStructure {
  /** Objects seen at each path. */
  objects: Record<string, number>;
  /** Every key path seen. */
  paths: Record<string, ResponsePathCensus>;
}

/**
 * One tally as a census file writes it: a whole number of observations, never negative. A census is summed with the
 * others a generator is given, and a negative count summed in would SUBTRACT a measurement — shrinking a parent's object
 * count until an optional field reads as present on every one.
 */
export const RESPONSE_CENSUS_COUNT = z.number().int().nonnegative();

/** A count per name, as a census file writes one. */
export const RESPONSE_CENSUS_COUNTS = z.record(z.string(), RESPONSE_CENSUS_COUNT);

/** One key path's tally as a census file writes it, so a file of any other shape is refused when read back. */
export const RESPONSE_PATH_CENSUS_FILE = z.strictObject({
  emptyArrays: RESPONSE_CENSUS_COUNT,
  kinds: z.partialRecord(z.enum(RESPONSE_JSON_KINDS), RESPONSE_CENSUS_COUNT),
  present: RESPONSE_CENSUS_COUNT,
});

/** Each placeholder a data-shaped key is recorded under, tested in order. */
const DATA_KEYS: readonly (readonly [RegExp, string])[] = [
  [/^[0-9a-f]{24}$/i, "<objectid>"],
  [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "<uuid>"],
  [/^[0-9a-f]{64}$/i, "<sha256>"],
  // The first domain label holds no dot, so it and the dot after it cannot trade characters and backtrack.
  [/^[^@\s]+@[^@\s.]+\.[^@\s]+$/, "<email>"],
  [/^\d+$/, "<int>"],
  // A key the path notation cannot carry, recorded so a generator refuses its surface rather than misreading it.
  // The empty key is one: at the root its path is "", the root's own, and generation would recurse into itself.
  [/^$|[.[\]<>]/, "<unsafe>"],
];

/**
 * Every name `Object.prototype` carries. As a census key it would read an inherited member back as a tally, and
 * `__proto__` would set a prototype; as a schema key `defineBoundary` refuses it, since Zod reads an absent one
 * through the prototype. So a provider key or a surface named like one is recorded as unsafe.
 */
const PROTOTYPE_NAMES: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype));

/**
 * Whether a name is one `Object.prototype` carries. A predicate rather than the set itself, so no importer can
 * add to the set and change what every census files as unsafe.
 *
 * @param name a provider key or a surface name
 * @returns `true` for a name such as `constructor` or `__proto__`
 */
export function isPrototypeName({ name }: { name: string }): boolean {
  return PROTOTYPE_NAMES.has(name);
}

/**
 * The shape every key recorded under a placeholder matched, so a boundary can hold a keyed map's keys to it.
 *
 * @param placeholder a placeholder {@link responseCensusKey} records, such as `<uuid>`
 * @returns the shape, or `null` for `<unsafe>` and for anything that is not a placeholder
 */
export function responseCensusKeyShape({ placeholder }: { placeholder: string }): RegExp | null {
  if (placeholder === "<unsafe>") {
    return null;
  }
  const entry = DATA_KEYS.find(([, name]) => name === placeholder);
  if (entry === undefined) {
    return null;
  }
  return entry[0];
}

/**
 * The placeholder a data-shaped key is recorded under, or the key itself when it is a field name.
 *
 * @param key one object key as the provider sent it
 * @returns the placeholder, or the key unchanged
 */
export function responseCensusKey({ key }: { key: string }): string {
  if (PROTOTYPE_NAMES.has(key)) {
    return "<unsafe>";
  }
  const placeholder = DATA_KEYS.find(([shape]) => shape.test(key));
  if (placeholder === undefined) {
    return key;
  }
  return placeholder[1];
}

/**
 * The kind of one JSON value.
 *
 * @returns the kind the census counts it as, a non-finite number apart from a finite one
 */
export function responseJsonKind({ value }: { value: unknown }): ResponseJsonKind {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return "non-finite";
  }
  const kind = typeof value;
  if (kind === "boolean" || kind === "number" || kind === "string") {
    return kind;
  }
  return "object";
}

/**
 * A census dictionary's OWN entry under a key, never one inherited: a provider key such as `constructor` would
 * otherwise read `Object.prototype`'s member back as an entry already counted.
 *
 * @returns the entry, or `undefined` when the dictionary holds none of its own under that key
 */
export function ownCensusEntry<V>({ record, key }: { record: Partial<Record<string, V>>; key: string }): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Add one to a count, starting it at one when the key has not been counted yet.
 *
 * @param counts the counts, updated in place
 */
export function bumpCensusCount<K extends string>({
  counts,
  key,
}: {
  counts: Partial<Record<K, number>>;
  key: K;
}): void {
  const prior = ownCensusEntry<number>({ key, record: counts });
  counts[key] = prior === undefined ? 1 : prior + 1;
}

/** The tally at one path, opened empty the first time the path is seen. */
function pathEntry({ structure, path }: { structure: ResponseStructure; path: string }): ResponsePathCensus {
  const seen = ownCensusEntry({ key: path, record: structure.paths });
  if (seen !== undefined) {
    return seen;
  }
  const opened: ResponsePathCensus = { emptyArrays: 0, kinds: {}, present: 0 };
  structure.paths[path] = opened;
  return opened;
}

/** Count one value at one path. */
function tally({ structure, path, value }: { structure: ResponseStructure; path: string; value: unknown }): void {
  const entry = pathEntry({ path, structure });
  entry.present += 1;
  bumpCensusCount({ counts: entry.kinds, key: responseJsonKind({ value }) });
  if (Array.isArray(value) && value.length === 0) {
    entry.emptyArrays += 1;
  }
}

/**
 * Fold one parsed answer into a surface's structure: every key path below the root tallied, never a value.
 *
 * @param structure the surface's structure, updated in place
 * @param path where the value sits — `""` for an answer's root
 * @param value the parsed answer, or a value inside one
 */
export function observeResponseStructure({
  structure,
  path,
  value,
}: {
  structure: ResponseStructure;
  path: string;
  value: unknown;
}): void {
  if (Array.isArray(value)) {
    const itemPath = `${path}[]`;
    value.forEach((item: unknown) => {
      tally({ path: itemPath, structure, value: item });
      observeResponseStructure({ path: itemPath, structure, value: item });
    });
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  bumpCensusCount({ counts: structure.objects, key: path });
  for (const [key, child] of Object.entries(value)) {
    const recorded = responseCensusKey({ key });
    const childPath = path === "" ? recorded : `${path}.${recorded}`;
    tally({ path: childPath, structure, value: child });
    observeResponseStructure({ path: childPath, structure, value: child });
  }
}
