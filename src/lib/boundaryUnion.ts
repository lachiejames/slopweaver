/**
 * Which plain unions a boundary can explain a refusal from — `./boundaryWalk.ts` refuses the rest at definition.
 *
 * When no arm of a `z.union` matches, Zod reports every arm's issues, and a refusal must say which arm the
 * provider meant. With at most ONE arm reading objects (an object, record or discriminated union) and one reading
 * lists (an array or tuple) beside scalars, that is never a guess: every other arm refuses the value whole, so it
 * was meant for the one arm of its kind (`./boundaryArms.ts`). With two of a kind it always is a guess, and eight
 * adversarial review passes each found a ranking naming a field of an arm nobody sent — through
 * a tag, a subtree one arm rejected whole, a key another arm took unchecked under `z.unknown()`, and Zod itself
 * answering with one arm's issues before any ranking ran. So a plain union with two arms of a kind is refused: a
 * `z.discriminatedUnion` reads the arm its tag names, and arms no field tells apart are one strict object whose
 * differing keys are optional. A discriminated union is only as good as its tag, so one whose tag an arm may omit
 * or answer null, or with `unionFallback`, is refused as well.
 */
import type { z } from "zod";

import { builtDiscriminated, isRelabelled } from "./boundaryTraits.js";

/** Whether a schema is one of Zod's own types, whose def names its kind — what lets a walk switch on it. */
function isZodTypes(schema: z.core.$ZodType): schema is z.core.$ZodTypes {
  return typeof schema._zod.def.type === "string";
}

/**
 * The def of a schema, read the way Zod documents for library authors — and only when the class that built the
 * schema agrees with its `type`, since a `type` param overwrites that label (`./boundaryTraits.ts`).
 *
 * @returns the def, one variant per Zod type, discriminated by `type`
 */
export function defOf({ schema }: { schema: z.core.$ZodType }): z.core.$ZodTypes["_zod"]["def"] {
  if (!isZodTypes(schema)) {
    throw new Error("defineBoundary: a schema that is not one of Zod's own types, which the walk cannot read");
  }
  if (isRelabelled({ schema })) {
    throw new Error(
      `defineBoundary: a schema labelled z.${schema._zod.def.type} that Zod built as another type — a type param overwrote its def, so the walk would read the wrong schema`,
    );
  }
  return schema._zod.def;
}

/**
 * The def of a union Zod built to read its tag. A `discriminator` param on a plain `z.union` lands on its def and
 * leaves it a plain union at runtime, so the def alone never says (`./boundaryTraits.ts`).
 *
 * @returns the discriminated union's def; undefined for any other schema
 */
export function discriminatedDef({
  schema,
}: {
  schema: z.core.$ZodType;
}): z.core.$ZodDiscriminatedUnionDef | undefined {
  const def = defOf({ schema });
  return def.type === "union" && builtDiscriminated({ schema }) && isDiscriminated(def) ? def : undefined;
}

/** Wrappers that change nothing about which arm a value belongs to. */
const TRANSPARENT: ReadonlySet<string> = new Set(["default", "nonoptional", "nullable", "optional", "readonly"]);

/**
 * The value each structured kind reads: arms reading the same one compete for a value, arms reading different
 * ones never do — an object arm refuses a list whole, so an object-or-list union is not a guess.
 */
const READS: ReadonlyMap<string, string> = new Map([
  ["array", "array"],
  ["map", "map"],
  ["object", "object"],
  ["record", "object"],
  ["set", "set"],
  ["tuple", "array"],
  ["union", "object"],
]);

/** What each structured arm a union option adds reads, a nested plain union counted by its own arms. */
function structuredReads({ schema }: { schema: z.core.$ZodType }): readonly string[] {
  const def = defOf({ schema });
  if (TRANSPARENT.has(def.type) && "innerType" in def) {
    return structuredReads({ schema: def.innerType });
  }
  if (def.type === "union" && discriminatedDef({ schema }) === undefined) {
    return def.options.flatMap((option) => structuredReads({ schema: option }));
  }
  const reads = READS.get(def.type);
  return reads === undefined ? [] : [reads];
}

