/**
 * Walking an OpenAPI document's components: a `$ref`'s name, a component section, a response's JSON schema
 * node, and a schema's field names through its `allOf` bases — bounded by one depth budget whether a base is
 * named or inline, and terminating on a cycle.
 */
import { describe, expect, it } from "vitest";

import {
  openapiComponentSection,
  openapiFieldNames,
  openapiJsonSchemaNode,
  openapiRefName,
} from "../../../../atlas/kit/openapiSchema.js";

describe("openapiRefName", () => {
  it("takes a reference's final component", () => {
    expect(openapiRefName({ ref: "#/components/schemas/User" })).toBe("User");
  });

  it("answers null for a reference ending in a separator, or a value that is not a string", () => {
    expect(openapiRefName({ ref: "#/components/schemas/" })).toBe(null);
    expect(openapiRefName({ ref: 42 })).toBe(null);
  });
});

describe("openapiComponentSection", () => {
  it("returns the named section", () => {
    expect(openapiComponentSection({ doc: { components: { schemas: { User: {} } } }, section: "schemas" })).toEqual({
      User: {},
    });
  });

  it("answers an empty map for a missing components block, a missing section, or a section that is not a map", () => {
    expect(openapiComponentSection({ doc: {}, section: "schemas" })).toEqual({});
    expect(openapiComponentSection({ doc: { components: {} }, section: "schemas" })).toEqual({});
    expect(openapiComponentSection({ doc: { components: { schemas: [] } }, section: "schemas" })).toEqual({});
    expect(openapiComponentSection({ doc: "not a document", section: "schemas" })).toEqual({});
  });
});

describe("openapiJsonSchemaNode", () => {
  it("returns an inline application/json schema as the node itself", () => {
    const schema = { properties: { id: { type: "string" } }, type: "object" };

    expect(openapiJsonSchemaNode({ node: { content: { "application/json": { schema } } } })).toEqual(schema);
  });

  it("answers null when the node declares no JSON schema", () => {
    expect(openapiJsonSchemaNode({ node: { description: "No content" } })).toBe(null);
    expect(openapiJsonSchemaNode({ node: { content: { "text/plain": { schema: {} } } } })).toBe(null);
    expect(openapiJsonSchemaNode({ node: { content: { "application/json": {} } } })).toBe(null);
    expect(openapiJsonSchemaNode({ node: null })).toBe(null);
  });
});

describe("openapiFieldNames", () => {
  const schemas = {
    Base: { properties: { createdAt: {}, id: {} } },
    Cycle: { allOf: [{ $ref: "#/components/schemas/Loop" }], properties: { c: {} } },
    Loop: { allOf: [{ $ref: "#/components/schemas/Cycle" }], properties: { l: {} } },
    User: {
      allOf: [{ $ref: "#/components/schemas/Base" }, { properties: { email: {}, id: {} } }],
      properties: { name: {} },
    },
  };

  it("merges own, named-base and inline-base fields, de-duplicated and sorted", () => {
    expect(openapiFieldNames({ depth: 8, name: "User", schemas })).toEqual(["createdAt", "email", "id", "name"]);
  });

  it("terminates on a cyclic allOf, reading each schema once", () => {
    expect(openapiFieldNames({ depth: 8, name: "Cycle", schemas })).toEqual(["c", "l"]);
  });

  it("reads only the schema's own fields at depth 1, inline bases included in the cut", () => {
    expect(openapiFieldNames({ depth: 1, name: "User", schemas })).toEqual(["name"]);
  });

  it("stops an inline allOf chain at the same budget a named chain stops at", () => {
    const nested = {
      Deep: {
        allOf: [
          {
            allOf: [{ allOf: [{ properties: { third: {} } }], properties: { second: {} } }],
            properties: { first: {} },
          },
        ],
        properties: { own: {} },
      },
    };

    expect(openapiFieldNames({ depth: 3, name: "Deep", schemas: nested })).toEqual(["first", "own", "second"]);
  });

  it("answers nothing for a name the document does not declare", () => {
    expect(openapiFieldNames({ depth: 8, name: "Missing", schemas })).toEqual([]);
  });
});
