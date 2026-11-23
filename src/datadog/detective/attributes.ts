/**
 * Flattening one Datadog event's attribute tree into leaf paths and the JSON type at each. Pure.
 *
 * ## Why paths and types, and not the values
 *
 * A shape row's job is to tell a detective what a thing from this service LOOKS like, so the row can be
 * kept forever while the events it describes roll over every fifteen days. The paths are what survive that
 * trade: `eventName:string|null` says there is a searchable attribute and what it is called, which is
 * everything needed to write the query, and it costs a few dozen bytes rather than a few hundred per event.
 *
 * The values are a separate decision with a separate rule ({@link ./facets}), and the default is that there
 * are none. This module never reads one except to name its type.
 *
 * ## An array is one path, not N
 *
 * A `tags` array of forty entries flattens to forty paths under an index-per-path scheme, so two events with
 * different tag counts produce different shapes and the fold degenerates to one row per event. The element
 * type is collapsed instead: `tags:string[]`, one path, and a heterogeneous array reports every type it
 * holds. The index is information about ONE event; the element type is information about the shape.
 */

import { addInto } from "#lib/collections.js";

/** The JSON type at one leaf, as a shape row names it. */
type LeafType = "string" | "number" | "boolean" | "null" | "object" | "unknown";

/** One attribute path and every type seen at it across a sample. */
export interface LeafPath {
  /** The dotted path, with no array indices in it. */
  readonly path: string;
  /** Every type seen at this path, sorted, so two samples of the same shape compare equal. */
  readonly types: readonly string[];
}

/** How deep the walk goes before it stops descending and calls the node a leaf. *
 * @internal
 */
export const MAX_DEPTH = 12;

/** How many leaf paths one event may contribute before the walk stops. *
 * @internal
 */
export const MAX_PATHS_PER_EVENT = 600;

/**
 * The JSON type of one value, as a leaf type.
 *
 * `null` is its own type rather than folded into `object`, because a field that is sometimes null is the
 * single most useful thing a shape row says about it, and the reason the warning site exists at all.
 *
 * @returns the leaf type
 */
export function leafTypeOf({ value }: { value: unknown }): LeafType {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "object") {
    return "object";
  }
  return "unknown";
}

/** Whether a value is a plain object the walk should descend into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The element type of an array, written the way a shape row prints it.
 *
 * An empty array reports `[]` rather than a guessed element type: the sample genuinely does not say, and a
 * row claiming `string[]` off zero elements is the kind of confident guess this whole catalogue is arranged
 * against.
 *
 * @returns the type suffix, including the brackets
 */
function arrayTypeOf({ value }: { value: readonly unknown[] }): string {
  const kinds = [...new Set(value.map((element) => leafTypeOf({ value: element })))].toSorted();
  return kinds.length === 0 ? "[]" : `${kinds.join("|")}[]`;
}

/**
 * Walk one event's attribute tree, collecting the VALUE at every leaf.
 *
 * Both bounds are refusals to grow rather than errors: an event deeper than {@link MAX_DEPTH} or wider than
 * {@link MAX_PATHS_PER_EVENT} contributes what it reached and stops, because a shape row truncated at 600
 * paths is still useful while a walk that follows a cyclic or pathological payload is not. Datadog's own
 * events are neither, so neither bound has been observed firing on this organisation; they exist so a
 * payload nobody anticipated cannot hang a catalogue build.
 *
 * **The values come from the walk rather than from a second lookup, and that is a fix rather than a
 * preference.** A caller that has a path and wants its value cannot get there with {@link readPath}: that
 * splits on `.`, and Datadog sends `http.method`, `span.kind` and `view.url_path_group` as SINGLE KEYS
 * containing dots. Re-reading such a path found nothing, and the nothing then reached
 * `JSON.stringify`, which answers `undefined` for it — measured against this install's live site on a
 * `jobs-api` sample, where a catalogue build crashed reading `.length` of that `undefined`. Reproduce with
 * `slopweaver datadog catalogue build --from 1h --max-cells 2`.
 *
 * @param value the event's attribute tree
 * @param prefix the path already walked, empty at the root
 * @returns one entry per leaf, path to the value at it
 */
export function flattenLeafValues({
  value,
  prefix = "",
}: {
  value: unknown;
  prefix?: string;
}): ReadonlyMap<string, unknown> {
  const out = new Map<string, unknown>();
  const walk = ({ node, path, depth }: { node: unknown; path: string; depth: number }): void => {
    if (out.size >= MAX_PATHS_PER_EVENT) {
      return;
    }
    if (Array.isArray(node)) {
      out.set(path, node);
      return;
    }
    if (isRecord(node) && depth < MAX_DEPTH) {
      const keys = Object.keys(node);
      if (keys.length === 0) {
        out.set(path, node);
        return;
      }
      for (const key of keys) {
        walk({ depth: depth + 1, node: node[key], path: path === "" ? key : `${path}.${key}` });
      }
      return;
    }
    out.set(path, node);
  };
  walk({ depth: 0, node: value, path: prefix });
  out.delete("");
  return out;
}

/**
 * The type a shape row names one leaf value by.
 *
 * @param value the value at one leaf
 * @returns the type, with an array reporting its element types
 */
function leafTypeName({ value }: { value: unknown }): string {
  if (Array.isArray(value)) {
    return arrayTypeOf({ value });
  }
  return leafTypeOf({ value });
}

/**
 * Walk one event's attribute tree, collecting a type at every leaf.
 *
 * The type projection of {@link flattenLeafValues}, which is where the walk and both its bounds live.
 *
 * @param value the event's attribute tree
 * @param prefix the path already walked, empty at the root
 * @returns one entry per leaf, path to type
 */
export function flattenAttributes({
  value,
  prefix = "",
}: {
  value: unknown;
  prefix?: string;
}): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [path, leaf] of flattenLeafValues({ prefix, value })) {
    out.set(path, leafTypeName({ value: leaf }));
  }
  return out;
}

/**
 * Read one dotted path out of an already-flattened tree's SOURCE, for the handful of paths the key needs.
 *
 * A separate walk rather than a lookup in the flattened map, because the flattened map holds types and this
 * needs the value — and because the key is computed from four paths, so re-walking the whole tree to get
 * them would be the expensive way round.
 *
 * @param value the event's attribute tree
 * @param path the dotted path to read
 * @returns the value at that path, or nothing when any segment is absent
 */
export function readPath({ value, path }: { value: unknown; path: string }): unknown {
  let node: unknown = value;
  for (const segment of path.split(".")) {
    if (!isRecord(node)) {
      return undefined;
    }
    node = node[segment];
  }
  return node;
}

/**
 * Fold every leaf type seen across a sample into one sorted list per path.
 *
 * @param events one event's flattened leaves, once per event in the sample
 * @returns one {@link LeafPath} per distinct path, sorted by path
 */
export function foldLeafPaths({ events }: { events: readonly ReadonlyMap<string, string>[] }): readonly LeafPath[] {
  const byPath = new Map<string, Set<string>>();
  for (const event of events) {
    for (const [path, type] of event) {
      addInto({ key: path, sets: byPath, value: type });
    }
  }
  return [...byPath.entries()]
    .map(([path, types]) => ({ path, types: [...types].toSorted() }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}
