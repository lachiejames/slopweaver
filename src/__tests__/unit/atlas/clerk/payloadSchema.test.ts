/*
 * Which named schema a Clerk success response or webhook payload declares, and the field names it carries,
 * read off hand-built OpenAPI-shaped nodes.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_SCHEMA_DEPTH,
  resolveFields,
  successEntitySchema,
  webhookPayloadSchema,
} from "../../../../atlas/clerk/payloadSchema.js";

/** A components map with one entity inheriting a base, a paginated envelope over it, and one other entity. */
const SCHEMAS: Record<string, unknown> = {
  Base: { properties: { id: {}, object: {} } },
  Session: { properties: { status: {} } },
  User: { allOf: [{ $ref: "#/components/schemas/Base" }, { properties: { email_addresses: {}, id: {} } }] },
  UserList: { properties: { data: { items: { $ref: "#/components/schemas/User" } }, total_count: {} } },
};

/** A response or request-body node whose JSON schema references the named component. */
function jsonBody({ ref }: { ref: string }): Record<string, unknown> {
  return { content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } };
}

describe("MAX_SCHEMA_DEPTH", () => {
  it("follows inheritance eight schema nodes deep", () => {
    expect(MAX_SCHEMA_DEPTH).toBe(8);
  });
});

describe("successEntitySchema", () => {
  it("prefers a 200 over a 201 and descends through a paginated envelope", () => {
    const operation = { responses: { "200": jsonBody({ ref: "UserList" }), "201": jsonBody({ ref: "Session" }) } };
    expect(successEntitySchema({ operation, schemas: SCHEMAS })).toBe("User");
  });

  it("prefers a 201 over the 2XX range", () => {
    const operation = { responses: { "201": jsonBody({ ref: "Session" }), "2XX": jsonBody({ ref: "User" }) } };
    expect(successEntitySchema({ operation, schemas: SCHEMAS })).toBe("Session");
  });

  it("falls to the 2XX range when neither a 200 nor a 201 is declared", () => {
    const operation = { responses: { "2XX": jsonBody({ ref: "Base" }), "404": jsonBody({ ref: "User" }) } };
    expect(successEntitySchema({ operation, schemas: SCHEMAS })).toBe("Base");
  });

  it("names nothing when no success response or no JSON schema is declared", () => {
    expect(successEntitySchema({ operation: {}, schemas: SCHEMAS })).toBe(null);
    expect(successEntitySchema({ operation: { responses: { "200": {} } }, schemas: SCHEMAS })).toBe(null);
  });
});

describe("resolveFields", () => {
  it("returns the sorted, distinct inherited fields and records them in the cache", () => {
    const fieldCache = new Map<string, readonly string[]>();
    expect(resolveFields({ entity: "User", fieldCache, schemas: SCHEMAS })).toEqual([
      "email_addresses",
      "id",
      "object",
    ]);
    expect(fieldCache.get("User")).toEqual(["email_addresses", "id", "object"]);
  });

  it("answers from the cache rather than walking the schema again", () => {
    const fieldCache = new Map<string, readonly string[]>([["User", ["cached"]]]);
    expect(resolveFields({ entity: "User", fieldCache, schemas: SCHEMAS })).toEqual(["cached"]);
  });

  it("returns no fields and caches nothing when there is no named schema", () => {
    const fieldCache = new Map<string, readonly string[]>();
    expect(resolveFields({ entity: null, fieldCache, schemas: SCHEMAS })).toEqual([]);
    expect(fieldCache.size).toBe(0);
  });
});

describe("webhookPayloadSchema", () => {
  it("finds the data schema inside the payload's allOf rather than the shared envelope", () => {
    const schema = {
      allOf: [
        { $ref: "#/components/schemas/WebhookEventPayload" },
        { properties: { data: { $ref: "#/components/schemas/UserWebhookData" } } },
      ],
    };
    const post = { requestBody: { content: { "application/json": { schema } } } };
    expect(webhookPayloadSchema({ post })).toBe("UserWebhookData");
  });

  it("takes the first named arm of a data oneOf", () => {
    const data = {
      oneOf: [{ type: "object" }, { $ref: "#/components/schemas/First" }, { $ref: "#/components/schemas/Second" }],
    };
    const post = { requestBody: { content: { "application/json": { schema: { properties: { data } } } } } };
    expect(webhookPayloadSchema({ post })).toBe("First");
  });

  it("names nothing for an event with no request body, no JSON schema or no data property", () => {
    expect(webhookPayloadSchema({ post: {} })).toBe(null);
    expect(webhookPayloadSchema({ post: { requestBody: {} } })).toBe(null);
    expect(webhookPayloadSchema({ post: { requestBody: jsonBody({ ref: "Session" }) } })).toBe(null);
  });
});
