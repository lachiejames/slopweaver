import { describe, expect, it } from "vitest";

import { AtlasCaptureErrors, atlasCaptureErrorLines } from "../../../../atlas/kit/captureErrors.js";
import {
  declaredParameterNames,
  firstServerUrl,
  jsonSuccessSchema,
  operationInputNames,
  readOpenApiDocument,
  requestBodyPropertyNames,
  schemaFieldPaths,
  securitySchemeNames,
} from "../../../../atlas/kit/openApiSurface.js";
import { isRecord } from "../../../../lib/parsers.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A document whose components carry the named schemas a test refers to. */
function documentWith({ schemas }: { schemas: Record<string, unknown> }): Record<string, unknown> {
  return { components: { schemas }, openapi: "3.0.0", paths: {} };
}

describe("schemaFieldPaths", () => {
  it("records every property path to the depth asked for, sorted", () => {
    const schema = {
      properties: { id: { type: "string" }, owner: { properties: { name: { properties: { first: {} } } } } },
    };

    expect(schemaFieldPaths({ depth: 1, document: {}, schema })).toEqual(["id", "owner", "owner.name"]);
    expect(schemaFieldPaths({ depth: 0, document: {}, schema })).toEqual(["id", "owner"]);
  });

  it("spends no depth on an array hop, so a list's records are reached at the first step", () => {
    const schema = {
      properties: { messages: { items: { properties: { status: {} } }, type: "array" } },
    };

    expect(schemaFieldPaths({ depth: 1, document: {}, schema })).toEqual(["messages", "messages[].status"]);
  });

  it("follows a local $ref and merges every composition branch", () => {
    const document = documentWith({
      schemas: { Base: { properties: { id: {} } }, Extra: { properties: { label: {} } } },
    });
    const schema = { allOf: [{ $ref: "#/components/schemas/Base" }, { $ref: "#/components/schemas/Extra" }] };

    expect(schemaFieldPaths({ depth: 2, document, schema })).toEqual(["id", "label"]);
  });

  it("reads a composed node's own properties beside its branches, as Twilio's memory `meta` declares", () => {
    const document = documentWith({ schemas: { Paging: { properties: { pageSize: {} } } } });
    const schema = { allOf: [{ $ref: "#/components/schemas/Paging" }], properties: { nextToken: {} } };

    expect(schemaFieldPaths({ depth: 1, document, schema })).toEqual(["nextToken", "pageSize"]);
  });

  it("reads a composed array's branches beside its own items", () => {
    const schema = {
      allOf: [{ items: { properties: { label: {} } }, type: "array" }],
      items: { properties: { id: {} } },
      type: "array",
    };

    expect(schemaFieldPaths({ depth: 1, document: {}, schema })).toEqual(["[].id", "[].label"]);
  });

  it("merges the branches of every composition keyword a node carries, not only the first", () => {
    const schema = { anyOf: [{ properties: { label: {} } }], oneOf: [{ properties: { id: {} } }] };

    expect(schemaFieldPaths({ depth: 1, document: {}, schema })).toEqual(["id", "label"]);
  });

  it("stops a schema that refers to itself through a property at the depth cap", () => {
    const document = documentWith({
      schemas: { Node: { properties: { child: { $ref: "#/components/schemas/Node" }, id: {} } } },
    });

    expect(schemaFieldPaths({ depth: 2, document, schema: { $ref: "#/components/schemas/Node" } })).toEqual([
      "child",
      "child.child",
      "child.child.child",
      "child.child.id",
      "child.id",
      "id",
    ]);
  });

  it("terminates on a schema that is an array of itself, which spends no depth", () => {
    const document = documentWith({
      schemas: { Tree: { items: { $ref: "#/components/schemas/Tree" }, type: "array" } },
    });

    expect(schemaFieldPaths({ depth: 3, document, schema: { $ref: "#/components/schemas/Tree" } })).toEqual([]);
  });

  it("terminates on the recursive JSON-value shape, cutting the branch that would re-enter it", () => {
    const document = documentWith({
      schemas: {
        JsonValue: {
          oneOf: [
            { type: "string" },
            { items: { $ref: "#/components/schemas/JsonValue" }, type: "array" },
            { properties: { key: {} } },
          ],
        },
      },
    });

    expect(schemaFieldPaths({ depth: 1, document, schema: { $ref: "#/components/schemas/JsonValue" } })).toEqual([
      "key",
    ]);
  });

  it("returns nothing for an operation that declares no schema, and for an unresolvable reference", () => {
    expect(schemaFieldPaths({ depth: 3, document: {}, schema: null })).toEqual([]);
    expect(schemaFieldPaths({ depth: 3, document: {}, schema: { $ref: "#/components/schemas/Absent" } })).toEqual([]);
    expect(schemaFieldPaths({ depth: 3, document: {}, schema: { $ref: "https://elsewhere/schema.json" } })).toEqual([]);
  });
});

