import { describe, expect, it } from "vitest";

import { clerkEntitySchemaName } from "../../../../atlas/clerk/entitySchema.js";

/** A components map holding one entity, one paginated envelope over it, and envelopes that name no entity. */
const SCHEMAS: Record<string, unknown> = {
  BareItems: { properties: { data: { items: {} } } },
  NoData: { properties: { total_count: {} } },
  NoProperties: { type: "object" },
  ScalarItems: { properties: { data: { items: "User" } } },
  User: { properties: { id: {} } },
  UserList: { properties: { data: { items: { $ref: "#/components/schemas/User" } }, total_count: {} } },
};

/** The entity name a response schema node naming `ref` resolves to. */
function entityOf({ ref }: { ref: string }): string | null {
  return clerkEntitySchemaName({ node: { $ref: `#/components/schemas/${ref}` }, schemas: SCHEMAS });
}

describe("clerkEntitySchemaName", () => {
  it("descends one hop through a paginated envelope to the entity it lists", () => {
    expect(entityOf({ ref: "UserList" })).toBe("User");
  });

  it("names a schema that is not an envelope as itself", () => {
    expect(entityOf({ ref: "User" })).toBe("User");
    expect(entityOf({ ref: "NoProperties" })).toBe("NoProperties");
    expect(entityOf({ ref: "NoData" })).toBe("NoData");
  });

  it("keeps an envelope whose items name no schema as the entity itself", () => {
    expect(entityOf({ ref: "BareItems" })).toBe("BareItems");
    expect(entityOf({ ref: "ScalarItems" })).toBe("ScalarItems");
  });

  it("keeps a reference to a schema the document does not declare as written", () => {
    expect(entityOf({ ref: "Missing" })).toBe("Missing");
  });

  it("descends through an array response's items when there is no envelope", () => {
    expect(
      clerkEntitySchemaName({
        node: { items: { $ref: "#/components/schemas/User" }, type: "array" },
        schemas: SCHEMAS,
      }),
    ).toBe("User");
  });

  it("names nothing for a response with no named schema at all", () => {
    expect(clerkEntitySchemaName({ node: { type: "object" }, schemas: SCHEMAS })).toBe(null);
    expect(clerkEntitySchemaName({ node: { items: { type: "string" }, type: "array" }, schemas: SCHEMAS })).toBe(null);
  });
});
