/**
 * The two inventory lookups: a surface the inventory declares on a channel yields its call, and a surface with
 * no call on that channel yields `null` — the stated "this channel does not read it", never a guessed call.
 */
import { describe, expect, it } from "vitest";

import { onepasswordEventsEndpointFor, onepasswordOpCommandFor } from "../../../../atlas/onepassword/inventory.js";

describe("onepasswordOpCommandFor", () => {
  it("returns the declared op command for an admin-cli surface", () => {
    expect(onepasswordOpCommandFor({ surface: "vault-groups" })).toStrictEqual({
      cardinality: "per-parent",
      surface: "vault-groups",
      template: ["vault", "group", "list", "{{id}}"],
    });
  });

  it("returns null for a surface op has no command for", () => {
    expect(onepasswordOpCommandFor({ surface: "events-audit" })).toBeNull();
    expect(onepasswordOpCommandFor({ surface: "people-console" })).toBeNull();
  });
});

describe("onepasswordEventsEndpointFor", () => {
  it("returns the declared Events API endpoint for an events surface", () => {
    expect(onepasswordEventsEndpointFor({ surface: "events-audit" })).toStrictEqual({
      feature: "auditevents",
      method: "POST",
      path: "/api/v2/auditevents",
    });
  });

  it("returns null for a surface the Events API has no call for", () => {
    expect(onepasswordEventsEndpointFor({ surface: "users-list" })).toBeNull();
  });
});