describe("jsonSuccessSchema", () => {
  const document = documentWith({ schemas: { Item: { properties: { id: {} } } } });

  it("takes the first code, in the caller's order, that declares a JSON schema", () => {
    const operation = {
      responses: {
        "200": { content: { "text/plain": { schema: { type: "string" } } } },
        "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } } },
        "202": { content: { "application/json": { schema: { type: "object" } } } },
      },
    };

    expect(jsonSuccessSchema({ codes: ["200", "201", "202"], document, operation })).toEqual({
      $ref: "#/components/schemas/Item",
    });
    expect(jsonSuccessSchema({ codes: ["202", "201"], document, operation })).toEqual({ type: "object" });
  });

  it("follows a response declared by reference", () => {
    const withResponse = {
      ...document,
      components: { responses: { Ok: { content: { "application/json": { schema: { type: "array" } } } } } },
    };
    const operation = { responses: { "200": { $ref: "#/components/responses/Ok" } } };

    expect(jsonSuccessSchema({ codes: ["200"], document: withResponse, operation })).toEqual({ type: "array" });
  });

  it("returns null when no listed code carries one, or the operation declares no responses", () => {
    const operation = { responses: { "200": { content: { "application/json": {} } }, "204": {} } };

    expect(jsonSuccessSchema({ codes: ["200", "204", "404"], document, operation })).toBe(null);
    expect(jsonSuccessSchema({ codes: ["200"], document, operation: {} })).toBe(null);
  });
});

describe("operation inputs", () => {
  const document = documentWith({ schemas: { Body: { properties: { To: {}, Body: {} } } } });
  const operation = {
    parameters: [{ in: "path", name: "Sid" }, { in: "query", name: "PageSize" }, { name: "" }, "not-an-object"],
    requestBody: {
      content: {
        "application/json": { schema: { properties: { json: {} } } },
        "application/x-www-form-urlencoded": { schema: { $ref: "#/components/schemas/Body" } },
      },
    },
  };

  it("names each declared parameter once, sorted, skipping an unnamed or malformed entry", () => {
    expect(declaredParameterNames({ operation })).toEqual(["PageSize", "Sid"]);
    expect(declaredParameterNames({ operation: { parameters: "nope" } })).toEqual([]);
  });

  it("reads the body under the first content type the caller lists, in declaration order", () => {
    expect(
      requestBodyPropertyNames({
        contentTypes: ["application/x-www-form-urlencoded", "application/json"],
        document,
        operation,
      }),
    ).toEqual(["To", "Body"]);
    expect(requestBodyPropertyNames({ contentTypes: ["application/json"], document, operation })).toEqual(["json"]);
    expect(requestBodyPropertyNames({ contentTypes: ["multipart/form-data"], document, operation })).toEqual([]);
    expect(requestBodyPropertyNames({ contentTypes: ["application/json"], document, operation: {} })).toEqual([]);
  });

  it("unions the parameters and the body, sorted and deduplicated", () => {
    const overlapping = { ...operation, parameters: [{ name: "To" }, { name: "Sid" }] };

    expect(
      operationInputNames({ contentTypes: ["application/x-www-form-urlencoded"], document, operation: overlapping }),
    ).toEqual(["Body", "Sid", "To"]);
  });
});

