import { describe, expect, it } from "vitest";

import { datadogResponseDeclaration } from "../../../../atlas/datadog/responseDeclaration.js";
import { type DatadogSpecView, datadogSpecView } from "../../../../atlas/datadog/responseSpec.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A pinned specification with one path per declaration shape a test reads. */
const DOCUMENT = {
  components: {
    responses: { Shared: { content: { "application/json": { schema: { type: "string" } } } } },
    schemas: { Item: { properties: { id: { type: "string" } }, required: ["id"], type: "object" } },
  },
  paths: {
    "/download": { get: { responses: { "200": { content: { "application/zip": { schema: {} } } } } } },
    "/items": {
      get: {
        responses: {
          "200": {
            content: { "application/json;datetime-format=rfc3339": { schema: { $ref: "#/components/schemas/Item" } } },
          },
          "403": { content: { "application/json": { schema: { type: "object" } } } },
        },
      },
    },
    "/nothing": { get: { responses: { "204": { description: "no content" } } } },
    "/shared": { get: { responses: { "200": { $ref: "#/components/responses/Shared" } } } },
    "/split": {
      get: {
        responses: {
          "200": { content: { "application/json": { schema: { type: "string" } } } },
          "202": { content: { "application/json": { schema: { type: "number" } } } },
        },
      },
    },
  },
} as const;

