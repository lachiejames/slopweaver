/**
 * Which checks a boundary schema may carry — `./boundaryWalk.ts` refuses the rest at definition, whatever the
 * schema's type. A check either bounds the value it is given, or it runs something the walk never sees: code
 * that can drop the issues a strict object raised, a rewrite of the value, or a whole schema under `z.property`.
 * A plain bound given its own `when` predicate, and any schema or check given an `error` map, runs code too: Zod
 * hands both the live payload or issue, so either can clear the issues or move one onto a field that did not
 * drift. So does a format schema's own `when` — `z.int()` and `z.email()` are their own check —
 * and Zod's default `when` handed to a bound of another kind, which then never runs. A bound sits only on
 * the type it measures, since Zod runs it on whatever the schema answered.
 */
import { z } from "zod";

import { isBuiltBound } from "./boundaryTraits.js";

/** Zod's own `when` on a length bound, which only asks whether the value has a length; Zod does not export it. */
const LENGTH_WHEN: unknown = z.minLength(0)._zod.def.when;

/** Zod's own `when` on a size bound, which only asks whether the value has a size. */
const SIZE_WHEN: unknown = z.minSize(0)._zod.def.when;

/** The `when` Zod installs on each bound kind that has one — any other `when`, or this one on another kind, is code. */
const ZOD_WHENS: ReadonlyMap<string, unknown> = new Map([
  ["length_equals", LENGTH_WHEN],
  ["max_length", LENGTH_WHEN],
  ["max_size", SIZE_WHEN],
  ["min_length", LENGTH_WHEN],
  ["min_size", SIZE_WHEN],
  ["size_equals", SIZE_WHEN],
]);

/** Whether a check's def carries a `when` Zod did not install for that kind of check. */
function hasOwnWhen({ check }: { check: z.core.$ZodCheckDef }): boolean {
  return check.when !== undefined && ZOD_WHENS.get(check.check) !== check.when;
}

/** The refusal for a schema or check carrying code Zod hands the live payload or issue. */
function hookRefusals({ at, def }: { at: string; def: z.core.$ZodTypes["_zod"]["def"] }): readonly string[] {
  if (def.error !== undefined) {
    return [`${at} carries an error map, which Zod hands the issue to rewrite — name the drift from the refusal`];
  }
  // A format schema is its own check, and Zod installs no `when` on one, so any `when` it carries is code.
  if ("when" in def && def.when !== undefined) {
    return [`${at} is a format with its own when, which Zod hands the payload — check after the read`];
  }
  const hooked = def.checks?.find(({ _zod: { def: check } }) => check.error !== undefined || hasOwnWhen({ check }));
  return hooked === undefined
    ? []
    : [
        `${at} carries a ${hooked._zod.def.check} check with its own when or error, which Zod hands the payload to rewrite — check after the read`,
      ];
}

/**
 * A refusal that holds whatever the schema's type: coercion, an `.overwrite()` check that rewrites the value,
 * a custom check (`.refine`, `.superRefine`, `.check`), which runs arbitrary code over the issues a strict
 * object raised and can drop them — a domain rule runs after the read, like a transform — and any other check
 * that is not a plain bound. The bounds are an ALLOWLIST checked against the class that built each check
 * (`./boundaryTraits.ts`): a `z.property` check runs a whole schema the walk never reached,
 * and a custom check given a `check` param reads as a bound by its label alone.
 *
 * @param at where the schema sits, for the report
 * @param def the schema's def, whose checks are read
 * @returns one line naming the first refused check or coercion; empty when there is none
 */
export function rewritesTheValue({ at, def }: { at: string; def: z.core.$ZodTypes["_zod"]["def"] }): readonly string[] {
  const hooks = hookRefusals({ at, def });
  if (hooks.length > 0) {
    return hooks;
  }
  if ("coerce" in def && def.coerce === true) {
    return [`${at} is z.coerce, which reads a retyped field as a converted value`];
  }
  if (def.checks?.some((check) => check._zod.def.check === "overwrite") === true) {
    return [`${at} carries .overwrite(), which rewrites the value before a later check reads it`];
  }
  if (def.checks?.some((check) => check._zod.def.check === "custom") === true) {
    return [`${at} carries a custom check, which can drop the issues a strict object raised — check after the read`];
  }
  const unwalked = def.checks?.find((check) => !isBuiltBound({ check }));
  return unwalked === undefined
    ? misplacedBounds({ at, def })
    : [
        `${at} carries a ${unwalked._zod.def.check} check that is not a bound Zod built, so the walk never sees what it runs — check after the read`,
      ];
}

/** The bounds each type may carry: the ones that measure the value that type itself read. */
const TYPE_BOUNDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["array", ["length_equals", "max_length", "min_length"]],
  ["bigint", ["bigint_format", "greater_than", "less_than", "multiple_of"]],
  ["date", ["greater_than", "less_than"]],
  ["map", ["max_size", "min_size", "size_equals"]],
  ["number", ["greater_than", "less_than", "multiple_of", "number_format"]],
  ["set", ["max_size", "min_size", "size_equals"]],
  ["string", ["length_equals", "max_length", "min_length", "string_format"]],
]);

/**
 * The refusal for a bound on a type it does not measure. Zod runs a schema's checks on whatever the schema
 * answered, so a bound on `.optional()`, `.default()`, `.nullable()` or a union holding one runs on an absent key,
 * a default or null, and a length or size bound on an object reads a field of that
 * name — each refusing a field that did not drift.
 */
function misplacedBounds({ at, def }: { at: string; def: z.core.$ZodTypes["_zod"]["def"] }): readonly string[] {
  const allowed = TYPE_BOUNDS.get(def.type);
  const misplaced = def.checks?.find((check) => allowed?.includes(check._zod.def.check) !== true);
  return misplaced === undefined
    ? []
    : [
        `${at} carries a ${misplaced._zod.def.check} bound on z.${def.type}, which Zod runs on whatever that answers — an absent key, a default, null or a field of that name — so it names a field that did not drift; bound the value it measures`,
      ];
}
