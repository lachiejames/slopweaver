import { describe, expect, it } from "vitest";

import { HIVE_API_ENDPOINT } from "../../../../atlas/graphqlHive/client.js";
import { HiveApiErrors } from "../../../../atlas/graphqlHive/errors.js";
import { providerKey, reduceHiveSchema, renderTypeRef } from "../../../../atlas/graphqlHive/schemaRead.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { introspection } from "./hiveFixtures.js";

/** The fixture introspection with one type entry swapped for another, so a single field can be removed. */
function introspectionWithType({ type }: { type: Record<string, unknown> }): Record<string, unknown> {
  return { __schema: { mutationType: null, queryType: { name: "Query" }, subscriptionType: null, types: [type] } };
}

describe("reduceHiveSchema", () => {
  it("reduces every root type's fields to operations, one per root field", () => {
    const surface = unwrap(reduceHiveSchema({ data: introspection() }));
    expect(surface.operations.map((operation) => providerKey({ operation }))).toStrictEqual([
      "Mutation.createProject",
      "Query.organization",
    ]);
  });

  it("names which root a field hangs off, so a reader knows whether calling it writes", () => {
    const surface = unwrap(reduceHiveSchema({ data: introspection() }));
    expect(surface.operations.find((operation) => operation.name === "createProject")!.parentType).toBe("Mutation");
  });

  it("renders the return type the way a human writes it", () => {
    const surface = unwrap(reduceHiveSchema({ data: introspection() }));
    expect(surface.operations.find((operation) => operation.name === "organization")!.returnType).toBe("Organization");
  });

  it("keeps an argument's name and rendered type, and records only WHETHER it has a default", () => {
    const surface = unwrap(reduceHiveSchema({ data: introspection() }));
    expect(surface.operations.find((operation) => operation.name === "createProject")!.args).toStrictEqual([
      { argType: "CreateProjectInput!", hasDefault: true, name: "input" },
    ]);
  });

  it("carries a deprecation reason through, because a deprecated call is still part of the surface", () => {
    const surface = unwrap(reduceHiveSchema({ data: introspection() }));
    expect(surface.operations.find((operation) => operation.name === "createProject")!.deprecationReason).toBe(
      "use createTarget",
    );
  });

  it("skips introspection's own `__`-prefixed types, which are not part of Hive's surface", () => {
    const surface = unwrap(reduceHiveSchema({ data: introspection() }));
    expect(surface.types.map((type) => type.name)).toStrictEqual(["Mutation", "Organization", "ProjectType", "Query"]);
  });

  it("folds an enum's values into the same field list as an object's fields", () => {
    const surface = unwrap(reduceHiveSchema({ data: introspection() }));
    expect(surface.types.find((type) => type.name === "ProjectType")!.fields).toStrictEqual(["FEDERATION", "SINGLE"]);
  });

  it("records the GraphQL type kind, so a caller can tell an input from an output", () => {
    const surface = unwrap(reduceHiveSchema({ data: introspection() }));
    expect(surface.types.find((type) => type.name === "ProjectType")!.typeKind).toBe("ENUM");
  });

  it("answers an empty surface for a response carrying no __schema, which a caller reads as malformed", () => {
    expect(unwrap(reduceHiveSchema({ data: { nothing: true } }))).toStrictEqual({ operations: [], types: [] });
  });

  it("refuses a named type carrying no kind, which the introspection contract requires", () => {
    const refused = reduceHiveSchema({ data: introspectionWithType({ type: { fields: [], name: "Organization" } }) });
    expect(unwrapErr(refused)).toStrictEqual(
      HiveApiErrors.malformedResponse({
        endpoint: HIVE_API_ENDPOINT,
        reason: "the introspected type Organization carries no kind, which the introspection contract requires",
      }),
    );
  });

  it("refuses a root field whose return type reference carries no name, rather than publishing Unknown", () => {
    const query = {
      fields: [{ args: [], name: "organization", type: { kind: "OBJECT", ofType: null } }],
      kind: "OBJECT",
      name: "Query",
    };
    const refused = reduceHiveSchema({ data: introspectionWithType({ type: query }) });
    expect(unwrapErr(refused).message).toBe(
      `${HIVE_API_ENDPOINT} answered 200 with a body this atlas cannot read: a OBJECT type reference carries ` +
        "no name, which the introspection contract requires",
    );
  });

  it("refuses an argument whose type reference carries no name", () => {
    const query = {
      fields: [
        {
          args: [{ defaultValue: null, name: "reference", type: { kind: "INPUT_OBJECT", ofType: null } }],
          name: "organization",
          type: { kind: "OBJECT", name: "Organization", ofType: null },
        },
      ],
      kind: "OBJECT",
      name: "Query",
    };
    expect(unwrapErr(reduceHiveSchema({ data: introspectionWithType({ type: query }) })).code).toBe(
      "MALFORMED_RESPONSE",
    );
  });
});

describe("renderTypeRef", () => {
  it("renders a bare named type", () => {
    expect(unwrap(renderTypeRef({ ref: { kind: "OBJECT", name: "Target", ofType: null } }))).toBe("Target");
  });

  it("renders a non-null wrapper as a trailing bang", () => {
    expect(
      unwrap(
        renderTypeRef({ ref: { kind: "NON_NULL", name: null, ofType: { kind: "SCALAR", name: "ID", ofType: null } } }),
      ),
    ).toBe("ID!");
  });

  it("renders nested list and non-null wrappers in the order a schema writes them", () => {
    const ref = {
      kind: "NON_NULL",
      name: null,
      ofType: {
        kind: "LIST",
        name: null,
        ofType: { kind: "NON_NULL", name: null, ofType: { kind: "OBJECT", name: "Project", ofType: null } },
      },
    };
    expect(unwrap(renderTypeRef({ ref }))).toBe("[Project!]!");
  });

  it("answers Unknown below the depth the query's own fragment descends to", () => {
    expect(unwrap(renderTypeRef({ ref: null }))).toBe("Unknown");
  });

  it("refuses a named reference carrying no name, inside any wrapper", () => {
    const ref = { kind: "NON_NULL", name: null, ofType: { kind: "SCALAR", name: null, ofType: null } };
    expect(unwrapErr(renderTypeRef({ ref }))).toStrictEqual(
      HiveApiErrors.malformedResponse({
        endpoint: HIVE_API_ENDPOINT,
        reason: "a SCALAR type reference carries no name, which the introspection contract requires",
      }),
    );
  });
});
