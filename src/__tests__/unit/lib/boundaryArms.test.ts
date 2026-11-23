import { describe, expect, it } from "vitest";
import { z } from "zod";

import { isAbsent, meantArmIssues, pathKey } from "../../../lib/boundaryArms.js";

/** The issues Zod raised for a value the schema refused. */
function issuesOf({ schema, value }: { schema: z.ZodType; value: unknown }): readonly z.core.$ZodIssue[] {
  const parsed = schema.safeParse(value);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues;
}

/** What each meant issue says, as `code@path`, so a wrong arm shows as the wrong fields. */
function read({ schema, value }: { schema: z.ZodType; value: unknown }): readonly string[] {
  return meantArmIssues({ issues: issuesOf({ schema, value }) }).map(
    (issue) => `${issue.code}@${issue.path.map(String).join(".")}`,
  );
}

describe("isAbsent", () => {
  it("is true only for a key its parent object does not carry", () => {
    const value = { a: { b: undefined, c: 1 }, list: [{ d: 1 }] };

    expect(isAbsent({ path: ["a", "x"], value })).toBe(true);
    expect(isAbsent({ path: ["list", 0, "x"], value })).toBe(true);
    expect(isAbsent({ path: ["a", "b"], value })).toBe(false);
    expect(isAbsent({ path: ["a", "c"], value })).toBe(false);
    expect(isAbsent({ path: [], value })).toBe(false);
    expect(isAbsent({ path: ["list", 5], value })).toBe(false);
  });
});

describe("pathKey", () => {
  it("keeps a dotted key apart from the nesting its text resembles", () => {
    expect(pathKey({ path: ["a.b"] })).toBe('["a.b"]');
    expect(pathKey({ path: ["a", "b"] })).toBe('["a","b"]');
    expect(pathKey({ path: ["list", 0] })).toBe('["list","0"]');
  });
});

describe("meantArmIssues", () => {
  it("passes through an issue that is not a failed union", () => {
    const issues = issuesOf({ schema: z.strictObject({ a: z.string() }), value: { a: 1 } });

    expect(meantArmIssues({ issues })).toEqual(issues);
  });

  it("reads the one arm that did not refuse the value whole, in either order, re-rooted at the union", () => {
    const customer = z.strictObject({ id: z.string(), items: z.array(z.strictObject({ n: z.number() })) });
    const value = { at: { id: "c1", items: [{ n: "1" }] } };

    expect(read({ schema: z.strictObject({ at: z.union([z.string(), customer]) }), value })).toEqual([
      "invalid_type@at.items.0.n",
    ]);
    expect(read({ schema: z.strictObject({ at: z.union([customer, z.null(), z.literal("gone")]) }), value })).toEqual([
      "invalid_type@at.items.0.n",
    ]);
  });

  it("reads a scalar arm whose check failed over an object arm the scalar never was", () => {
    const schema = z.union([z.string().min(3), z.strictObject({ id: z.string() })]);

    expect(read({ schema, value: "ab" })).toEqual(["too_small@"]);
  });

  it("drops an arm whose length check ran on a value its type check refused, in either order", () => {
    const page = z.strictObject({ items: z.array(z.string()), length: z.number() });
    const value = { items: [1], length: 9 };
    const item = z.strictObject({ n: z.number() });

    expect(read({ schema: z.union([z.string().min(1), page]), value })).toEqual(["invalid_type@items.0"]);
    expect(read({ schema: z.union([page, z.string().max(3)]), value })).toEqual(["invalid_type@items.0"]);
    expect(read({ schema: z.union([z.array(item).min(5), item]), value: "abc" })).toEqual(["invalid_union@"]);
    expect(read({ schema: z.union([z.string().min(1), z.null()]), value: [] })).toEqual(["invalid_union@"]);
  });

  it("judges an arm that is itself a union by the arm it meant", () => {
    const schema = z.union([z.null(), z.union([z.number(), z.array(z.strictObject({ id: z.string() }))])]);

    expect(read({ schema, value: [{ id: 1 }] })).toEqual(["invalid_type@0.id"]);
  });

  it("keeps the union's own issue when every arm refused the value whole, or two arms did not", () => {
    expect(read({ schema: z.union([z.string(), z.number()]), value: true })).toEqual(["invalid_union@"]);
    expect(read({ schema: z.union([z.string().min(5), z.string().max(1)]), value: "abc" })).toEqual(["invalid_union@"]);
    expect(read({ schema: z.union([z.null(), z.strictObject({ a: z.string() })]), value: [1] })).toEqual([
      "invalid_union@",
    ]);
  });
});
