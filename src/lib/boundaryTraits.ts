/**
 * Whether a schema or check is what its def says it is. Zod copies a params object onto a def LAST, so a param
 * named `type` or `check` overwrites the label the walk reads, while what runs is chosen by the class that built
 * it: `z.object(shape, { type: "string" })` walked as a string leaf and dropped every new key, and a
 * `.superRefine` labelled `check: "min_length"` passed as a bound. Every class records its name
 * in `_zod.traits`, which no param reaches, so a label is believed only when the matching trait is there.
 */
import type { z } from "zod";

/** The trait each schema `type` the walk knows is built with. */
const TYPE_TRAITS: ReadonlyMap<string, string> = new Map([
  ["any", "$ZodAny"],
  ["array", "$ZodArray"],
  ["bigint", "$ZodBigInt"],
  ["boolean", "$ZodBoolean"],
  ["catch", "$ZodCatch"],
  ["custom", "$ZodCustom"],
  ["date", "$ZodDate"],
  ["default", "$ZodDefault"],
  ["enum", "$ZodEnum"],
  ["file", "$ZodFile"],
  ["function", "$ZodFunction"],
  ["intersection", "$ZodIntersection"],
  ["lazy", "$ZodLazy"],
  ["literal", "$ZodLiteral"],
  ["map", "$ZodMap"],
  ["nan", "$ZodNaN"],
  ["never", "$ZodNever"],
  ["nonoptional", "$ZodNonOptional"],
  ["null", "$ZodNull"],
  ["nullable", "$ZodNullable"],
  ["number", "$ZodNumber"],
  ["object", "$ZodObject"],
  ["optional", "$ZodOptional"],
  ["pipe", "$ZodPipe"],
  ["prefault", "$ZodPrefault"],
  ["promise", "$ZodPromise"],
  ["readonly", "$ZodReadonly"],
  ["record", "$ZodRecord"],
  ["set", "$ZodSet"],
  ["string", "$ZodString"],
  ["success", "$ZodSuccess"],
  ["symbol", "$ZodSymbol"],
  ["template_literal", "$ZodTemplateLiteral"],
  ["transform", "$ZodTransform"],
  ["tuple", "$ZodTuple"],
  ["undefined", "$ZodUndefined"],
  ["union", "$ZodUnion"],
  ["unknown", "$ZodUnknown"],
  ["void", "$ZodVoid"],
]);

/**
 * The traits each bound a boundary allows may be built with — the allowlist `./boundaryChecks.ts` reads, so a check
 * kind Zod adds later, or a label on a check built as something else, is refused. `startsWith`, `includes` and
 * `endsWith` are `string_format` checks built by classes of their own.
 */
const BOUND_TRAITS: ReadonlyMap<string, readonly string[]> = new Map([
  ["bigint_format", ["$ZodCheckBigIntFormat"]],
  ["greater_than", ["$ZodCheckGreaterThan"]],
  ["length_equals", ["$ZodCheckLengthEquals"]],
  ["less_than", ["$ZodCheckLessThan"]],
  ["max_length", ["$ZodCheckMaxLength"]],
  ["max_size", ["$ZodCheckMaxSize"]],
  ["min_length", ["$ZodCheckMinLength"]],
  ["min_size", ["$ZodCheckMinSize"]],
  ["multiple_of", ["$ZodCheckMultipleOf"]],
  ["number_format", ["$ZodCheckNumberFormat"]],
  ["size_equals", ["$ZodCheckSizeEquals"]],
  ["string_format", ["$ZodCheckStringFormat", "$ZodCheckStartsWith", "$ZodCheckIncludes", "$ZodCheckEndsWith"]],
]);

/**
 * Whether Zod's internals record a trait. Every Zod class records one, a check included, though a check's type
 * does not declare the set.
 */
function hasTrait({ internals, trait }: { internals: object; trait: string }): boolean {
  return "traits" in internals && internals.traits instanceof Set && internals.traits.has(trait);
}

/**
 * Whether a schema's def names a type the walk knows that its class did not build — a `type` param overwrote it. A
 * type the walk does not know is not relabelled; the walk refuses it as unknown.
 *
 * @returns true when the def's `type` and the class that built the schema disagree
 */
export function isRelabelled({ schema }: { schema: z.core.$ZodType }): boolean {
  const trait = TYPE_TRAITS.get(schema._zod.def.type);
  return trait !== undefined && !hasTrait({ internals: schema._zod, trait });
}

/**
 * Whether a check is a plain bound, built by the class its def's `check` names.
 *
 * @returns false for any other kind of check, and for a check relabelled as a bound
 */
export function isBuiltBound({ check }: { check: z.core.$ZodCheck }): boolean {
  const traits = BOUND_TRAITS.get(check._zod.def.check);
  return traits?.some((trait) => hasTrait({ internals: check._zod, trait })) === true;
}

/**
 * Whether an `optional` was built by `.exactOptional()`, which Zod labels and traits as an optional but which runs
 * its inner schema on an absent value.
 *
 * @returns true only for an optional Zod built as exact
 */
export function builtExactOptional({ schema }: { schema: z.core.$ZodType }): boolean {
  return hasTrait({ internals: schema._zod, trait: "$ZodExactOptional" });
}

/**
 * Whether a union was built by `z.xor`, which Zod labels and traits as a union but which fails when two arms match
 * — an absent key two optional arms both accept included.
 *
 * @returns true only for a union Zod built as exclusive
 */
export function builtXor({ schema }: { schema: z.core.$ZodType }): boolean {
  return hasTrait({ internals: schema._zod, trait: "$ZodXor" });
}

/**
 * Whether a union was built as a discriminated union — a `discriminator` param on a plain `z.union` lands on its
 * def but leaves it a plain union at runtime.
 *
 * @returns true only for a union Zod built to read its tag
 */
export function builtDiscriminated({ schema }: { schema: z.core.$ZodType }): boolean {
  return hasTrait({ internals: schema._zod, trait: "$ZodDiscriminatedUnion" });
}