/**
 * The refusal for a plain union two of whose arms read the same kind of structured value, however wrapped or
 * nested.
 *
 * @param at where the union sits, for the report
 * @param options the union's arms
 * @returns one line per kind a failed read could not say which arm was meant for; empty otherwise
 */
export function untellableUnionRefusals({
  at,
  options,
}: {
  at: string;
  options: readonly z.core.$ZodType[];
}): readonly string[] {
  const reads = options.flatMap((option) => structuredReads({ schema: option }));
  return [...new Set(reads)].flatMap((kind) => {
    const count = reads.filter((read) => read === kind).length;
    return count < 2
      ? []
      : [
          `${at} is a z.union with ${String(count)} arms that read ${kind}s, so a refusal could not say which one was sent — spell it z.discriminatedUnion on the field that tells them apart, or one z.strictObject whose differing keys are optional`,
        ];
  });
}

/**
 * The refusal for a discriminated union whose tag could still name an arm nobody sent. An arm whose tag may be
 * omitted — optional or defaulted — claims a missing tag, so another arm's value with its tag dropped or renamed
 * reads as that arm and the refusal names its fields; Zod records the claim as `undefined`
 * among the arm's tag values, which is what is read here. A nullable tag claims `null`, the way JSON often spells
 * a missing tag, and is refused the same way, as is an arm whose wrapper hides its tag values from Zod,
 * which then throws on every read, a nested arm that lacks the tag, and a tag value two arms share, and
 * a nest on another field whose arms answer different values of this tag.
 * `unionFallback` answers an unmatched tag as a plain union of the arms, the guess the rule above refuses.
 *
 * @param discriminator the field whose value names the arm
 * @param unionFallback the union's own flag, set when an unmatched tag falls back to trying every arm
 * @returns one line per way the tag could name the wrong arm; empty otherwise
 */
export function untellableTagRefusals({
  at,
  discriminator,
  options,
  unionFallback,
}: {
  at: string;
  discriminator: string;
  options: readonly z.core.$ZodType[];
  unionFallback: boolean | undefined;
}): readonly string[] {
  const fallback =
    unionFallback === true
      ? [`${at} is a z.discriminatedUnion with unionFallback, which reads an unmatched tag as a guess between arms`]
      : [];
  const leaves = tagArms({ options, prefix: "" }).flatMap(({ name, schema }) =>
    armTagRefusals({ at, discriminator, name, schema }),
  );
  return [
    ...fallback,
    ...sharedTagRefusals({ at, discriminator, options }),
    ...leaves,
    ...crossTagRefusals({ at, discriminator, options, prefix: "" }),
  ];
}

/** Whether a union's def names a discriminator, which Zod's own def union does not tell apart by `type`. */
function isDiscriminated(def: z.core.$ZodUnionDef): def is z.core.$ZodDiscriminatedUnionDef {
  return "discriminator" in def && typeof def.discriminator === "string";
}

/**
 * The discriminated union an arm is, looked through `.readonly()` — the one wrapper that hands Zod the inner
 * union's tag values unchanged, so it hid a nested arm's missing tag as well as a bare nest did.
 */
function nestedUnion({ schema }: { schema: z.core.$ZodType }): z.core.$ZodDiscriminatedUnionDef | undefined {
  const def = defOf({ schema });
  if (def.type === "readonly") {
    return nestedUnion({ schema: def.innerType });
  }
  return discriminatedDef({ schema });
}

/**
 * A discriminated union's arms, each named by its index path, an arm that is itself a discriminated union read as
 * its own arms: Zod merges a nested union's tag values, so one inner arm carrying the outer tag hid a sibling that
 * did not, which no value could ever reach.
 */