describe("securitySchemeNames and firstServerUrl", () => {
  it("names every scheme a requirement list keys on, sorted and deduplicated", () => {
    expect(
      securitySchemeNames({ requirements: [{ apiKey: [], oauth: ["read"] }, { oauth: [] }, "not-an-object"] }),
    ).toEqual(["apiKey", "oauth"]);
    expect(securitySchemeNames({ requirements: undefined })).toEqual([]);
  });

  it("returns the first server with a usable url, and null when there is none", () => {
    expect(
      firstServerUrl({ servers: [{ url: "" }, { description: "no url" }, { url: "https://api.example.com" }] }),
    ).toBe("https://api.example.com");
    expect(firstServerUrl({ servers: [{ url: "" }] })).toBe(null);
    expect(firstServerUrl({ servers: undefined })).toBe(null);
  });
});

describe("readOpenApiDocument", () => {
  interface Row {
    readonly host: string | null;
    readonly id: string;
    readonly schemes: readonly string[];
  }

  /** One row per method on a path item, inheriting the document's host (bar `/local`) and security. */
  function read({ document }: { document: unknown }): ReturnType<typeof readOpenApiDocument<Row>> {
    return readOpenApiDocument<Row>({
      document,
      hostOf: ({ operation }) => operation.host,
      operationsOnPath: ({ item, path, documentHost, documentSecurity }) =>
        Object.keys(isRecord(item) ? item : {}).map((method) => ({
          host: path === "/local" ? null : documentHost,
          id: `${method.toUpperCase()} ${path}`,
          schemes: documentSecurity,
        })),
      securitySchemesOf: ({ operation }) => operation.schemes,
      sortKeyOf: ({ operation }) => operation.id,
      specId: "example-v1",
    });
  }

  it("refuses a document that is not an object, and one that declares no paths, naming the spec", () => {
    expect(unwrapErr(read({ document: "[]" }))).toEqual(
      atlasCaptureErrorLines({ error: AtlasCaptureErrors.openApiNotObject({ specId: "example-v1" }) }),
    );
    expect(unwrapErr(read({ document: { openapi: "3.0.0" } }))).toEqual(
      atlasCaptureErrorLines({ error: AtlasCaptureErrors.openApiNoPaths({ specId: "example-v1" }) }),
    );
  });

  it("folds every path item into sorted operations with deduplicated hosts and schemes", () => {
    const surface = unwrap(
      read({
        document: {
          info: { title: "Example API" },
          paths: { "/a": { get: {}, post: {} }, "/b": { get: {} }, "/local": { get: {} } },
          security: [{ oauth: [] }, { apiKey: [] }],
          servers: [{ url: "https://api.example.com" }],
        },
      }),
    );

    expect(surface.operations.map((operation) => operation.id)).toEqual(["GET /a", "GET /b", "GET /local", "POST /a"]);
    expect(surface.hosts).toEqual(["https://api.example.com"]);
    expect(surface.securitySchemes).toEqual(["apiKey", "oauth"]);
    expect(surface.pathCount).toBe(3);
    expect(surface.title).toBe("Example API");
    expect(surface.specId).toBe("example-v1");
  });

  it("sorts operations by code unit, never a locale's collation, so an upper-case path sorts before a lower-case one on every machine", () => {
    const surface = unwrap(read({ document: { paths: { "/accounts": { get: {} }, "/Accounts": { get: {} } } } }));

    expect(surface.operations.map((operation) => operation.id)).toEqual(["GET /Accounts", "GET /accounts"]);
  });

  it("falls back to the spec id for a title, and reports no host when the document declares none", () => {
    const surface = unwrap(read({ document: { info: { version: "1" }, paths: {} } }));

    expect(surface.title).toBe("example-v1");
    expect(surface.operations).toEqual([]);
    expect(surface.hosts).toEqual([]);
    expect(surface.pathCount).toBe(0);
  });
});