describe("datadogResponseDeclaration", () => {
  it("reads a parameterised JSON media type as JSON, ignoring every non-2xx code", () => {
    expect(unwrap(datadogResponseDeclaration({ document: DOCUMENT, method: "GET", path: "/items" }))).toEqual({
      media: "json",
      schema: { node: { $ref: "#/components/schemas/Item" }, stack: [] },
    });
  });

  it("resolves a response-level reference", () => {
    expect(unwrap(datadogResponseDeclaration({ document: DOCUMENT, method: "GET", path: "/shared" }))).toEqual({
      media: "json",
      schema: { node: { type: "string" }, stack: [] },
    });
  });

  it("partitions a file download by its media essence", () => {
    expect(unwrap(datadogResponseDeclaration({ document: DOCUMENT, method: "GET", path: "/download" }))).toEqual({
      essence: "application/zip",
      media: "file",
    });
  });

  it("reads two 2xx schemas carrying the same members in a different order as one schema", () => {
    const first = { properties: { a: { type: "string" } }, type: "object" };
    const second = { type: "object", properties: { a: { type: "string" } } };
    const responses = {
      "200": { content: { "application/json": { schema: first } } },
      "201": { content: { "application/json": { schema: second } } },
    };
    const document = { paths: { "/x": { get: { responses } } } };
    expect(unwrap(datadogResponseDeclaration({ document, method: "GET", path: "/x" }))).toEqual({
      media: "json",
      schema: { node: first, stack: [] },
    });
  });

  it("compares two equal 2xx schemas nested however deep without overflowing", () => {
    const deep = (): Record<string, unknown> => {
      let node: Record<string, unknown> = { type: "string" };
      for (let level = 0; level < 100_000; level += 1) {
        node = { items: node, type: "array" };
      }
      return node;
    };
    const responses = {
      "200": { content: { "application/json": { schema: deep() } } },
      "201": { content: { "application/json": { schema: deep() } } },
    };
    const document = { paths: { "/x": { get: { responses } } } };
    expect(unwrap(datadogResponseDeclaration({ document, method: "GET", path: "/x" })).media).toBe("json");
  });

  it("compares two equal 2xx schemas whose nodes YAML aliases share, each pair once rather than once per path", () => {
    const shared = (): Record<string, unknown> => {
      let node: Record<string, unknown> = { type: "string" };
      for (let level = 0; level < 200; level += 1) {
        node = { properties: { a: node, b: node }, type: "object" };
      }
      return node;
    };
    const responses = {
      "200": { content: { "application/json": { schema: shared() } } },
      "201": { content: { "application/json": { schema: shared() } } },
    };
    const document = { paths: { "/x": { get: { responses } } } };
    expect(unwrap(datadogResponseDeclaration({ document, method: "GET", path: "/x" })).media).toBe("json");
  });

  it("refuses two 2xx schemas whose arrays carry the same items in a different order", () => {
    const responses = {
      "200": { content: { "application/json": { schema: { enum: ["a", "b"] } } } },
      "201": { content: { "application/json": { schema: { enum: ["b", "a"] } } } },
    };
    const document = { paths: { "/x": { get: { responses } } } };
    expect(unwrapErr(datadogResponseDeclaration({ document, method: "GET", path: "/x" })).message).toBe(
      "GET /x declares different JSON schemas across its 2xx answers",
    );
  });

  it("reads JSON declared under the OpenAPI 3.0 2XX range as the 2xx answer", () => {
    const content = { "application/json": { schema: { type: "string" } } };
    const document = { paths: { "/x": { get: { responses: { "2XX": { content } } } } } };
    expect(unwrap(datadogResponseDeclaration({ document, method: "GET", path: "/x" }))).toEqual({
      media: "json",
      schema: { node: { type: "string" }, stack: [] },
    });
  });

  it("refuses two JSON media types of one 2xx code declaring different schemas", () => {
    const content = {
      "application/json": { schema: { type: "string" } },
      "application/json; charset=utf-8": { schema: { type: "number" } },
    };
    const document = { paths: { "/x": { get: { responses: { "200": { content } } } } } };
    expect(unwrapErr(datadogResponseDeclaration({ document, method: "GET", path: "/x" })).message).toBe(
      "GET /x declares different JSON schemas across its 2xx answers",
    );
  });

  it("hands a schema containing itself on uncompared, never throwing on its text", () => {
    const schema: Record<string, unknown> = { type: "array" };
    schema["items"] = schema;
    const content = { "application/json": { schema } };
    const responses = { "200": { content }, "201": { content: { "application/json": { schema: {} } } } };
    const document = { paths: { "/x": { get: { responses } } } };
    expect(unwrap(datadogResponseDeclaration({ document, method: "GET", path: "/x" }))).toEqual({
      media: "json",
      schema: { node: schema, stack: [] },
    });
  });

  it("reads only a response's own content, never one inherited through its prototype", () => {
    const inherited = Object.create({ content: { "application/json": { schema: { type: "string" } } } }) as object;
    const document = { paths: { "/x": { get: { responses: { "200": inherited } } } } };
    expect(unwrapErr(datadogResponseDeclaration({ document, method: "GET", path: "/x" })).message).toBe(
      "GET /x declares no 2xx content",
    );
  });

  it.each([
    ["/split", "GET /split declares different JSON schemas across its 2xx answers"],
    ["/nothing", "GET /nothing declares no 2xx content"],
    ["/absent", "GET /absent is not declared in the pinned specification"],
    ["__proto__", "GET __proto__ is not declared in the pinned specification"],
  ])("refuses %s", (path, message) => {
    expect(unwrapErr(datadogResponseDeclaration({ document: DOCUMENT, method: "GET", path })).message).toBe(message);
  });
});

/** The declared view at one place, thrown on a cut so an assertion never branches on which it got. */
function declaredAt({
  nodes,
}: {
  nodes: readonly { node: unknown; stack: readonly string[] }[];
}): Extract<DatadogSpecView, { kind: "declared" }> {
  const view = unwrap(datadogSpecView({ document: DOCUMENT, nodes }));
  if (view.kind !== "declared") {
    throw new Error(`expected a declared view, got a ${view.reason} cut`);
  }
  return view;
}

