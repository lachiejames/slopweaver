/**
 * The redaction, which is the only thing standing between a signed-in Clerk dashboard's traffic and the
 * stored generation.
 *
 * The bug this file exists to keep fixed is a real one, found by the first live walk: Clerk's own routes are
 * snake_case, and a length-only token rule redacted `/v1/me/organization_memberships` to
 * `/v1/me/{token}` — which made a documented Frontend API operation read as undocumented in the
 * corroboration. Being wrong in the other direction is worse, so both directions are asserted.
 */
import { describe, expect, it } from "vitest";

import { CLERK_SEGMENTS, clerkWirePathOf, reduceClerkCalls } from "../../../../atlas/clerk/browserReduction.js";

describe("CLERK_SEGMENTS", () => {
  it("redacts a prefixed Clerk identifier and KEEPS its type prefix, which is a schema name", () => {
    expect(CLERK_SEGMENTS({ segment: "ins_0SYNFIXTUREINS0000000000000" })?.placeholder).toBe("{ins}");
    expect(CLERK_SEGMENTS({ segment: "user_0SYNFIXTUREUSR0000000000000" })?.placeholder).toBe("{user}");
  });

  it("redacts a bare run of digits", () => {
    expect(CLERK_SEGMENTS({ segment: "1788582352652" })?.placeholder).toBe("{n}");
  });

  it("redacts an unprefixed opaque token that mixes case and digits", () => {
    expect(CLERK_SEGMENTS({ segment: "Q7xKp2Lm9Rt4Vb8Nc3Zw6Hy1Jd5Fg0Sa" })?.placeholder).toBe("{token}");
  });

  it("keeps a long snake_case route name, which a length-only rule redacted", () => {
    expect(CLERK_SEGMENTS({ segment: "organization_memberships" })).toBe(null);
  });

  it("keeps a long hyphenated route name", () => {
    expect(CLERK_SEGMENTS({ segment: "organizations-settings" })).toBe(null);
  });

  it("keeps a short route name", () => {
    expect(CLERK_SEGMENTS({ segment: "environment" })).toBe(null);
  });

  it("redacts a UUID, which the dashboard identifies its own log rows by", () => {
    expect(CLERK_SEGMENTS({ segment: "01a06c77-833a-76fe-a248-2d1fb490142e" })?.placeholder).toBe("{uuid}");
  });

  it("redacts a COMPOSITE id, which every other rule let through unredacted", () => {
    // MEASURED on the first full walk: `<epoch milliseconds>:<uuid>` addresses one application-log row, and
    // the colon disqualified it from the token alphabet while it matched no other rule — so a real log id
    // reached a stored path shape.
    expect(CLERK_SEGMENTS({ segment: "1788526166842:01a06c77-833a-76fe-a248-2d1fb490142e" })?.placeholder).toBe("{id}");
  });

  it("keeps a segment whose parts are not ALL values, because a name beside a value is still a name", () => {
    expect(CLERK_SEGMENTS({ segment: "v1:users" })).toBe(null);
  });
});

describe("clerkWirePathOf", () => {
  it("redacts a composite log id out of a whole path", () => {
    expect(
      clerkWirePathOf({
        url: "https://dapi.clerk.com/instances/ins_0SYNFIXTUREINS0000000000000/application_logs/1788526166842:01a06c77-833a-76fe-a248-2d1fb490142e",
      }),
    ).toBe("/instances/{ins}/application_logs/{id}");
  });

  it("redacts every value segment and keeps every route name", () => {
    expect(
      clerkWirePathOf({ url: "https://dapi.clerk.com/v1/instances/ins_0SYNFIXTUREINS0000000000000/domains" }),
    ).toBe("/v1/instances/{ins}/domains");
  });

  it("leaves a fully-named path alone", () => {
    expect(clerkWirePathOf({ url: "https://clerk.clerk.com/v1/environment?x=1" })).toBe("/v1/environment");
  });

  it("answers null for an address it cannot read", () => {
    expect(clerkWirePathOf({ url: "not a url" })).toBe(null);
  });
});

describe("reduceClerkCalls", () => {
  it("keeps a first-party call, reduced to field NAMES and never a value", () => {
    const rows = reduceClerkCalls({
      responses: [
        {
          body: { data: [{ email_address: "someone@example.test", id: "user_0SYNFIXTUREUSR0000000000000" }] },
          method: "get",
          statusCode: 200,
          url: "https://api.clerk.com/v1/users",
        },
      ],
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.api).toBe("bapi");
    expect(rows[0]!.method).toBe("GET");
    expect(rows[0]!.wirePath).toBe("/v1/users");
    expect(rows[0]!.responseFields).toEqual(["data", "data[].email_address", "data[].id"]);
  });

  it("carries no response VALUE into the row it keeps", () => {
    const rows = reduceClerkCalls({
      responses: [
        {
          body: { email_address: "someone@example.test" },
          method: "GET",
          statusCode: 200,
          url: "https://api.clerk.com/v1/users/user_0SYNFIXTUREUSR0000000000000",
        },
      ],
    });
    expect(JSON.stringify(rows)).not.toContain("someone@example.test");
  });

  it("drops a third party's call entirely — not a redacted row, not a count", () => {
    const rows = reduceClerkCalls({
      responses: [
        { body: {}, method: "POST", statusCode: 200, url: "https://o449981.ingest.us.sentry.io/api/1/envelope/" },
        { body: {}, method: "GET", statusCode: 200, url: "https://analytics.google.com/g/collect" },
      ],
    });
    expect(rows).toEqual([]);
  });

  it("orders rows by API then path, so a published file is stable", () => {
    const rows = reduceClerkCalls({
      responses: [
        { body: {}, method: "GET", statusCode: 200, url: "https://dapi.clerk.com/v1/workspace_status" },
        { body: {}, method: "GET", statusCode: 200, url: "https://api.clerk.com/v1/users" },
      ],
    });
    expect(rows.map((row) => row.api)).toEqual(["bapi", "dashboard"]);
  });
});
