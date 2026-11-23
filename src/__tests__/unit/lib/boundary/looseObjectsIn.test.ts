/**
 * `looseObjectsIn`: the walk `defineBoundary` runs at definition names every schema shape that would read a new,
 * dropped or retyped key as success, wherever it sits, and finds nothing in a schema strict all the way down.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineBoundary } from "../../../../lib/boundary.js";
import { looseObjectsIn } from "../../../../lib/boundaryWalk.js";

describe("looseObjectsIn", () => {
  it("finds a plain, a loose and a lazy object wherever they sit", () => {
    const schema = z.strictObject({
      byKey: z.record(z.string(), z.looseObject({})),
      either: z.union([z.string(), z.object({ n: z.number() })]),
      later: z.lazy(() => z.string()),
      pair: z.tuple([z.string(), z.object({})]),
      shaped: z.strictObject({ defaulted: z.object({}).default({}), nullable: z.object({}).nullable() }),
    });

    expect(looseObjectsIn({ schema })).toEqual([
      "byKey{} is a loose object",
      "either is z.object",
      "later is z.lazy, which a boundary cannot walk",
      "pair[1] is z.object",
      "shaped.defaulted is z.object",
      "shaped.nullable is z.object",
    ]);
  });

  it("refuses a .catch() and a z.success, and walks into a map and a set", () => {
    const schema = z.strictObject({
      caught: z.strictObject({ b: z.string() }).catch({ b: "fallback" }),
      either: z.union([z.success(z.strictObject({ id: z.number() })), z.strictObject({ login: z.string() })]),
      keyed: z.map(z.string(), z.object({})),
      ok: z.success(z.strictObject({})),
      unique: z.set(z.looseObject({})),
    });

    expect(looseObjectsIn({ schema })).toEqual([
      "caught is .catch(), which answers its fallback in place of the drift it caught",
      "either is z.success, which answers true or false in place of the value — a boundary reads nothing",
      "keyed<value> is z.object",
      "ok is z.success, which answers true or false in place of the value — a boundary reads nothing",
      "unique<> is a loose object",
    ]);
  });

  it("refuses every shape that reads a new key as success even with strict objects inside it", () => {
    const strict = z.strictObject({ b: z.string() });
    const schema = z.strictObject({
      anything: z.any(),
      custom: z.custom<string>(),
      either: z.union([strict, z.record(z.string(), z.unknown())]),
      later: z.promise(strict),
      loose: z.looseRecord(z.string().regex(/^g_/), strict),
      merged: strict.and(z.record(z.string(), z.unknown())),
      reshaped: z.preprocess((value) => value, strict),
    });

    expect(looseObjectsIn({ schema })).toEqual([
      "anything is z.any, which checks nothing a boundary can read",
      "custom is z.custom, which checks nothing a boundary can read",
      "either is a union with an arm accepting any keys, which reads every other arm's drift as that arm",
      "later is z.promise, which checks nothing a boundary can read",
      "loose is z.looseRecord, which passes a key its key schema does not match unchecked",
      "merged is an intersection, which a boundary refuses — spell one strict object with .extend()",
      "reshaped is a pipe or .transform(), which a boundary refuses — map the parsed value after the read",
    ]);
  });

  it("refuses a keys-anything union arm however it is wrapped, every pipe into a schema, coercion and overwrite", () => {
    const strict = z.strictObject({ a: z.string() });
    const record = z.record(z.string(), z.unknown());
    const schema = z.strictObject({
      codec: z.codec(record, strict, { decode: (value) => ({ a: String(value["a"]) }), encode: (value) => value }),
      coerced: z.coerce.number(),
      nested: z.union([strict, z.union([z.string(), record])]),
      optionalArm: z.union([strict, z.unknown().optional()]),
      overwritten: z.string().overwrite((text) => text.trim()),
      piped: z.string().pipe(z.string()),
      pipedArm: z.union([strict, record.pipe(z.record(z.string(), z.unknown()))]),
      remapped: z
        .unknown()
        .transform((value) => value)
        .pipe(strict),
      wrappedArm: z.union([strict.nullable(), record]),
    });

    expect(looseObjectsIn({ schema })).toEqual([
      "codec is a pipe or .transform(), which a boundary refuses — map the parsed value after the read",
      "coerced is z.coerce, which reads a retyped field as a converted value",
      "nested is a union with an arm accepting any keys, which reads every other arm's drift as that arm",
      "optionalArm is a union with an arm accepting any keys, which reads every other arm's drift as that arm",
      "overwritten carries .overwrite(), which rewrites the value before a later check reads it",
      "piped is a pipe or .transform(), which a boundary refuses — map the parsed value after the read",
      "pipedArm is a union with an arm accepting any keys, which reads every other arm's drift as that arm",
      "remapped is a pipe or .transform(), which a boundary refuses — map the parsed value after the read",
      "wrappedArm is a union with an arm accepting any keys, which reads every other arm's drift as that arm",
    ]);
  });

  it("refuses a custom check, which can drop the issues a strict object raised", () => {
    const schema = z.strictObject({
      refined: z.strictObject({ a: z.string() }).superRefine((_value, context) => {
        context.issues.splice(0);
      }),
    });

    expect(looseObjectsIn({ schema })).toEqual([
      "refined carries a custom check, which can drop the issues a strict object raised — check after the read",
    ]);
  });

  it("refuses every transform and every intersection, walks a record's key, and sees into a union's containers", () => {
    const customer = z.strictObject({ id: z.string() });
    const schema = z.strictObject({
      counted: z.string().transform((text) => text.length),
      keyed: z.record(z.coerce.string(), z.number()),
      listed: z.union([z.array(customer), z.array(z.unknown())]),
      merged: z.strictObject({ a: z.string() }).and(z.strictObject({ b: z.string() })),
      unchecked: z.array(z.unknown()).transform((raw) => raw.length),
    });

    expect(looseObjectsIn({ schema })).toEqual([
      "counted is a pipe or .transform(), which a boundary refuses — map the parsed value after the read",
      "keyed{key} is z.coerce, which reads a retyped field as a converted value",
      "listed is a union with an arm accepting any keys, which reads every other arm's drift as that arm",
      "merged is an intersection, which a boundary refuses — spell one strict object with .extend()",
      "unchecked is a pipe or .transform(), which a boundary refuses — map the parsed value after the read",
    ]);
  });

  it("refuses z.unknown() anywhere but an object field, where the key is what is declared", () => {
    const schema = z.strictObject({
      byKey: z.record(z.string(), z.unknown()),
      listed: z.array(z.unknown()),
      unread: z.unknown().optional(),
    });

    expect(looseObjectsIn({ schema })).toEqual([
      "byKey{} is z.unknown, which checks nothing a boundary can read",
      "listed[] is z.unknown, which checks nothing a boundary can read",
    ]);
    expect(looseObjectsIn({ schema: z.unknown() })).toEqual([
      "(body) is z.unknown, which checks nothing a boundary can read",
    ]);
  });

  it("refuses a plain union of two objects, tagged or not, and allows the discriminated one", () => {
    const active = z.strictObject({ plan: z.string(), status: z.literal("active") });
    const cancelled = z.strictObject({ status: z.enum(["cancelled", "lapsed"]) });
    const untagged = z.strictObject({ error: z.string() });
    const refusal = ({ at }: { at: string }): string =>
      `${at} is a z.union with 2 arms that read objects, so a refusal could not say which one was sent — spell it z.discriminatedUnion on the field that tells them apart, or one z.strictObject whose differing keys are optional`;

    expect(
      looseObjectsIn({
        schema: z.strictObject({
          discriminated: z.discriminatedUnion("status", [active, cancelled]),
          nullable: z.union([z.null(), active]),
          tagged: z.union([active, cancelled]),
          untagged: z.union([active, untagged]),
        }),
      }),
    ).toEqual([refusal({ at: "tagged" }), refusal({ at: "untagged" })]);
  });

  it("refuses a discriminated union whose tag an arm may omit, a .prefault(), and a record keyed by numbers", () => {
    const human = z.strictObject({ subtype: z.literal("thread_broadcast").optional(), text: z.string() });
    const bot = z.strictObject({ bot_id: z.string(), subtype: z.literal("bot_message") });
    const limits = z.strictObject({ seven_day: z.number() });

    expect(
      looseObjectsIn({
        schema: z.strictObject({
          byStatus: z.record(z.number(), z.number()),
          byWindow: z.record(z.enum(["five_hour", "seven_day"]), z.number()),
          limits: limits.prefault({ seven_day: 0 }),
          messages: z.array(z.discriminatedUnion("subtype", [human, bot])),
          named: z.record(z.literal(["a", "b"]), z.number()),
        }),
      }),
    ).toEqual([
      "byStatus is a record keyed by other than strings, whose keys a refusal would print as list indexes",
      "limits is .prefault(), which parses its fallback for a value never sent, so a refusal names fields in it",
      'messages[] arm 0 may omit its tag "subtype" or answer it null, so a value whose tag was dropped, nulled or renamed reads as that arm — make the tag a required literal on every arm, or spell one z.strictObject whose differing keys are optional',
    ]);
  });

  it("refuses a bound on a type it does not measure, which Zod runs on a default, an absent key, null or a field", () => {
    const refusal = ({ at, check, type }: { at: string; check: string; type: string }): string =>
      `${at} carries a ${check} bound on z.${type}, which Zod runs on whatever that answers — an absent key, a default, null or a field of that name — so it names a field that did not drift; bound the value it measures`;
    // What `.check(z.gte(n))` leaves on a def whose output admits null or undefined, which Zod's types refuse to spell.
    const bounded = <S extends z.ZodType>({ schema, check }: { schema: S; check: z.core.$ZodCheck<number> }): S => {
      Object.assign(schema._zod.def, { checks: [check] });
      return schema;
    };

    expect(
      looseObjectsIn({
        schema: z.strictObject({
          either: bounded({ check: z.gte(1), schema: z.union([z.number().default(0), z.null()]) }),
          grants: z.array(z.string()).default([]).check(z.minLength(1)),
          inner: z.number().gte(1).optional(),
          left: bounded({ check: z.gte(1), schema: z.number().nullable() }),
          page: z.strictObject({ items: z.array(z.string()), length: z.number().default(0) }).check(z.minLength(1)),
          windows: z.record(
            z.enum(["five_hour", "seven_day"]),
            bounded({ check: z.gte(0), schema: z.number().optional() }),
          ),
        }),
      }),
    ).toEqual([
      refusal({ at: "either", check: "greater_than", type: "union" }),
      refusal({ at: "grants", check: "min_length", type: "default" }),
      refusal({ at: "left", check: "greater_than", type: "nullable" }),
      refusal({ at: "page", check: "min_length", type: "object" }),
      refusal({ at: "windows{}", check: "greater_than", type: "optional" }),
    ]);
  });

  it("refuses .exactOptional() and z.xor, which fail on an absent key, and an undefined no JSON carries", () => {
    const windows = z.enum(["five_hour", "seven_day"]);

    expect(
      looseObjectsIn({
        schema: z.strictObject({
          absent: z.union([z.number(), z.undefined()]),
          either: z.record(windows, z.xor([z.number().optional(), z.null().optional()])),
          left: z.union([z.number(), z.literal(undefined)]),
          optional: z.record(windows, z.union([z.number().optional(), z.null().optional()])),
          windows: z.record(windows, z.number().exactOptional()),
        }),
      }),
    ).toEqual([
      "absent is z.undefined, which no JSON answer carries — an absent key is .optional()",
      "either{} is z.xor, which fails when two arms match — an absent key two optional arms accept included — so it names a field never sent; spell z.union",
      "left is a z.literal allowing undefined, which no JSON answer carries — an absent key is .optional()",
      "windows{} is .exactOptional(), which runs its inner schema on an absent key, so a record or tuple names one never sent — spell it .optional()",
    ]);
  });

  it("allows one strict object extended from another", () => {
    const schema = z.strictObject({ merged: z.strictObject({ a: z.string() }).extend({ b: z.string() }) });

    expect(looseObjectsIn({ schema })).toEqual([]);
  });

  it("refuses to define a boundary whose strict object sits under a .catch()", () => {
    expect(() =>
      defineBoundary({
        endpoint: "GET /caught",
        schema: z.strictObject({ a: z.strictObject({ b: z.string() }).catch({ b: "fallback" }) }),
      }),
    ).toThrow(
      "defineBoundary(GET /caught): every object must be z.strictObject — a is .catch(), which answers its fallback in place of the drift it caught",
    );
  });

  it("finds nothing in a schema strict all the way down", () => {
    expect(looseObjectsIn({ schema: z.strictObject({ a: z.array(z.strictObject({ b: z.unknown() })) }) })).toEqual([]);
  });
});
