/**
 * The walk `./boundary.ts`'s `defineBoundary` runs over a schema ONCE, when the module declaring it loads: every
 * place under it that could read drift as success, so a loose schema is a programmer error surfaced by the
 * first test that imports the module, never a verb that quietly tolerates drift.
 *
 * Every object reachable must be a `z.strictObject`. `z.lazy` is refused outright: it cannot be walked without
 * evaluating it, and a boundary is not recursive enough to need one. `.catch()` is refused too: it answers its
 * fallback for ANY failure beneath it, an unknown key included, so a strict object under one reads drift as the
 * fallback at exit 0. `.default()` stays legal — it fills an ABSENT value only, which is a declared optional
 * rather than a hidden failure — but `.prefault()` does not: it PARSES its fallback, so a value never sent is
 * refused by fields inside it. The rest of what the walk refuses, each because it reads drift as success or
 * names the wrong field: every intersection (Zod reports an unknown key only when BOTH sides reject it, so a
 * record side silences a strict one, and two strict sides refuse each other's nested keys — `.extend()` spells
 * the same shape as one strict object), a union with an arm accepting any keys however it is wrapped or
 * contained, a plain union with two arms reading objects or two reading lists, and a discriminated union whose
 * tag an arm may omit or answer null or with `unionFallback`, each of whose failed reads could not say which arm
 * was sent (`./boundaryUnion.ts`), a record keyed by other than strings and a key named like an
 * `Object.prototype` member (`./boundaryKeys.ts`), `z.success` (it answers a boolean in place of the value),
 * EVERY pipe and
 * `.transform()` (`z.unknown().transform(fn)` checks nothing and lets `fn` read the answer however it likes,
 * and `z.preprocess`, `z.codec` and `.pipe()` validate what a step made — so a boundary validates, and the
 * domain maps the parsed value after the read), `z.coerce`, any check but a plain bound (`.refine` and
 * `.superRefine` run arbitrary code over the issues and can drop them, and `z.property` runs a schema the walk
 * never sees — `./boundaryChecks.ts`), an error map or any `when` Zod did not install (Zod hands either the live
 * issue or payload), a bound on a type it does not measure (Zod runs one on a wrapper or union on a default, an
 * absent key or null, and one on an object on a field of its name), `.exactOptional()`
 * (it runs its inner schema on an absent key), `z.xor` (it fails when two arms match), `z.undefined`,
 * `z.void` and a literal allowing undefined, which no JSON carries, a symbol key, `z.looseRecord`, and any leaf that
 * checks nothing (`z.any`, `z.custom`, `z.promise`). A record's key schema is walked like its value. Leaves
 * are an ALLOWLIST, so a Zod type added later is refused until someone decides it is safe. Six adversarial
 * review passes each found a shape the walk before it accepted, which is why it is this strict.
 *
 * A key present on the wire but not read is still DECLARED — its value may be `z.unknown()` — because the
 * point is that the key set is known. `z.record` stays legal: a map keyed by data (a header record, a
 * per-window table) has no fixed key set to be strict about.
 */
import type { z } from "zod";

import { rewritesTheValue } from "./boundaryChecks.js";
import { prototypeKeys, recordKeyRefusals } from "./boundaryKeys.js";
import { builtExactOptional, builtXor } from "./boundaryTraits.js";
import { defOf, discriminatedDef, untellableTagRefusals, untellableUnionRefusals } from "./boundaryUnion.js";

/** Wrappers an unread key may carry and still be one: `z.unknown().optional()` and its kin. */
const UNREAD_WRAPPERS: ReadonlySet<string> = new Set(["default", "nonoptional", "nullable", "optional", "readonly"]);

/**
 * Whether an object field is a declared-but-unread key: `z.unknown()` under plain wrappers, no check, no error map.
 *
 * @returns `true` for a field this boundary declares and never reads
 */
export function isUnreadKey({ schema }: { schema: z.core.$ZodType }): boolean {
  const def = defOf({ schema });
  if ((def.checks !== undefined && def.checks.length > 0) || def.error !== undefined) {
    return false;
  }
  if (def.type === "unknown") {
    return true;
  }
  return UNREAD_WRAPPERS.has(def.type) && "innerType" in def && isUnreadKey({ schema: def.innerType });
}

/** A schema's def, one variant per Zod type, discriminated by `type`. */
type Def = z.core.$ZodTypes["_zod"]["def"];

/** A leaf that checks what it is given, so it can sit anywhere without hiding drift. */
const CHECKED_LEAVES = [
  "bigint",
  "boolean",
  "date",
  "enum",
  "literal",
  "nan",
  "never",
  "null",
  "number",
  "string",
  "symbol",
  "template_literal",
] as const;