describe("datadogSpecView", () => {
  it("reads integer as number and an untyped enum by its values' kinds", () => {
    const view = declaredAt({
      nodes: [
        { node: { type: "integer" }, stack: [] },
        { node: { enum: ["a", 1] }, stack: [] },
      ],
    });
    expect([...view.primitives].toSorted()).toEqual(["number", "string"]);
    expect(view.nullable).toBe(false);
  });

  it("reads a null value in an untyped enum as the enum declaring null", () => {
    const view = declaredAt({ nodes: [{ node: { enum: ["a", null] }, stack: [] }] });
    expect([...view.primitives]).toEqual(["string"]);
    expect(view.nullable).toBe(true);
  });

  it("requires a key only where every merged object arm requires it", () => {
    const view = declaredAt({
      nodes: [
        { node: { properties: { a: {}, b: {} }, required: ["a", "b"], type: "object" }, stack: [] },
        { node: { properties: { a: {} }, required: ["a"], type: "object" }, stack: [] },
      ],
    });
    expect([...view.object!.required]).toEqual(["a"]);
  });

  it("merges array arms' items, free when any arm declares none", () => {
    const view = declaredAt({
      nodes: [
        { node: { items: { type: "string" }, type: "array" }, stack: [] },
        { node: { type: "array" }, stack: [] },
      ],
    });
    expect(view.array).toEqual({ free: true, items: [{ node: { type: "string" }, stack: [] }] });
  });

  it.each([
    ["a null type beside a string arm", { oneOf: [{ type: "string" }, { type: "null" }] }, ["string"], true],
    ["a list of primitive and null types", { type: ["integer", "string", "null"] }, ["number", "string"], true],
    ["a list of primitive types", { type: ["boolean", "number"] }, ["boolean", "number"], false],
  ])("reads %s as primitives, null never an arm", (_, node, primitives, nullable) => {
    const view = declaredAt({ nodes: [{ node, stack: [] }] });
    expect([...view.primitives].toSorted()).toEqual(primitives);
    expect(view.nullable).toBe(nullable);
  });

  it.each([
    ["a structural type beside another type", { properties: { a: {} }, type: ["object", "string"] }],
    ["an object type and null with no shape", { type: ["object", "null"] }],
  ])("cuts a type list naming %s as free", (_, node) => {
    expect(unwrap(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] }))).toEqual({
      kind: "cut",
      reason: "free",
    });
  });

  it("reads an object type beside null as that nullable object", () => {
    const node = { properties: { a: { type: "string" } }, required: ["a"], type: ["object", "null"] };
    const view = declaredAt({ nodes: [{ node, stack: [] }] });
    expect([...view.object!.required]).toEqual(["a"]);
    expect(view.nullable).toBe(true);
  });

  it.each([
    ["an empty schema", {}],
    ["a reference to a schema naming no type", { $ref: "#/components/schemas/Anything" }],
  ])("reads a map whose values are %s as a free map", (_, values) => {
    const document = { ...DOCUMENT, components: { schemas: { Anything: { description: "anything" } } } };
    const node = { additionalProperties: values, type: "object" };
    const view = unwrap(datadogSpecView({ document, nodes: [{ node, stack: [] }] }));
    expect(view).toEqual({
      array: null,
      kind: "declared",
      map: { free: true, values: [{ node: values, stack: [] }] },
      nullable: false,
      object: null,
      primitives: new Set(),
    });
  });

  it("reads an array type beside null as that nullable array", () => {
    const node = { items: { type: "string" }, type: ["null", "array"] };
    const view = declaredAt({ nodes: [{ node, stack: [] }] });
    expect(view.array).toEqual({ free: false, items: [{ node: { type: "string" }, stack: [] }] });
    expect(view.nullable).toBe(true);
  });

  it("holds a nullable composition's null beside a map as nullable, never as a conflicting arm", () => {
    const map = { additionalProperties: { type: "string" }, type: "object" };
    const view = declaredAt({ nodes: [{ node: { nullable: true, oneOf: [map] }, stack: [] }] });
    expect(view.map).toEqual({ free: false, values: [{ node: { type: "string" }, stack: [] }] });
    expect(view.nullable).toBe(true);
  });

  it("reads a structural type named twice as that one type", () => {
    const node = { additionalProperties: false, properties: { a: { type: "string" } }, type: ["object", "object"] };
    expect([...declaredAt({ nodes: [{ node, stack: [] }] }).object!.properties.keys()]).toEqual(["a"]);
  });

  it.each([
    ["null alone", { additionalProperties: true, type: ["null"] }, [], true],
    ["a string", { properties: { a: {} }, required: ["a"], type: "string" }, ["string"], false],
  ])(
    "reads %s beside object keywords as that type, since they constrain only an object",
    (_, node, kinds, nullable) => {
      const view = declaredAt({ nodes: [{ node, stack: [] }] });
      expect([...view.primitives]).toEqual(kinds);
      expect(view.nullable).toBe(nullable);
      expect([view.object, view.map]).toEqual([null, null]);
    },
  );

  it.each([
    ["an object", { enum: [{}] }],
    ["an array", { enum: ["a", []] }],
  ])("cuts an untyped enum carrying %s value as free", (_, node) => {
    expect(unwrap(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] }))).toEqual({
      kind: "cut",
      reason: "free",
    });
  });

  it.each([
    ["a free node beside a nullable composition's null", { nullable: true, oneOf: [{}] }, "free"],
    [
      "a map beside a scalar",
      { oneOf: [{ additionalProperties: true, type: "object" }, { type: "string" }] },
      "oneof-conflict",
    ],
    ["two free arms as the one shape they both are", { oneOf: [{ type: "object" }, { type: "object" }] }, "free"],
    [
      "two mixed arms as the one shape they both are",
      {
        oneOf: [
          { additionalProperties: true, properties: { a: {} } },
          { additionalProperties: true, properties: { b: {} } },
        ],
      },
      "mixed",
    ],
    [
      "a free arm beside a mixed one",
      { oneOf: [{ type: "object" }, { additionalProperties: true, properties: { a: {} } }] },
      "oneof-conflict",
    ],
    ["a free arm beside a scalar", { oneOf: [{ type: "object" }, { type: "string" }] }, "oneof-conflict"],
  ])("cuts %s", (_, node, reason) => {
    expect(unwrap(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] }))).toEqual({
      kind: "cut",
      reason,
    });
  });

  it("refuses compositions nested deeper than it expands, rather than overflowing", () => {
    let node: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 100_000; level += 1) {
      node = { oneOf: [node] };
    }
    expect(unwrapErr(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] })).message).toBe(
      "compositions nested past 64 levels, deeper than this generator expands",
    );
  });

  it.each([["__proto__"], ["constructor"]])(
    "refuses a reference to %s, never resolving an inherited member",
    (name) => {
      const node = { $ref: `#/components/schemas/${name}` };
      expect(unwrapErr(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] })).message).toBe(
        `the reference #/components/schemas/${name} resolves to nothing in the pinned specification`,
      );
    },
  );

  it("refuses a reference carrying a constraint beside it, never reading the component alone", () => {
    const node = { $ref: "#/components/schemas/Item", allOf: [{ type: "number" }] };
    expect(unwrapErr(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] })).message).toBe(
      "the reference #/components/schemas/Item carries allOf beside it, which OpenAPI 3.0 ignores and this refuses",
    );
  });

  it("reads a reference carrying only annotation beside it as its component, as OpenAPI 3.0 does", () => {
    const annotated = {
      $ref: "#/components/schemas/Item",
      default: "fallback",
      description: "d",
      examples: ["e"],
      nullable: true,
      xml: { name: "item" },
      "x-tag": 1,
    };
    const bare = { $ref: "#/components/schemas/Item" };
    expect(unwrap(datadogSpecView({ document: DOCUMENT, nodes: [{ node: annotated, stack: [] }] }))).toEqual(
      unwrap(datadogSpecView({ document: DOCUMENT, nodes: [{ node: bare, stack: [] }] })),
    );
  });

  it("refuses a oneOf beside an anyOf, never reading one and dropping the other", () => {
    const node = { anyOf: [{ required: ["b"], type: "object" }], oneOf: [{ required: ["a"], type: "object" }] };
    expect(unwrapErr(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] })).message).toBe(
      "a oneOf beside an anyOf, which this generator does not merge into one set of arms",
    );
  });

  it("refuses arms that YAML aliases double at every level, rather than expanding them without end", () => {
    let node: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 64; level += 1) {
      node = { oneOf: [node, node] };
    }
    expect(unwrapErr(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] })).message).toBe(
      "compositions expanding past 1024 arms, more than this generator merges",
    );
  });

  it("never counts a nullable composition's null toward the arm bound, since null is no arm", () => {
    const node = { nullable: true, oneOf: Array.from({ length: 1024 }, () => ({ type: "string" })) };
    const view = declaredAt({ nodes: [{ node, stack: [] }] });
    expect([...view.primitives]).toEqual(["string"]);
    expect(view.nullable).toBe(true);
  });

  it("holds 4096 aliased null arms as one nullable, never as arms past the bound", () => {
    let node: Record<string, unknown> = { type: "null" };
    for (let level = 0; level < 12; level += 1) {
      node = { oneOf: [node, node] };
    }
    const view = declaredAt({ nodes: [{ node: { oneOf: [node, { type: "string" }] }, stack: [] }] });
    expect([...view.primitives]).toEqual(["string"]);
    expect(view.nullable).toBe(true);
  });

  it("refuses null alone that YAML aliases double at every level, rather than walking it without end", () => {
    let node: Record<string, unknown> = { type: "null" };
    for (let level = 0; level < 63; level += 1) {
      node = { oneOf: [node, node] };
    }
    expect(unwrapErr(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] })).message).toBe(
      "compositions visiting past 65536 schemas, more than this generator expands",
    );
  });

  it.each([
    ["properties", { oneOf: [{ type: "string" }], properties: { a: { type: "string" } }, type: "object" }],
    ["required", { anyOf: [{ type: "object" }], required: ["a"] }],
    ["additionalProperties", { additionalProperties: false, oneOf: [{ type: "string" }] }],
    ["items", { items: { type: "string" }, oneOf: [{ type: "array" }] }],
  ])("refuses a composition beside its own %s, never dropping it", (keyword, node) => {
    expect(unwrapErr(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] })).message).toBe(
      `a oneOf or anyOf beside its own ${keyword}, which this generator does not merge into its arms`,
    );
  });

  it.each([
    [{ items: false, type: "array" }, "an items that is not a schema object, which this generator does not read"],
    [{ items: true, type: "array" }, "an items that is not a schema object, which this generator does not read"],
    [{ properties: [], type: "object" }, "a properties that is not an object of schemas"],
    [{ properties: { a: {} }, required: "a" }, "a required that is not a list of names"],
    [{ properties: { a: {} }, required: [1] }, "a required that is not a list of names"],
    [{ additionalProperties: "yes", type: "object" }, "an additionalProperties that is neither a schema nor a boolean"],
  ])(
    "refuses %j, whose structural keyword is not of the type it is read as, never reading it as absent",
    (node, why) => {
      expect(unwrapErr(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] })).message).toBe(why);
    },
  );

  it.each([
    ["string", { oneOf: [{ type: "number" }], type: "string" }, "number"],
    ["object", { oneOf: [{ items: { type: "string" }, type: "array" }], type: "object" }, "array"],
    ["string", { oneOf: [{ type: "string" }, { type: "null" }], type: "string" }, "null"],
    ["string", { oneOf: [{ nullable: true, type: "string" }], type: "string" }, "null"],
  ])("refuses a composition whose own %s type excludes an arm's kind", (_, node, kind) => {
    expect(unwrapErr(datadogSpecView({ document: DOCUMENT, nodes: [{ node, stack: [] }] })).message).toBe(
      `a oneOf or anyOf whose own type excludes an arm's ${kind}, which this generator does not narrow`,
    );
  });

  it("reads a null arm as within a nullable composition's own type", () => {
    const node = { nullable: true, oneOf: [{ type: "string" }, { type: "null" }], type: "string" };
    const view = declaredAt({ nodes: [{ node, stack: [] }] });
    expect([...view.primitives]).toEqual(["string"]);
    expect(view.nullable).toBe(true);
  });

  it("reads a composition whose own type every arm sits within as its arms alone", () => {
    const node = { oneOf: [{ $ref: "#/components/schemas/Item" }], type: ["object", "null"] };
    const view = declaredAt({ nodes: [{ node, stack: [] }] });
    expect([...view.object!.required]).toEqual(["id"]);
    expect(view.nullable).toBe(true);
  });

  it.each(["other.yaml#/Item", "#/components/schemas/Item/properties/id"])(
    "refuses a reference to anything but one whole component: %s",
    (ref) => {
      const nodes = [{ node: { $ref: ref }, stack: [] }];
      expect(unwrapErr(datadogSpecView({ document: DOCUMENT, nodes })).message).toBe(
        `the reference ${ref} is not a local component`,
      );
    },
  );
});
