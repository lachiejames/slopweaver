import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  builtDiscriminated,
  builtExactOptional,
  builtXor,
  isBuiltBound,
  isRelabelled,
} from "../../../lib/boundaryTraits.js";

/** What `z.object(shape, { type: "string" })` leaves on the def, which Zod's params type refuses to spell. */
const relabelled = <S extends z.ZodType>({ schema, type }: { schema: S; type: string }): S => {
  Object.assign(schema._zod.def, { type });
  return schema;
};

describe("isRelabelled", () => {
  it("believes every label its class built, formats and discriminated unions included", () => {
    const built = [
      z.strictObject({ id: z.string() }),
      z.email(),
      z.int(),
      z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("a") })]),
      z.string().optional(),
      z.templateLiteral(["id_", z.number()]),
    ];

    expect(built.map((schema) => isRelabelled({ schema }))).toEqual([false, false, false, false, false, false]);
  });

  it("refuses a def whose type a param overwrote, and leaves a type it does not know to the walk", () => {
    expect(isRelabelled({ schema: relabelled({ schema: z.object({ id: z.string() }), type: "string" }) })).toBe(true);
    expect(isRelabelled({ schema: relabelled({ schema: z.custom(() => true), type: "unknown" }) })).toBe(true);
    expect(isRelabelled({ schema: relabelled({ schema: z.string(), type: "not_a_zod_type" }) })).toBe(false);
  });
});

describe("isBuiltBound", () => {
  it("allows a bound Zod built, and refuses every other check however it is labelled", () => {
    const [minimum] = z.array(z.string()).min(1)._zod.def.checks!;
    const [custom] = z.string().superRefine(() => undefined)._zod.def.checks!;
    Object.assign(custom!._zod.def, { check: "min_length" });
    const [property] = z.strictObject({ m: z.string() }).check(z.property("m", z.string()))._zod.def.checks!;

    expect(isBuiltBound({ check: minimum! })).toBe(true);
    expect(isBuiltBound({ check: custom! })).toBe(false);
    expect(isBuiltBound({ check: property! })).toBe(false);
  });
});

describe("builtExactOptional", () => {
  it("tells .exactOptional() from .optional(), which share a label", () => {
    const exact = z.number().exactOptional();

    expect(exact._zod.def.type).toBe("optional");
    expect(builtExactOptional({ schema: exact })).toBe(true);
    expect(builtExactOptional({ schema: z.number().optional() })).toBe(false);
  });
});

describe("builtXor", () => {
  it("tells z.xor from z.union, which share a label", () => {
    const xor = z.xor([z.string(), z.number()]);

    expect(xor._zod.def.type).toBe("union");
    expect(builtXor({ schema: xor })).toBe(true);
    expect(builtXor({ schema: z.union([z.string(), z.number()]) })).toBe(false);
  });
});

describe("builtDiscriminated", () => {
  it("tells a discriminated union from a plain one given a discriminator param", () => {
    const plain = z.union([z.strictObject({ kind: z.literal("a") }), z.strictObject({ kind: z.literal("b") })]);
    Object.assign(plain._zod.def, { discriminator: "kind" });

    expect(
      builtDiscriminated({ schema: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("a") })]) }),
    ).toBe(true);
    expect(builtDiscriminated({ schema: plain })).toBe(false);
  });
});
