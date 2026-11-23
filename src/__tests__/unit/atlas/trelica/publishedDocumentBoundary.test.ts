/**
 * The published-document boundary admits the node grammar the vendor's documents were measured to carry, takes
 * any path, component or property NAME as discovered surface, and refuses a node growing a key or losing a
 * required one, naming where.
 */
import { describe, expect, it } from "vitest";

import { trelicaPublishedDocumentBoundary } from "../../../../atlas/trelica/publishedDocumentBoundary.js";
import { BoundaryErrors } from "../../../../lib/boundary.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const ENDPOINT = "GET /api/<document>/docs/v1/swagger.json";

/** One operation carrying every key the measured documents put on one. */
const OPERATION = {
  description: "List the applications",
  operationId: "listApps",
  parameters: [{ description: "page size", in: "query", name: "take", required: false, schema: { type: "integer" } }],
  requestBody: {
    content: { "application/json": { example: { name: "x" }, schema: { $ref: "#/components/schemas/App" } } },
    required: true,
  },
  responses: {
    "200": {
      content: {
        "application/json": {
          schema: { items: { items: { items: { items: { items: { type: "string" } } } } }, type: "array" },
        },
      },
      description: "OK",
    },
    "401": { description: "Unauthorized" },
  },
  security: [{ oauth2: ["apps.read"] }],
  summary: "List applications",
  tags: ["Apps"],
};

/** A document carrying every node type and every schema keyword the measured documents carry. */
const DOCUMENT = {
  components: {
    schemas: {
      App: {
        additionalProperties: false,
        description: "an application",
        properties: {
          id: { format: "uuid", readOnly: true, type: "string" },
          kind: { allOf: [{ $ref: "#/components/schemas/Kind" }], nullable: true },
          seats: { maximum: 10, minimum: 0, type: "integer" },
        },
        required: ["id"],
        type: "object",
      },
      Kind: { default: "saas", enum: ["saas"], minLength: 1, oneOf: [], type: "string" },
    },
    securitySchemes: {
      bearer: { bearerFormat: "JWT", description: "a token", scheme: "bearer", type: "http" },
      oauth2: { description: "client credentials", flows: {}, type: "oauth2" },
    },
  },
  info: { contact: { email: "x" }, description: "the apps API", title: "SaaS Manager API", version: "v1" },
  openapi: "3.0.4",
  paths: { "/api/apps/v1": { delete: OPERATION, get: OPERATION, patch: OPERATION, post: OPERATION, put: OPERATION } },
  servers: [{ description: "US", url: "https://app.trelica.com" }],
  tags: [{ name: "Apps" }],
};

describe("trelicaPublishedDocumentBoundary", () => {
  it("admits every node type and schema keyword the measured documents carry, items five levels deep", () => {
    const admitted = unwrap(trelicaPublishedDocumentBoundary.parse({ value: DOCUMENT }));
    expect(Object.keys(admitted.paths)).toEqual(["/api/apps/v1"]);
    expect(admitted.info.title).toBe("SaaS Manager API");
  });

  it("takes a path it has never seen as discovered surface, not drift", () => {
    const grown = { ...DOCUMENT, paths: { ...DOCUMENT.paths, "/api/apps/v2/{appId}": { get: OPERATION } } };
    const admitted = unwrap(trelicaPublishedDocumentBoundary.parse({ value: grown }));
    expect(Object.keys(admitted.paths)).toEqual(["/api/apps/v1", "/api/apps/v2/{appId}"]);
  });

  it("refuses an operation growing a key, naming the operation it grew on", () => {
    const grown = { ...DOCUMENT, paths: { "/api/apps/v1": { get: { ...OPERATION, deprecated: true } } } };
    expect(unwrapErr(trelicaPublishedDocumentBoundary.parse({ value: grown }))).toEqual(
      BoundaryErrors.shapeChanged({
        drift: [
          {
            detail: 'new field "paths./api/apps/v1.get.deprecated"',
            kind: "new",
            path: "paths./api/apps/v1.get.deprecated",
          },
        ],
        endpoint: ENDPOINT,
      }),
    );
  });

  it("refuses a property schema carrying a keyword this version does not know", () => {
    const schemas = { App: { properties: { id: { anyOf: [] } }, type: "object" } };
    const grown = { ...DOCUMENT, components: { ...DOCUMENT.components, schemas } };
    const refused = unwrapErr(trelicaPublishedDocumentBoundary.parse({ value: grown }));
    expect(refused.code).toBe("BOUNDARY_SHAPE_CHANGED");
    expect(refused.message).toContain('new field "components.schemas.App.properties.id.anyOf"');
  });

  it("refuses a sixth items hop by name, so the parse's walk never reaches a schema nothing validated", () => {
    const deep = { items: { items: { items: { items: { items: { items: { properties: { secret: {} } } } } } } } };
    const schemas = { ...DOCUMENT.components.schemas, Deep: deep };
    const grown = { ...DOCUMENT, components: { ...DOCUMENT.components, schemas } };
    expect(unwrapErr(trelicaPublishedDocumentBoundary.parse({ value: grown })).message).toContain(
      'new field "components.schemas.Deep.items.items.items.items.items.items"',
    );
  });

  it("refuses a $ref that names anything but a component, which the parse would follow", () => {
    const schemas = { ...DOCUMENT.components.schemas, Elsewhere: { $ref: "#/info/contact" } };
    const grown = { ...DOCUMENT, components: { ...DOCUMENT.components, schemas } };
    expect(unwrapErr(trelicaPublishedDocumentBoundary.parse({ value: grown })).message).toContain(
      'field "components.schemas.Elsewhere.$ref" changed',
    );
  });

  it("refuses a document whose info has no title, the field OpenAPI requires", () => {
    const refused = unwrapErr(
      trelicaPublishedDocumentBoundary.parse({ value: { ...DOCUMENT, info: { version: "v1" } } }),
    );
    expect(refused).toEqual(
      BoundaryErrors.shapeChanged({
        drift: [{ detail: 'field "info.title" is missing', kind: "missing", path: "info.title" }],
        endpoint: ENDPOINT,
      }),
    );
  });

  it("refuses a document with no paths at all", () => {
    const { components, info, openapi, servers } = DOCUMENT;
    const refused = unwrapErr(
      trelicaPublishedDocumentBoundary.parse({ value: { components, info, openapi, servers } }),
    );
    expect(refused.message).toContain('field "paths" is missing');
  });

  it("refuses a body that is not JSON without quoting it", () => {
    const refused = unwrapErr(trelicaPublishedDocumentBoundary.parseJson({ text: "S3cr3t! Not Found" }));
    expect(refused).toEqual(BoundaryErrors.notJson({ endpoint: ENDPOINT }));
    expect(refused.message).not.toContain("S3cr3t");
  });
});