/**
 * A leaf that checks nothing a boundary can read. `unknown` is legal only as an object field's value
 * ({@link isUnreadKey}), where the KEY is what is declared — anywhere else (the root, an array element, a record
 * value) it declares nothing and checks nothing.
 */
const UNCHECKED_LEAVES = ["any", "custom", "file", "function", "promise", "transform", "unknown"] as const;

/** A leaf's def, checked or not. */
type LeafDef = Extract<Def, { type: (typeof CHECKED_LEAVES | typeof UNCHECKED_LEAVES)[number] }>;

/** Whether a def is a leaf, checked or not — narrowing it out of the walk's switch over what has children. */
function isLeaf(def: Def): def is LeafDef {
  const leaves: readonly string[] = [...CHECKED_LEAVES, ...UNCHECKED_LEAVES];
  return leaves.includes(def.type);
}

/**
 * A leaf: legal when it checks what it is given, and not a literal allowing `undefined`, which no JSON carries —
 * the `z.undefined` refusal spelled another way.
 */
function leafRefusals({ at, def }: { at: string; def: LeafDef }): readonly string[] {
  if (def.type === "literal" && def.values.includes(undefined)) {
    return [`${at} is a z.literal allowing undefined, which no JSON answer carries — an absent key is .optional()`];
  }
  const checked: readonly string[] = CHECKED_LEAVES;
  return checked.includes(def.type) ? [] : [`${at} is z.${def.type}, which checks nothing a boundary can read`];
}

/**
 * Whether a schema accepts any keys once its wrappers, a pipe's input, a nested union's arms and a
 * container's elements are looked through — the top-level type alone is what `z.record(...).nullable()` and
 * `z.array(z.unknown())` hid from earlier versions of this. An object FIELD declared `z.unknown()` is not
 * looked into: that is a declared-unread key, the stated trade.
 */
function acceptsAnyKeys({ schema }: { schema: z.core.$ZodType }): boolean {
  const def = defOf({ schema });
  switch (def.type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "nonoptional":
    case "readonly":
    case "success":
    case "catch":
      return acceptsAnyKeys({ schema: def.innerType });
    case "pipe":
      return acceptsAnyKeys({ schema: def.in });
    case "union":
      return def.options.some((option) => acceptsAnyKeys({ schema: option }));
    case "array":
      return acceptsAnyKeys({ schema: def.element });
    case "set":
      return acceptsAnyKeys({ schema: def.valueType });
    case "tuple":
      return [...def.items, ...(def.rest === null ? [] : [def.rest])].some((item) => acceptsAnyKeys({ schema: item }));
    case "any":
    case "custom":
    case "lazy":
    case "record":
    case "unknown":
      return true;
    case "bigint":
    case "boolean":
    case "date":
    case "enum":
    case "file":
    case "function":
    case "intersection":
    case "literal":
    case "map":
    case "nan":
    case "never":
    case "null":
    case "number":
    case "object":
    case "promise":
    case "string":
    case "symbol":
    case "template_literal":
    case "transform":
    case "undefined":
    case "void":
      return false;
    default:
      // A Zod type added after this was written: read it as accepting anything until someone decides otherwise.
      return true;
  }
}

/**
 * A union: every arm walked, and refused outright when any arm accepts any keys, however it is wrapped. A plain
 * union with two arms reading objects, or two reading lists, is refused too (`./boundaryUnion.ts`): when no arm
 * matches, only a discriminated union can say which of them was sent.
 */
function looseInUnion({
  at,
  def,
  schema,
}: {
  at: string;
  def: Extract<Def, { type: "union" }>;
  schema: z.core.$ZodType;
}): readonly string[] {
  const { options } = def;
  if (builtXor({ schema })) {
    return [
      `${at} is z.xor, which fails when two arms match — an absent key two optional arms accept included — so it names a field never sent; spell z.union`,
    ];
  }
  if (options.some((option) => acceptsAnyKeys({ schema: option }))) {
    return [`${at} is a union with an arm accepting any keys, which reads every other arm's drift as that arm`];
  }
  const tagged = discriminatedDef({ schema });
  const untellable =
    tagged === undefined
      ? untellableUnionRefusals({ at, options })
      : untellableTagRefusals({
          at,
          discriminator: tagged.discriminator,
          options,
          unionFallback: tagged.unionFallback,
        });
  return [...untellable, ...options.flatMap((option) => looseObjectsIn({ at, schema: option }))];
}

