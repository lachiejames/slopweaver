/**
 * Reading one Clerk document into operation rows and webhook-event rows.
 *
 * Written against small documents rather than the pinned 1.6 MB set, deliberately: every judgement here —
 * the wire path, the `$ref`-resolved parameters, the paginated envelope, the webhook payload — is a decision
 * this repository made, and a test that needed the real documents would be a test nothing runs.
 */
import { describe, expect, it } from "vitest";

import { clerkApiForDocument, readClerkDocument } from "../../../../atlas/clerk/specRead.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A Backend-API-shaped document: a server carrying `/v1`, a `$ref` parameter, and a paginated envelope. */
const BAPI = `
openapi: 3.0.3
servers:
  - url: https://api.clerk.com/v1
security:
  - bearerAuth: []
paths:
  /users:
    get:
      operationId: GetUserList
      summary: List all users
      tags: [Users]
      parameters:
        - $ref: '#/components/parameters/Limit'
        - name: email_address
          in: query
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserList'
  /users/{user_id}:
    parameters:
      - name: user_id
        in: path
    get:
      operationId: GetUser
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
components:
  parameters:
    Limit:
      name: limit
      in: query
  schemas:
    UserList:
      properties:
        data:
          items:
            $ref: '#/components/schemas/User'
        total_count: {}
    User:
      allOf:
        - $ref: '#/components/schemas/Base'
        - properties:
            email_addresses: {}
    Base:
      properties:
        id: {}
        object: {}
`;

/** A webhooks-shaped document: no paths at all, and its events under the `x-webhooks` extension. */
const WEBHOOKS = `
openapi: 3.0.3
servers:
  - url: https://api.clerk.dev/v1
x-webhooks:
  user.created:
    post:
      description: User created
      requestBody:
        content:
          application/json:
            schema:
              allOf:
                - $ref: '#/components/schemas/Envelope'
                - properties:
                    data:
                      $ref: '#/components/schemas/User'
components:
  schemas:
    Envelope:
      properties:
        object: {}
        type: {}
    User:
      properties:
        email_addresses: {}
        id: {}
`;

describe("readClerkDocument over a Backend-API-shaped document", () => {
  const read = unwrap(readClerkDocument({ document: "bapi", text: BAPI }));

  it("prepends the server's own prefix, so a row keys on the WIRE path", () => {
    expect(read.operations.map((row) => row.wirePath)).toEqual(["/v1/users", "/v1/users/{user_id}"]);
  });

  it("keys a row on the method, the API and the wire path", () => {
    expect(read.operations[0]!.providerId).toBe("GET bapi:/v1/users");
  });

  it("resolves a query parameter declared only by $ref, which a naive reader drops", () => {
    expect(read.operations[0]!.queryParams).toEqual(["email_address", "limit"]);
    expect(read.operations[0]!.pagination).toBe("limit-only");
  });

  it("merges a path-level parameter into the operation that hangs off it", () => {
    expect(read.operations[1]!.pathParams).toEqual(["user_id"]);
  });

  it("descends through the paginated envelope to the entity, and merges its allOf base", () => {
    expect(read.operations[0]!.responseSchema).toBe("User");
    expect(read.operations[0]!.responseFields).toEqual(["email_addresses", "id", "object"]);
  });

  it("falls back to the document's own security when an operation declares none", () => {
    expect(read.operations[0]!.security).toEqual(["bearerAuth"]);
  });

  it("keeps the vendor's own operation id and summary", () => {
    expect(read.operations[0]!.operationId).toBe("GetUserList");
    expect(read.operations[0]!.summary).toBe("List all users");
  });

  it("measures its own census rather than trusting the document", () => {
    expect(read.census.operationCount).toBe(2);
    expect(read.census.pathCount).toBe(2);
    expect(read.census.schemaCount).toBe(3);
    expect(read.census.methodCounts["get"]).toBe(2);
  });
});

