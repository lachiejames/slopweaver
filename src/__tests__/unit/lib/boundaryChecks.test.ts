import { describe, expect, it } from "vitest";
import { z } from "zod";

import { rewritesTheValue } from "../../../lib/boundaryChecks.js";
import { defOf } from "../../../lib/boundaryUnion.js";

const refused = ({ schema }: { schema: z.ZodType }): readonly string[] =>
  rewritesTheValue({ at: "(body)", def: defOf({ schema }) });

describe("rewritesTheValue", () => {
  it("allows every check that only bounds the value it is given", () => {
    const bounded = [
      z
        .string()
        .min(1)
        .max(40)
        .length(8)
        .regex(/^[a-z]+$/u)
        .startsWith("a")
        .includes("b")
        .lowercase(),
      z.number().int().gt(0).lte(100).multipleOf(5),
      z.array(z.string()).min(1).max(3),
      z.set(z.string()).size(2),
    ];

    expect(bounded.flatMap((schema) => refused({ schema }))).toEqual([]);
  });

  it("refuses a check that rewrites the value", () => {
    expect(refused({ schema: z.string().toLowerCase() })).toEqual([
      "(body) carries .overwrite(), which rewrites the value before a later check reads it",
    ]);
  });

  it("refuses a z.property check, whose schema the walk never reached", () => {
    const schema = z
      .strictObject({ message: z.unknown().optional() })
      .check(z.property("message", z.strictObject({ text: z.string() })));

    expect(refused({ schema })).toEqual([
      "(body) carries a property check that is not a bound Zod built, so the walk never sees what it runs — check after the read",
    ]);
  });

  it("refuses a bound given its own when, and an error map on a schema or a check", () => {
    const hooked = ({ check }: { check: string }): string =>
      `(body) carries a ${check} check with its own when or error, which Zod hands the payload to rewrite — check after the read`;

    // Zod's params type omits `when` from a bound, yet reads one it is handed — as a params object built elsewhere is.
    const whenParams = { abort: false, when: (): boolean => false };

    expect(refused({ schema: z.array(z.string()).min(0, whenParams) })).toEqual([hooked({ check: "min_length" })]);
    expect(refused({ schema: z.number().gt(0, { error: () => "positive" }) })).toEqual([
      hooked({ check: "greater_than" }),
    ]);
    expect(refused({ schema: z.strictObject({ id: z.string() }, { error: () => "bad" }) })).toEqual([
      "(body) carries an error map, which Zod hands the issue to rewrite — name the drift from the refusal",
    ]);
    expect(refused({ schema: z.string("a string") })).toEqual([
      "(body) carries an error map, which Zod hands the issue to rewrite — name the drift from the refusal",
    ]);
  });

  it("refuses a format schema's own when, and Zod's default when handed to a bound of another kind", () => {
    const lengthWhen = { abort: false, when: z.minLength(0)._zod.def.when };
    const sizeWhen = { abort: false, when: z.minSize(0)._zod.def.when };

    const formats = [z.int(), z.email()];
    for (const format of formats) {
      // What `z.int({ when })` leaves on the def, which Zod's params type refuses to spell.
      Object.assign(format._zod.def, { when: (): boolean => false });
    }

    expect(formats.map((schema) => refused({ schema }))).toEqual([
      ["(body) is a format with its own when, which Zod hands the payload — check after the read"],
      ["(body) is a format with its own when, which Zod hands the payload — check after the read"],
    ]);
    expect(refused({ schema: z.int() })).toEqual([]);
    expect(refused({ schema: z.number().min(0, lengthWhen) })).toEqual([
      "(body) carries a greater_than check with its own when or error, which Zod hands the payload to rewrite — check after the read",
    ]);
    expect(refused({ schema: z.array(z.string()).min(1, sizeWhen) })).toEqual([
      "(body) carries a min_length check with its own when or error, which Zod hands the payload to rewrite — check after the read",
    ]);
    expect(refused({ schema: z.set(z.string()).min(1, sizeWhen) })).toEqual([]);
  });

  it("refuses a custom check and coercion", () => {
    expect(refused({ schema: z.string().refine((text) => text.length > 0) })).toEqual([
      "(body) carries a custom check, which can drop the issues a strict object raised — check after the read",
    ]);
    expect(refused({ schema: z.coerce.number() })).toEqual([
      "(body) is z.coerce, which reads a retyped field as a converted value",
    ]);
  });
});
