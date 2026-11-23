/**
 * A miniature OpenAPI document in the shape Hex really publishes, plus the transport that serves it.
 *
 * Small on purpose: a unit test that pinned counts from the live 52-operation document would be asserting
 * Hex's release notes rather than this reader's behaviour. What it does carry is every shape the reader has
 * to get right — a `$ref` into `components`, a request body's own properties, a response nested one array
 * down, an operation with no JSON response at all, and the one path key Hex writes as a regular expression.
 */
import type { HexSpecError } from "../../../../atlas/hex/errors.js";
import type { HexSpecPin } from "../../../../atlas/hex/specPin.js";
import { ok, type Result } from "../../../../lib/result.js";

/** The document, as JSON text — the bytes a transport hands back. */
export const HEX_FIXTURE_DOCUMENT = JSON.stringify({
  components: {
    schemas: {
      Project: {
        properties: { id: { type: "string" }, owner: { $ref: "#/components/schemas/User" }, title: { type: "string" } },
        type: "object",
      },
      User: { properties: { email: { type: "string" }, id: { type: "string" } }, type: "object" },
    },
    securitySchemes: { bearerAuth: { scheme: "bearer", type: "http" } },
  },
  info: { title: "Hex API", version: "1.0.0" },
  openapi: "3.0.3",
  paths: {
    "/v1/cells/{cellId}/output": {
      get: {
        operationId: "GetCellOutput",
        parameters: [{ in: "path", name: "cellId" }],
        responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
      },
    },
    "/v1/projects": {
      get: {
        operationId: "ListProjects",
        parameters: [{ in: "query", name: "limit" }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  properties: { values: { items: { $ref: "#/components/schemas/Project" }, type: "array" } },
                  type: "object",
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "CreateProject",
        requestBody: {
          content: { "application/json": { schema: { properties: { title: { type: "string" } }, type: "object" } } },
        },
        responses: { "201": { description: "created" } },
      },
    },
    "/v1/projects/{projectId}/runs": {
      get: {
        operationId: "GetProjectRuns",
        responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
      },
    },
    "/v1/semantic-(projects|models)/{semanticProjectId}": {
      patch: { operationId: "UpdateSemanticProject", responses: { "200": { description: "ok" } } },
    },
  },
  security: [{ bearerAuth: [] }],
  servers: [{ url: "https://app.hex.tech/api" }],
});

/** A pin naming that document, so `verifyAndCompile` has something to compare a digest against. */
export const HEX_FIXTURE_PIN: HexSpecPin = {
  byteLength: Buffer.byteLength(HEX_FIXTURE_DOCUMENT, "utf8"),
  hosts: ["https://app.hex.tech/api"],
  id: "hex-public-api",
  operationCount: 5,
  pathCount: 4,
  securitySchemes: ["bearerAuth"],
  // Deliberately NOT the real digest of the text above: every sync in these tests therefore reports drift,
  // which is the behaviour worth exercising — a document served at an unversioned address MOVES, and the
  // atlas must compile it and record the movement rather than refuse.
  sha256: "0".repeat(64),
  title: "Hex API",
  url: "https://static.hex.site/openapi.json",
  version: "1.0.0",
};

/**
 * A transport that serves the fixture document without touching the network.
 *
 * A plain function passed in, never a mock — `.claude/rules/testing.md`.
 *
 * @returns the fixture bytes, always
 */
export async function fixtureTransport(): Promise<Result<string, HexSpecError>> {
  return ok(HEX_FIXTURE_DOCUMENT);
}