/** Success responses declared only as 201 or 2XX, a null 200 beside a 201, and an envelope with no items `$ref`. */
const SUCCESS_STATUSES = `
openapi: 3.0.3
paths:
  /invitations:
    post:
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Invitation'
    get:
      responses:
        '2XX':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Bare'
  /domains:
    get:
      responses:
        '200':
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Invitation'
    delete:
      responses:
        '204': {}
components:
  schemas:
    Invitation:
      properties:
        id: {}
    Bare:
      properties:
        data:
          items: {}
`;

describe("readClerkDocument over success statuses other than 200", () => {
  const read = unwrap(readClerkDocument({ document: "bapi", text: SUCCESS_STATUSES }));
  const schemaOf = ({ providerId }: { providerId: string }): string | null =>
    read.operations.find((row) => row.providerId === providerId)!.responseSchema;

  it("takes the 201 schema when that is the first success the operation declares", () => {
    expect(schemaOf({ providerId: "POST bapi:/invitations" })).toBe("Invitation");
  });

  it("skips a 200 declared with no body and reads the 201 beside it", () => {
    expect(schemaOf({ providerId: "GET bapi:/domains" })).toBe("Invitation");
  });

  it("keeps an envelope whose items name no schema as the entity itself", () => {
    expect(schemaOf({ providerId: "GET bapi:/invitations" })).toBe("Bare");
  });

  it("names no response schema for an operation declaring none of 200, 201 or 2XX", () => {
    expect(schemaOf({ providerId: "DELETE bapi:/domains" })).toBe(null);
  });

  it("counts each method in the order the walk first meets it", () => {
    expect(read.census.methodCounts).toStrictEqual({ delete: 1, get: 2, post: 1 });
    expect(Object.keys(read.census.methodCounts)).toStrictEqual(["get", "post", "delete"]);
  });
});

describe("readClerkDocument over a webhooks-shaped document", () => {
  const read = unwrap(readClerkDocument({ document: "webhooks", text: WEBHOOKS }));

  it("declares no operation at all, because the document declares no path", () => {
    expect(read.operations).toEqual([]);
  });

  it("reads the event and its own description", () => {
    expect(read.webhookEvents.length).toBe(1);
    expect(read.webhookEvents[0]!.event).toBe("user.created");
    expect(read.webhookEvents[0]!.description).toBe("User created");
  });

  it("takes the payload's DATA schema rather than the shared envelope every event carries", () => {
    expect(read.webhookEvents[0]!.payloadSchema).toBe("User");
    expect(read.webhookEvents[0]!.payloadFields).toEqual(["email_addresses", "id"]);
  });

  it("counts its events in its own census", () => {
    expect(read.census.webhookEventCount).toBe(1);
  });
});

describe("readClerkDocument refusals", () => {
  it("refuses a document that is not YAML at all, naming which one", () => {
    const read = readClerkDocument({ document: "fapi", text: "\t- [unclosed" });
    expect(unwrapErr(read)).toEqual([
      "the pinned Clerk fapi document could not be parsed: Tabs are not allowed as indentation at line 1, column 1:" +
        "\n\n\t- [unclosed\n^\n",
    ]);
  });

  it("refuses a document that parses to something other than a mapping", () => {
    const read = readClerkDocument({ document: "fapi", text: "- one\n- two\n" });
    expect(unwrapErr(read)).toEqual(["the pinned Clerk fapi document is not a YAML mapping"]);
  });

  it("reads a document with no paths section as empty rather than refusing", () => {
    const read = unwrap(readClerkDocument({ document: "platform", text: "openapi: 3.0.3\n" }));
    expect(read.operations).toEqual([]);
    expect(read.census.pathCount).toBe(0);
  });
});

describe("clerkApiForDocument", () => {
  it("names the Frontend API from the document alone", () => {
    expect(clerkApiForDocument({ document: "fapi", wirePath: "/v1/api_keys" })).toBe("fapi");
  });

  it("splits the two APIs sharing api.clerk.com on the platform path prefix", () => {
    expect(clerkApiForDocument({ document: "bapi", wirePath: "/v1/users" })).toBe("bapi");
    expect(clerkApiForDocument({ document: "bapi", wirePath: "/v1/platform/applications" })).toBe("platform");
  });
});
