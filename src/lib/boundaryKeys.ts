/**
 * Which keys a boundary may declare — `./boundaryWalk.ts` refuses the rest at definition, because a refusal over
 * any of them would name a field that did not drift.
 *
 * Zod reads a declared key as `input[key]`, so a key named like an `Object.prototype` member reads the inherited
 * member when the provider did not send it, and `__proto__` is skipped outright. And a record's
 * number key reaches an issue's path as a number, which the refusal cannot tell from a list index.
 */
import type { z } from "zod";

import { defOf } from "./boundaryUnion.js";

/**
 * The refusal for each declared key named like an `Object.prototype` member: an absent optional `toString`
 * reads as the inherited function and is refused as missing on an answer that never drifted, and a declared
 * `__proto__` is never read at all. A provider sending one is read under `z.record(z.string(), …)`, whose keys
 * Zod takes from the answer itself.
 *
 * @param at where the object or record sits, for the report
 * @param keys the keys it declares
 * @returns one line per such key; empty otherwise
 */
export function prototypeKeys({ at, keys }: { at: string; keys: Iterable<unknown> }): readonly string[] {
  return [...keys].flatMap((key) => {
    if (typeof key === "symbol") {
      return [`${at} declares ${String(key)}, a symbol key no JSON answer carries, so every read names it`];
    }
    return typeof key === "string" && key in Object.prototype
      ? [
          `${at} declares "${key}", named like an Object.prototype member, which Zod reads through the prototype when it is absent — read it under z.record(z.string(), …)`,
        ]
      : [];
  });
}

/**
 * The refusal for a record's key schema: every key must read as a string — a string, a template literal, or an
 * enum or literal whose every value is a string — and none of a fixed key set may be named like an
 * `Object.prototype` member.
 *
 * @param at where the record sits, for the report
 * @param keyType the record's key schema
 * @returns one line per refused key or key schema; empty otherwise
 */
export function recordKeyRefusals({ at, keyType }: { at: string; keyType: z.core.$ZodType }): readonly string[] {
  const values = keyType._zod.values;
  if (values === undefined) {
    const kind = defOf({ schema: keyType }).type;
    return kind === "string" || kind === "template_literal" ? [] : [nonStringRefusal({ at })];
  }
  const strings = [...values].every((value) => typeof value === "string");
  return strings ? prototypeKeys({ at, keys: values }) : [nonStringRefusal({ at })];
}

/**
 * The path of every own `__proto__` key in a parsed answer. `JSON.parse` makes one an OWN key, and Zod's record
 * skips it outright, so a drifted value under it read as success. No boundary can declare
 * one ({@link prototypeKeys}), so each is a new field wherever it sits — under an unread key too.
 *
 * @param value the parsed answer, or a value inside it
 * @param path where that value sits in the answer
 * @returns one path per own `__proto__` key, outermost first
 */
export function ownProtoPaths({
  path,
  value,
}: {
  path: readonly PropertyKey[];
  value: unknown;
}): readonly (readonly PropertyKey[])[] {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.flatMap((item, index) => ownProtoPaths({ path: [...path, index], value: item }));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const own = Object.hasOwn(value, "__proto__") ? [[...path, "__proto__"]] : [];
  return [
    ...own,
    ...Object.entries(value).flatMap(([key, item]) => ownProtoPaths({ path: [...path, key], value: item })),
  ];
}

/** The line for a record keyed by other than strings. */
function nonStringRefusal({ at }: { at: string }): string {
  return `${at} is a record keyed by other than strings, whose keys a refusal would print as list indexes`;
}
