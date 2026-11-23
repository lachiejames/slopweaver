/**
 * `classifyDrift` through a union: when no arm matched, the refusal names the field inside the arm that was sent,
 * read by the kind of value that arrived or by a discriminated union's tag, and a union whose failed read would
 * have to guess between two objects is refused at definition.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BoundaryErrors, defineBoundary } from "../../../../lib/boundary.js";
import { unwrapErr } from "../../../../lib/result.js";

describe("classifyDrift through a union", () => {
  it("names the field inside the object arm when no arm matched", () => {
    const boundary = defineBoundary({
      endpoint: "GET /rows",
      schema: z.strictObject({
        rows: z.array(z.array(z.union([z.null(), z.strictObject({ resets_left: z.number() })]))),
      }),
    });

    expect(unwrapErr(boundary.parse({ value: { rows: [[{ resetsLeft: 2 }]] } })).message).toBe(
      'GET /rows answered a shape this version does not read — refused, not guessed: field "rows[0][0].resets_left" renamed to "rows[0][0].resetsLeft"?',
    );
  });

  it("names an enum value that changed inside the arm it belongs to", () => {
    const boundary = defineBoundary({
      endpoint: "GET /status",
      schema: z.strictObject({
        item: z.union([z.strictObject({ id: z.string(), status: z.enum(["active", "paused"]) }), z.literal("none")]),
      }),
    });

    expect(unwrapErr(boundary.parse({ value: { item: { id: "g1", status: "archived" } } })).message).toBe(
      'GET /status answered a shape this version does not read — refused, not guessed: field "item.status" changed: Invalid option: expected one of "active"|"paused"',
    );
  });

  it("reads the object arm of an id-or-object union when an object arrived", () => {
    const boundary = defineBoundary({
      endpoint: "GET /customer",
      schema: z.strictObject({
        customer: z.union([z.string(), z.strictObject({ id: z.string(), resets_left: z.number() })]),
      }),
    });

    expect(unwrapErr(boundary.parse({ value: { customer: { id: "c1", resetsLeft: 2 } } })).message).toBe(
      'GET /customer answered a shape this version does not read — refused, not guessed: field "customer.resets_left" renamed to "customer.resetsLeft"?',
    );
  });

  it("reads the object arm over a literal arm and over a nested union of primitives", () => {
    const customer = z.strictObject({ id: z.string(), resets_left: z.number() });
    const boundary = defineBoundary({
      endpoint: "GET /customers",
      schema: z.strictObject({
        deleted: z.union([customer, z.literal("deleted")]),
        either: z.union([customer, z.union([z.string(), z.number()])]),
      }),
    });
    const drifted = { id: "c1", resetsLeft: 2 };

    expect(unwrapErr(boundary.parse({ value: { deleted: drifted, either: drifted } })).message).toBe(
      'GET /customers answered a shape this version does not read — refused, not guessed: field "deleted.resets_left" renamed to "deleted.resetsLeft"?; field "either.resets_left" renamed to "either.resetsLeft"?',
    );
  });

  it("reads the arm whose tag matched in a discriminated union, not the arm with fewer issues", () => {
    const boundary = defineBoundary({
      endpoint: "GET /item",
      schema: z.strictObject({
        item: z.discriminatedUnion("kind", [
          z.strictObject({ kind: z.literal("a") }),
          z.strictObject({ kind: z.literal("b"), m: z.number(), n: z.number() }),
        ]),
      }),
    });

    expect(unwrapErr(boundary.parse({ value: { item: { kind: "b", m: "2", n: "1" } } }))).toEqual(
      BoundaryErrors.shapeChanged({
        drift: [
          {
            detail: 'field "item.m" changed: Invalid input: expected number, received string',
            kind: "changed",
            path: "item.m",
          },
          {
            detail: 'field "item.n" changed: Invalid input: expected number, received string',
            kind: "changed",
            path: "item.n",
          },
        ],
        endpoint: "GET /item",
      }),
    );
  });

  it("reads the arm a discriminated union's tag names, however many keys that arm dropped or renamed", () => {
    const subscription = defineBoundary({
      endpoint: "GET /subscription",
      schema: z.discriminatedUnion("status", [
        z.strictObject({ id: z.string(), status: z.literal("cancelled") }),
        z.strictObject({ id: z.string(), plan: z.string(), seats: z.number(), status: z.literal("active") }),
      ]),
    });
    const quota = defineBoundary({
      endpoint: "GET /tagged",
      schema: z.discriminatedUnion("kind", [
        z.strictObject({ id: z.string(), kind: z.literal("a") }),
        z.strictObject({ id: z.string(), kind: z.literal("b"), limit: z.number(), used: z.number() }),
      ]),
    });

    expect(unwrapErr(subscription.parse({ value: { id: "s1", status: "active" } }))).toEqual(
      BoundaryErrors.shapeChanged({
        drift: [
          { detail: 'field "plan" is missing', kind: "missing", path: "plan" },
          { detail: 'field "seats" is missing', kind: "missing", path: "seats" },
        ],
        endpoint: "GET /subscription",
      }),
    );
    expect(unwrapErr(quota.parse({ value: { id: "x", kind: "b", limit_pct: 3, used_pct: 2 } }))).toEqual(
      BoundaryErrors.shapeChanged({
        drift: [
          { detail: 'field "limit" renamed to "limit_pct"?', kind: "renamed", path: "limit_pct" },
          { detail: 'field "used" renamed to "used_pct"?', kind: "renamed", path: "used_pct" },
        ],
        endpoint: "GET /tagged",
      }),
    );
  });

  it("names a field deep inside a nullable list's element, and inside a string-or-object arm", () => {
    const message = z.strictObject({ text: z.unknown().optional(), ts: z.string() });
    const boundary = defineBoundary({
      endpoint: "GET /history",
      schema: z.strictObject({
        blocks: z.union([z.null(), z.array(z.strictObject({ elements: z.array(message) }))]),
        customer: z.union([z.string(), z.strictObject({ id: z.string(), balance: z.number() })]),
      }),
    });

    expect(
      unwrapErr(
        boundary.parse({
          value: { blocks: [{ elements: [{ ts: 1 }] }], customer: { balance: "0", id: "c1" } },
        }),
      ).message,
    ).toBe(
      'GET /history answered a shape this version does not read — refused, not guessed: field "blocks[0].elements[0].ts" changed: Invalid input: expected string, received number; field "customer.balance" changed: Invalid input: expected number, received string',
    );
  });

  it("reads an object-or-list union by the kind that arrived, in either order", () => {
    const item = z.strictObject({ n: z.number() });
    const expected =
      'GET /items answered a shape this version does not read — refused, not guessed: field "[1].n" changed: Invalid input: expected number, received string';

    expect(
      unwrapErr(
        defineBoundary({ endpoint: "GET /items", schema: z.union([item, z.array(item)]) }).parse({
          value: [{ n: 1 }, { n: "2" }],
        }),
      ).message,
    ).toBe(expected);
    expect(
      unwrapErr(
        defineBoundary({ endpoint: "GET /items", schema: z.union([z.array(item), item]) }).parse({
          value: [{ n: 1 }, { n: "2" }],
        }),
      ).message,
    ).toBe(expected);
  });

  it("refuses at definition every union whose failed read would have to guess between two objects", () => {
    const human = z.strictObject({ attachments: z.unknown().optional(), text: z.string(), user: z.string() });
    const bot = z.strictObject({ attachments: z.array(z.strictObject({ id: z.string() })), bot_id: z.string() });
    const cases = [
      { at: "(body)", schema: z.union([z.strictObject({ data: z.string() }), z.strictObject({ error: z.string() })]) },
      { at: "message", schema: z.strictObject({ message: z.union([human, bot]) }) },
      {
        at: "message",
        schema: z.discriminatedUnion("type", [
          z.strictObject({ message: z.union([human, bot.nullable()]), type: z.literal("event") }),
          z.strictObject({ type: z.literal("ping") }),
        ]),
      },
      {
        at: "(body)",
        schema: z.union([z.strictObject({ id: z.number(), login: z.string() }), z.strictObject({ login: z.string() })]),
      },
    ];

    expect(cases.length).toBeGreaterThan(0);
    for (const { at, schema } of cases) {
      expect(() => defineBoundary({ endpoint: "GET /x", schema })).toThrow(
        `defineBoundary(GET /x): every object must be z.strictObject — ${at} is a z.union with 2 arms that read objects, so a refusal could not say which one was sent — spell it z.discriminatedUnion on the field that tells them apart, or one z.strictObject whose differing keys are optional`,
      );
    }
  });
});
