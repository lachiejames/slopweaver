/**
 * How one cut probe reads an answer: the probe shapes `./toolCuts.ts`'s entries and `./verbChildCuts.ts`'s rows are
 * written in, and the reading that turns one into a `path: value` clause. The registry says WHICH fields a tool sets;
 * this says what a field set to a given value means. Pure.
 */
import type { Json } from "./readCoverage";

/** An object a tool answered with. */
export type Bag = { readonly [key: string]: Json };

/**
 * One check on an answer. A `path` is dotted from the answer's top (`beyondCap.more`); an `each` path may step into
 * every entry of a list with `[]` (`mentioned[].quotes`).
 */
export type CutProbe =
  // The value there says something was left out: `true`, a positive count, a non-empty sentence or list.
  | { readonly set: string }
  // The value there is one of these (`status: "incomplete"`, `complete: false`, `exitCode: null`).
  | { readonly at: string; readonly is: readonly (string | boolean | null)[] }
  // How many entries of the list there carry a set `field`, or a `field` equal to `is`.
  | { readonly each: string; readonly field: string; readonly is?: string | boolean }
  // How many strings of the list there end in the producer's own cut mark.
  | { readonly each: string; readonly endsWith: string }
  // The sentences of the list there (or each entry's `says` field) that say a loss, past any carrying a standing phrase.
  | { readonly each: string; readonly unless: readonly string[]; readonly says?: string }
  // Whether any field of the object there equals `is` (`shown.Queue: "unread"`).
  | { readonly anyOf: string; readonly is: string };

/**
 * The value at a dotted path of an answer.
 *
 * @returns the value there, or `undefined` when any step is missing or not an object
 */
export function valueAt({ answer, path }: { answer: Bag; path: string }): Json | undefined {
  let value: Json | undefined = answer;
  for (const key of path.split(".")) {
    value = isBag(value) ? value[key] : undefined;
  }
  return value;
}

/**
 * Whether a JSON value is an object bag, never an array or `null`; a readonly array escapes `Array.isArray`.
 *
 * @returns whether it is a bag
 */
export function isBag(value: Json | undefined): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value that says something was left out, rendered; an object by its own set fields. */
function setValue({ value }: { value: Json | undefined }): string | undefined {
  if (value === true) {
    return "true";
  }
  if (typeof value === "number" && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? `${String(value.length)} item(s)` : undefined;
  }
  if (!isBag(value)) {
    return undefined;
  }
  const set = Object.entries(value).flatMap(([key, inner]) => {
    const shown = isBag(inner) ? undefined : setValue({ value: inner });
    return shown === undefined ? [] : [`${key} ${shown}`];
  });
  return set.length === 0 ? undefined : set.join(", ");
}

/** The entries of the list at a path, stepping into every entry of a list at each `[].`. */
function listAt({ answer, path }: { answer: Bag; path: string }): readonly Json[] {
  const step = path.indexOf("[].");
  const value = valueAt({ answer, path: step < 0 ? path : path.slice(0, step) });
  const entries: readonly Json[] = Array.isArray(value) ? value : [];
  if (step < 0) {
    return entries;
  }
  const inner = path.slice(step + "[].".length);
  return entries.flatMap((entry) => (isBag(entry) ? listAt({ answer: entry, path: inner }) : []));
}

/** The sentence one list entry says: the entry itself, or its `says` field. */
function sentenceOf({ entry, says }: { entry: Json; says: string | undefined }): string | undefined {
  const value = says === undefined ? entry : valueAt({ answer: isBag(entry) ? entry : {}, path: says });
  return typeof value === "string" ? value : undefined;
}

/**
 * What one probe finds in an answer.
 *
 * @returns the cut as `path: value`, or `undefined` when the answer does not mark it
 */
export function probed({ answer, probe }: { answer: Bag; probe: CutProbe }): string | undefined {
  if ("set" in probe) {
    const shown = setValue({ value: valueAt({ answer, path: probe.set }) });
    return shown === undefined ? undefined : `${probe.set}: ${shown}`;
  }
  if ("at" in probe) {
    const value = valueAt({ answer, path: probe.at });
    const hit = probe.is.findIndex((wanted) => wanted === value);
    return hit === -1 ? undefined : `${probe.at}: ${String(probe.is[hit])}`;
  }
  if ("anyOf" in probe) {
    const value = valueAt({ answer, path: probe.anyOf });
    const keys = isBag(value) ? Object.keys(value).filter((key) => value[key] === probe.is) : [];
    return keys.length === 0 ? undefined : `${probe.anyOf}: ${probe.is} for ${keys.join(", ")}`;
  }
  return counted({ answer, probe });
}

/** What a list probe finds: how many of its entries carry the cut. */
function counted({ answer, probe }: { answer: Bag; probe: Extract<CutProbe, { each: string }> }): string | undefined {
  const entries = listAt({ answer, path: probe.each });
  let hits: readonly Json[];
  let label: string;
  if ("endsWith" in probe) {
    hits = entries.filter((entry) => typeof entry === "string" && entry.endsWith(probe.endsWith));
    label = `cut, ending "${probe.endsWith.trim()}"`;
  } else if ("unless" in probe) {
    const losses = entries.flatMap((entry) => {
      const sentence = sentenceOf({ entry, says: probe.says });
      const standing = sentence === undefined || probe.unless.some((phrase) => sentence.includes(phrase));
      return standing ? [] : [sentence];
    });
    return losses.length === 0 ? undefined : `${probe.each}: ${losses.join("; ")}`;
  } else {
    const wanted = probe.is;
    hits = entries.filter((entry) => {
      const value = valueAt({ answer: isBag(entry) ? entry : {}, path: probe.field });
      return wanted === undefined ? setValue({ value }) !== undefined : value === wanted;
    });
    label = wanted === undefined ? probe.field : `${probe.field} ${String(wanted)}`;
  }
  return hits.length === 0 ? undefined : `${probe.each}[]: ${String(hits.length)} ${label}`;
}
