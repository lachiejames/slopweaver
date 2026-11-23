/**
 * Which arm of a union a provider meant, when no arm matched — so `./boundary.ts` names the field that drifted
 * rather than a field of an arm nobody sent.
 *
 * Zod answers a failed union with one `Invalid input` at the union's own path and every arm's issues beneath it.
 * This does not rank those arms, because no ranking survived review: eight adversarial passes each found one
 * naming a wrong arm on an ordinary provider shape. It reads the one arm that did not refuse the value outright,
 * and a boundary is only allowed a union where that arm is unambiguous — at most one object or array arm
 * (`./boundaryUnion.ts`), since a scalar arm refuses an object whole, and a `z.discriminatedUnion` whose tag Zod
 * reads itself.
 */
import type { z } from "zod";

import { isRecord } from "./parsers.js";

/** The value at a path, or undefined when the path leaves the value. */
function valueAt({ value, path }: { value: unknown; path: readonly PropertyKey[] }): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
    } else if (isRecord(current) && typeof segment === "string") {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Whether the issue's own key is absent from its parent — a declared field the provider did not send.
 *
 * @param path the issue's path from the root of `value`
 * @returns true when the parent is an object that does not carry the key
 */
export function isAbsent({ value, path }: { value: unknown; path: readonly PropertyKey[] }): boolean {
  const key = path.at(-1);
  if (key === undefined) {
    return false;
  }
  const parent = valueAt({ path: path.slice(0, -1), value });
  return isRecord(parent) && typeof key === "string" && !Object.hasOwn(parent, key);
}

/**
 * A raw path as a comparison key — unlike the text a reader sees, which `{"a.b":1}` and `{a:{b:1}}` share.
 *
 * @returns the path's segments as a JSON array of strings
 */
export function pathKey({ path }: { path: readonly PropertyKey[] }): string {
  return JSON.stringify(path.map(String));
}

/** Issue codes that, anywhere at an arm's own root, say the value was never what that arm reads. */
const WHOLE_REFUSALS: ReadonlySet<string> = new Set(["invalid_type", "invalid_union", "invalid_value"]);

/**
 * Whether an arm refused the value outright — a string arm handed an object, a literal arm another value. Any
 * such issue at the arm's root settles it, whatever else sits beside it: Zod still runs a length check after
 * the type check failed, so `z.string().min(1)` handed an array raises a `too_small` beside its `invalid_type`
 *. An object or list arm handed an object or list of its own kind never raises one at its
 * root; a checked scalar arm may (`z.number().int()` handed 1.5), and is then dropped like any other, so a
 * union of such arms keeps its own issue rather than reading one.
 */
function refusesWhole({ issues }: { issues: readonly z.core.$ZodIssue[] }): boolean {
  return issues.some((issue) => issue.path.length === 0 && WHOLE_REFUSALS.has(issue.code));
}

/**
 * A union no arm matched raises one `Invalid input` at the union's own path, naming no field. Read instead the
 * issues of the ONE arm that did not refuse the value outright, re-rooted at the union — Zod reports an arm's
 * issues relative to it — and keep the union's own issue when every arm refused it whole or more than one did
 * not. Each arm is read this way first, so an arm that is itself a union is judged by what it meant.
 *
 * @param issues what Zod raised
 * @returns every issue with each failed union replaced by its one meant arm's issues where there is one
 */
export function meantArmIssues({ issues }: { issues: readonly z.core.$ZodIssue[] }): readonly z.core.$ZodIssue[] {
  return issues.flatMap((issue) => {
    if (issue.code !== "invalid_union") {
      return [issue];
    }
    const meant = issue.errors
      .map((arm) => meantArmIssues({ issues: arm }))
      .filter((arm) => !refusesWhole({ issues: arm }));
    const [only, ...others] = meant;
    if (only === undefined || others.length > 0) {
      return [issue];
    }
    return only.map((inner) => ({ ...inner, path: [...issue.path, ...inner.path] }));
  });
}
