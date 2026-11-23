import { describe, expect, it } from "vitest";

import { TrelicaAtlasErrors } from "../../../../atlas/trelica/errors.js";
import {
  type TrelicaPublishedDocumentBody,
  trelicaPublishedDocumentBoundary,
} from "../../../../atlas/trelica/publishedDocumentBoundary.js";
import {
  compileTrelicaPublishedSurface,
  parseTrelicaPublishedDocument,
  TRELICA_PUBLISHED_DOCUMENTS,
  trelicaPublishedDocumentPath,
} from "../../../../atlas/trelica/publishedSpec.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

/**
 * A document shaped exactly like the vendor's own: an operation with a path parameter, a query parameter,
 * a `$ref`'d array response, and a security requirement. Admitted through the real boundary, so a fixture that
 * drifts from what the boundary reads fails here rather than testing a shape no tenant could hand the parse.
 *
 * The cases refusing a document that is not an object, has no paths or has no info object went out with the
 * hand-written checks that raised them; the boundary refuses each now, and `publishedDocumentBoundary.test.ts`
 * holds them.
 */
const APPS_DOCUMENT: TrelicaPublishedDocumentBody = unwrap(
  trelicaPublishedDocumentBoundary.parse({
    value: {
      components: {
        schemas: {
          App: { properties: { id: {}, name: {}, vendorId: {} }, type: "object" },
          AppPage: { items: { $ref: "#/components/schemas/App" }, type: "array" },
        },
        securitySchemes: { bearerAuth: { scheme: "bearer", type: "http" }, oauth2: { type: "oauth2" } },
      },
      info: { title: "SaaS Manager API", version: "v1" },
      openapi: "3.0.4",
      paths: {
        "/api/apps/v1": {
          get: {
            operationId: "listApps",
            parameters: [
              { in: "query", name: "take" },
              { in: "query", name: "cursor" },
            ],
            responses: {
              "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/AppPage" } } } },
            },
            security: [{ oauth2: [] }],
            summary: "List applications",
          },
          post: {
            requestBody: { content: { "application/json": { schema: { properties: { name: {}, status: {} } } } } },
            responses: { "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/App" } } } } },
          },
        },
        "/api/apps/v1/{appId}": {
          get: { parameters: [{ in: "path", name: "appId" }], responses: { "200": {} } },
        },
      },
      servers: [{ url: "https://trelica.app" }, { url: "https://trelica.eu" }],
    },
  }),
);

describe("trelicaPublishedDocumentPath", () => {
  it("addresses the document the vendor's own client names", () => {
    expect(trelicaPublishedDocumentPath({ document: "apps" })).toBe("/api/apps/docs/v1/swagger.json");
  });

  it("names four documents, which is the declared denominator", () => {
    expect([...TRELICA_PUBLISHED_DOCUMENTS]).toEqual(["apps", "auth", "flow", "people"]);
  });
});