/** A record: strict mode only, keyed by strings (`./boundaryKeys.ts`), and its key and value schemas walked. */
function looseInRecord({ at, def }: { at: string; def: Extract<Def, { type: "record" }> }): readonly string[] {
  if (def.mode === "loose") {
    return [`${at} is z.looseRecord, which passes a key its key schema does not match unchecked`];
  }
  return [
    ...recordKeyRefusals({ at, keyType: def.keyType }),
    ...looseObjectsIn({ at: `${at}{key}`, schema: def.keyType }),
    ...looseObjectsIn({ at: `${at}{}`, schema: def.valueType }),
  ];
}

/** An object: strict only when its catchall is `never`, and every field walked but a declared-unread key. */
function looseInObject({
  at,
  catchall,
  shape,
}: {
  at: string;
  catchall: z.core.$ZodType | undefined;
  shape: Readonly<Record<string, z.core.$ZodType>>;
}): readonly string[] {
  const kind = catchall === undefined ? undefined : defOf({ schema: catchall }).type;
  const own = kind === "never" ? [] : [`${at} is ${kind === undefined ? "z.object" : "a loose object"}`];
  const fields = Object.entries(shape).flatMap(([key, field]) =>
    isUnreadKey({ schema: field }) ? [] : looseObjectsIn({ at: at === "(body)" ? key : `${at}.${key}`, schema: field }),
  );
  return [...own, ...prototypeKeys({ at, keys: Reflect.ownKeys(shape) }), ...fields];
}

/** Types refused whole wherever they sit, each with why — completing `${at} `. */
const WHOLE_REFUSALS: ReadonlyMap<string, string> = new Map([
  ["catch", "is .catch(), which answers its fallback in place of the drift it caught"],
  ["intersection", "is an intersection, which a boundary refuses — spell one strict object with .extend()"],
  ["lazy", "is z.lazy, which a boundary cannot walk"],
  ["pipe", "is a pipe or .transform(), which a boundary refuses — map the parsed value after the read"],
  ["prefault", "is .prefault(), which parses its fallback for a value never sent, so a refusal names fields in it"],
  ["success", "is z.success, which answers true or false in place of the value — a boundary reads nothing"],
  ["undefined", "is z.undefined, which no JSON answer carries — an absent key is .optional()"],
  ["void", "is z.void, which no JSON answer carries — an absent key is .optional()"],
]);

/**
 * Every place under a schema that could read drift as success: an object that is not strict, a wrapper that
 * swallows a failure, or a leaf that checks nothing.
 *
 * @param schema the schema to walk
 * @param at where this schema sits, for the report
 * @returns one line per offending place; empty when the whole schema is strict
 */
export function looseObjectsIn({ schema, at = "(body)" }: { schema: z.core.$ZodType; at?: string }): readonly string[] {
  const def = defOf({ schema });
  const kind: string = def.type;
  const rewritten = rewritesTheValue({ at, def });
  if (rewritten.length > 0) {
    return rewritten;
  }
  if (isLeaf(def)) {
    return leafRefusals({ at, def });
  }
  switch (def.type) {
    case "catch":
    case "intersection":
    case "lazy":
    case "pipe":
    case "prefault":
    case "success":
    case "undefined":
    case "void":
      return [`${at} ${WHOLE_REFUSALS.get(kind)!}`];
    case "object":
      return looseInObject({ at, catchall: def.catchall, shape: def.shape });
    case "array":
      return looseObjectsIn({ at: `${at}[]`, schema: def.element });
    case "optional":
      return builtExactOptional({ schema })
        ? [
            `${at} is .exactOptional(), which runs its inner schema on an absent key, so a record or tuple names one never sent — spell it .optional()`,
          ]
        : looseObjectsIn({ at, schema: def.innerType });
    case "nullable":
    case "default":
    case "nonoptional":
    case "readonly":
      return looseObjectsIn({ at, schema: def.innerType });
    case "map":
      return [
        ...looseObjectsIn({ at: `${at}<key>`, schema: def.keyType }),
        ...looseObjectsIn({ at: `${at}<value>`, schema: def.valueType }),
      ];
    case "set":
      return looseObjectsIn({ at: `${at}<>`, schema: def.valueType });
    case "union":
      return looseInUnion({ at, def, schema });
    case "record":
      return looseInRecord({ at, def });
    case "tuple":
      return [
        ...def.items.flatMap((item, index) => looseObjectsIn({ at: `${at}[${String(index)}]`, schema: item })),
        ...(def.rest === null ? [] : looseObjectsIn({ at: `${at}[]`, schema: def.rest })),
      ];
    default:
      return [`${at} is z.${kind}, which this walk does not know — refused until someone decides it is safe`];
  }
}
