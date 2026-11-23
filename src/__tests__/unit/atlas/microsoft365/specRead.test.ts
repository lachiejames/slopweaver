import { describe, expect, it } from "vitest";

import { readMicrosoft365Surface } from "../../../../atlas/microsoft365/specRead.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/**
 * A miniature Graph document with the four shapes that actually decide whether the reader is right: a shared
 * parameter reached by `$ref`, a response reached by `$ref` into `components.responses`, a collection wrapper
 * whose entity lives under `value.items`, and an `allOf` base carrying half the entity's fields.
 */
const SPEC = `
openapi: 3.0.4
paths:
  /users:
    get:
      operationId: users.user.ListUser
      summary: List users
      tags:
        - users.user
      parameters:
        - $ref: '#/components/parameters/top'
        - name: $select
          in: query
      responses:
        '2XX':
          $ref: '#/components/responses/microsoft.graph.userCollectionResponse'
    post:
      operationId: users.user.CreateUser
      responses:
        '2XX':
          $ref: '#/components/responses/microsoft.graph.userCollectionResponse'
  /users/{user-id}:
    get:
      operationId: users.user.GetUser
      parameters:
        - name: user-id
          in: path
      responses:
        '2XX':
          $ref: '#/components/responses/microsoft.graph.userCollectionResponse'
  /auditLogs/signIns:
    get:
      operationId: auditLogs.ListSignIns
      responses: {}
components:
  parameters:
    top:
      name: $top
      in: query
  responses:
    microsoft.graph.userCollectionResponse:
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/microsoft.graph.userCollectionResponse'
  schemas:
    microsoft.graph.userCollectionResponse:
      properties:
        value:
          items:
            $ref: '#/components/schemas/microsoft.graph.user'
    microsoft.graph.user:
      allOf:
        - $ref: '#/components/schemas/microsoft.graph.directoryObject'
        - properties:
            displayName:
              type: string
            accountEnabled:
              type: boolean
    microsoft.graph.directoryObject:
      properties:
        id:
          type: string
`;

describe("readMicrosoft365Surface", () => {
  it("reads every operation across every method", () => {
    const surface = unwrap(readMicrosoft365Surface({ text: SPEC }));
    expect(surface.rows.map((row) => row.providerId).toSorted()).toEqual([
      "GET /auditLogs/signIns",
      "GET /users",
      "GET /users/{user-id}",
      "POST /users",
    ]);
  });

  it("resolves a parameter reached by $ref, which is where paging is declared", () => {
    const surface = unwrap(readMicrosoft365Surface({ text: SPEC }));
    const list = surface.rows.find((row) => row.providerId === "GET /users")!;
    expect(list.queryParams).toEqual(["$select", "$top"]);
    expect(list.pagination).toBe("odata-top-skip");
  });

  it("descends through the collection wrapper to the entity, and merges its allOf base", () => {
    const surface = unwrap(readMicrosoft365Surface({ text: SPEC }));
    const list = surface.rows.find((row) => row.providerId === "GET /users")!;
    expect(list.responseSchema).toBe("microsoft.graph.user");
    expect(list.responseFields).toEqual(["accountEnabled", "displayName", "id"]);
  });

  it("keeps a path parameter separate from a query one", () => {
    const surface = unwrap(readMicrosoft365Surface({ text: SPEC }));
    const one = surface.rows.find((row) => row.providerId === "GET /users/{user-id}")!;
    expect(one.pathParams).toEqual(["user-id"]);
    expect(one.queryParams).toEqual([]);
  });

  it("carries the disposition its rule decided onto every row", () => {
    const surface = unwrap(readMicrosoft365Surface({ text: SPEC }));
    const audit = surface.rows.find((row) => row.providerId === "GET /auditLogs/signIns")!;
    const write = surface.rows.find((row) => row.providerId === "POST /users")!;
    expect(audit.disposition).toBe("voluminous");
    expect(write.disposition).toBe("excluded");
    expect(write.dispositionRuleId).toBe("mutation");
  });

  it("holds no response fields when the operation declares no success schema", () => {
    const surface = unwrap(readMicrosoft365Surface({ text: SPEC }));
    const audit = surface.rows.find((row) => row.providerId === "GET /auditLogs/signIns")!;
    expect(audit.responseSchema).toBeNull();
    expect(audit.responseFields).toEqual([]);
  });

  it("counts what it read rather than what it hoped to read", () => {
    const surface = unwrap(readMicrosoft365Surface({ text: SPEC }));
    expect(surface.census.pathCount).toBe(3);
    expect(surface.census.operationCount).toBe(4);
    expect(surface.census.methodCounts["get"]).toBe(3);
    expect(surface.census.methodCounts["post"]).toBe(1);
    expect(surface.census.rootCount).toBe(2);
    expect(surface.census.schemaCount).toBe(3);
  });

  it("names a root this build does not declare rather than dropping it silently", () => {
    const surface = unwrap(
      readMicrosoft365Surface({
        text: "openapi: 3.0.4\npaths:\n  /brandNewWorkload:\n    get:\n      responses: {}\n",
      }),
    );
    expect(surface.unknownRoots).toEqual(["brandNewWorkload"]);
    expect(surface.rows).toEqual([]);
  });

  it("names a path key with no segment at all by the whole key, so the refusal still says what was declared", () => {
    const surface = unwrap(
      readMicrosoft365Surface({ text: "openapi: 3.0.4\npaths:\n  noLeadingSlash:\n    get:\n      responses: {}\n" }),
    );
    expect(surface.unknownRoots).toEqual(["noLeadingSlash"]);
  });

  it("tallies only the methods the document declares, with no zero entry for one it does not", () => {
    const surface = unwrap(readMicrosoft365Surface({ text: SPEC }));
    expect(surface.census.methodCounts).toEqual({ get: 3, post: 1 });
  });

  it("reads the success schema off a `200` when the operation declares no `2XX` range", () => {
    const text = SPEC.replace(
      "in: path\n      responses:\n        '2XX':",
      "in: path\n      responses:\n        '200':",
    );
    // The witness that the one operation really declares only a `200` now, so the read below is not the `2XX` one.
    expect(text).toContain("in: path\n      responses:\n        '200':");
    const surface = unwrap(readMicrosoft365Surface({ text }));
    const one = surface.rows.find((row) => row.providerId === "GET /users/{user-id}")!;
    expect(one.responseSchema).toBe("microsoft.graph.user");
  });

  it("refuses a document with no paths section", () => {
    const read = readMicrosoft365Surface({ text: "openapi: 3.0.4\n" });
    expect(unwrapErr(read)).toEqual(["the pinned Microsoft Graph specification declares no `paths` section"]);
  });
});