function tagArms({
  options,
  prefix,
}: {
  options: readonly z.core.$ZodType[];
  prefix: string;
}): readonly { name: string; schema: z.core.$ZodType }[] {
  return options.flatMap((option, index) => {
    const name = `${prefix}${String(index)}`;
    const nested = nestedUnion({ schema: option });
    return nested === undefined ? [{ name, schema: option }] : tagArms({ options: nested.options, prefix: `${name}.` });
  });
}

/**
 * The refusal for a nested discriminated union on ANOTHER field whose arms answer different values of this tag:
 * Zod routes a value into the nest by this tag and then picks its arm by the nest's own, so a drifted inner tag
 * reads the value as an arm of a different outer tag and names that arm's fields.
 */
function crossTagRefusals({
  at,
  discriminator,
  options,
  prefix,
}: {
  at: string;
  discriminator: string;
  options: readonly z.core.$ZodType[];
  prefix: string;
}): readonly string[] {
  return options.flatMap((option, index) => {
    const name = `${prefix}${String(index)}`;
    const nested = nestedUnion({ schema: option });
    if (nested === undefined) {
      return [];
    }
    const deeper = crossTagRefusals({ at, discriminator, options: nested.options, prefix: `${name}.` });
    const answers = new Set(
      tagArms({ options: nested.options, prefix: "" }).flatMap(({ schema }) => tagAnswer({ discriminator, schema })),
    );
    return nested.discriminator !== discriminator && answers.size > 1
      ? [
          `${at} arm ${name} is a z.discriminatedUnion on "${nested.discriminator}" whose arms answer different values of "${discriminator}", so a drifted "${nested.discriminator}" reads as an arm of another "${discriminator}" — give every arm under it one "${discriminator}", or spell its arms flat`,
          ...deeper,
        ]
      : deeper;
  });
}

/** The values an arm answers for a tag, as one comparable string — none for an arm without it, refused elsewhere. */
function tagAnswer({ discriminator, schema }: { discriminator: string; schema: z.core.$ZodType }): readonly string[] {
  const values = schema._zod.propValues?.[discriminator];
  return values === undefined
    ? []
    : [
        [...values]
          .map((value) => `${typeof value}:${String(value)}`)
          .toSorted()
          .join("|"),
      ];
}

/** The refusal for one arm whose tag Zod cannot read, or which claims a missing or null tag. */
function armTagRefusals({
  at,
  discriminator,
  name,
  schema,
}: {
  at: string;
  discriminator: string;
  name: string;
  schema: z.core.$ZodType;
}): readonly string[] {
  const values = schema._zod.propValues?.[discriminator];
  if (values === undefined) {
    return [
      `${at} arm ${name} declares no tag "${discriminator}" Zod can read, so every read throws — wrap the whole union, never one arm`,
    ];
  }
  return values.has(undefined) || values.has(null)
    ? [
        `${at} arm ${name} may omit its tag "${discriminator}" or answer it null, so a value whose tag was dropped, nulled or renamed reads as that arm — make the tag a required literal on every arm, or spell one z.strictObject whose differing keys are optional`,
      ]
    : [];
}

/** The refusal for a tag value two arms claim, which Zod throws on at the first read rather than at definition. */
function sharedTagRefusals({
  at,
  discriminator,
  options,
}: {
  at: string;
  discriminator: string;
  options: readonly z.core.$ZodType[];
}): readonly string[] {
  const claimed = options.flatMap((option) => {
    const values = option._zod.propValues?.[discriminator];
    return values === undefined ? [] : [...values];
  });
  const shared = new Set(claimed.filter((value, index) => claimed.indexOf(value) !== index));
  return [...shared].map(
    (value) =>
      `${at} gives the tag "${discriminator}" the value ${String(value)} on more than one arm, which Zod throws on at the first read — give each arm its own`,
  );
}