describe("parseTrelicaPublishedDocument", () => {
  it("reads every operation across every path item", () => {
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: APPS_DOCUMENT }));
    expect(parsed.operations.length).toBe(3);
    expect(parsed.operations.map((operation) => `${operation.httpMethod} ${operation.path}`)).toEqual([
      "GET /api/apps/v1",
      "POST /api/apps/v1",
      "GET /api/apps/v1/{appId}",
    ]);
  });

  it("splits parameters by where they travel", () => {
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: APPS_DOCUMENT }));
    const list = parsed.operations.find((operation) => operation.operationId === "listApps")!;
    const byId = parsed.operations.find((operation) => operation.path === "/api/apps/v1/{appId}")!;
    expect([...list.queryParams]).toEqual(["cursor", "take"]);
    expect([...list.pathParams]).toEqual([]);
    expect([...byId.pathParams]).toEqual(["appId"]);
  });

  it("follows a $ref through an array into the item's own property names", () => {
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: APPS_DOCUMENT }));
    const list = parsed.operations.find((operation) => operation.operationId === "listApps")!;
    expect([...list.responseFields]).toEqual(["id", "name", "vendorId"]);
  });

  it("reads a request body's own property names", () => {
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: APPS_DOCUMENT }));
    const create = parsed.operations.find((operation) => operation.httpMethod === "POST")!;
    expect([...create.bodyParams]).toEqual(["name", "status"]);
  });

  it("falls back to every scheme the document defines when an operation declares none", () => {
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: APPS_DOCUMENT }));
    const create = parsed.operations.find((operation) => operation.httpMethod === "POST")!;
    expect([...create.security]).toEqual(["bearerAuth", "oauth2"]);
  });

  it("takes the operation's own security when it declares one", () => {
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: APPS_DOCUMENT }));
    const list = parsed.operations.find((operation) => operation.operationId === "listApps")!;
    expect([...list.security]).toEqual(["oauth2"]);
  });

  it("takes the lowest 2xx when the document declares no 200", () => {
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: APPS_DOCUMENT }));
    const create = parsed.operations.find((operation) => operation.httpMethod === "POST")!;
    expect([...create.responseFields]).toEqual(["id", "name", "vendorId"]);
  });

  it("records an absent summary and operation id as null rather than an empty string", () => {
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: APPS_DOCUMENT }));
    const create = parsed.operations.find((operation) => operation.httpMethod === "POST")!;
    expect(create.summary).toBe(null);
    expect(create.operationId).toBe(null);
  });

  it("keeps the servers the document nominates, which name the vendor's regions and no customer", () => {
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: APPS_DOCUMENT }));
    expect([...parsed.servers]).toEqual(["https://trelica.app", "https://trelica.eu"]);
  });

  it("reads the document's own title and version, as the document states them", () => {
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: APPS_DOCUMENT }));
    expect(parsed.title).toBe("SaaS Manager API");
    expect(parsed.version).toBe("v1");
  });

  it("refuses a blank title, rather than titling the document after its path", () => {
    const parsed = parseTrelicaPublishedDocument({
      document: "apps",
      json: { ...APPS_DOCUMENT, info: { title: "  ", version: "v1" } },
    });
    const refused = unwrapErr(parsed);
    expect(refused).toEqual(
      TrelicaAtlasErrors.documentUnreadable({ detail: "the document's info declares no title", document: "apps" }),
    );
    expect(refused.message).toBe("the apps API document could not be read: the document's info declares no title");
  });

  it("refuses a blank version, rather than calling it unknown", () => {
    const parsed = parseTrelicaPublishedDocument({
      document: "people",
      json: { ...APPS_DOCUMENT, info: { title: "SaaS Manager API", version: "" } },
    });
    const refused = unwrapErr(parsed);
    expect(refused).toEqual(
      TrelicaAtlasErrors.documentUnreadable({ detail: "the document's info declares no version", document: "people" }),
    );
    expect(refused.message).toBe("the people API document could not be read: the document's info declares no version");
  });

  it("reads a JSON media type that declares no schema as declaring no fields", () => {
    const parsed = unwrap(
      parseTrelicaPublishedDocument({
        document: "apps",
        json: {
          ...APPS_DOCUMENT,
          paths: { "/api/apps/v1": { get: { responses: { "200": { content: { "application/json": {} } } } } } },
        },
      }),
    );
    expect([...parsed.operations[0]!.responseFields]).toEqual([]);
  });

  it("refuses a schema referencing a component the document does not define, rather than reading no fields", () => {
    const get = {
      responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Missing" } } } } },
    };
    const parsed = parseTrelicaPublishedDocument({
      document: "apps",
      json: { ...APPS_DOCUMENT, paths: { "/api/apps/v1": { get } } },
    });
    const detail = "a schema it reads references Missing, which the document does not define";
    expect(unwrapErr(parsed)).toEqual(TrelicaAtlasErrors.documentUnreadable({ detail, document: "apps" }));
    expect(unwrapErr(parsed).message).toBe(`the apps API document could not be read: ${detail}`);
  });

  it("reads a document with no components as defining no security schemes", () => {
    const { info } = APPS_DOCUMENT;
    const paths = { "/api/apps/v1/{appId}": { get: { responses: { "200": {} } } } };
    const parsed = unwrap(parseTrelicaPublishedDocument({ document: "apps", json: { info, paths } }));
    expect([...parsed.securitySchemes]).toEqual([]);
    expect([...parsed.servers]).toEqual([]);
  });
});

describe("compileTrelicaPublishedSurface", () => {
  it("publishes the documents that parse and records the ones that do not", async () => {
    const surface = await compileTrelicaPublishedSurface({
      fetchDocument: async ({ document }) =>
        document === "apps"
          ? ok(APPS_DOCUMENT)
          : err(TrelicaAtlasErrors.documentUnreadable({ detail: "the tenant answered HTTP 404", document })),
    });
    expect(surface.documents.length).toBe(1);
    expect(surface.unreadable.map((entry) => entry.document)).toEqual(["auth", "flow", "people"]);
  });

  it("records an admitted document with a blank title as unreadable, publishing none of its operations", async () => {
    const surface = await compileTrelicaPublishedSurface({
      fetchDocument: async () => ok({ ...APPS_DOCUMENT, info: { title: "", version: "v1" } }),
    });
    expect(surface.documents).toEqual([]);
    expect(surface.unreadable.length).toBe(4);
    expect(surface.unreadable[0]).toEqual({
      document: "apps",
      reason: "the apps API document could not be read: the document's info declares no title",
    });
  });
});
