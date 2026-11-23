import { describe, expect, it } from "vitest";

import { AIRTABLE_BROWSER_PAGES, airtableConfirmedRoutes } from "../../../../atlas/airtable/browserPages.js";

/** Airtable's own identifier prefixes. A real one appearing in a committed route would be a leak. */
const PROVIDER_ID_PREFIXES = ["app", "tbl", "fld", "viw", "rec", "usr", "wsp", "ent", "pbd"];

describe("the declared Airtable browser route inventory", () => {
  it("declares each route exactly once", () => {
    expect(new Set(AIRTABLE_BROWSER_PAGES.map((page) => page.route)).size).toBe(AIRTABLE_BROWSER_PAGES.length);
  });

  it("confirms the account and enterprise-admin surface exists, without an account", () => {
    expect(
      airtableConfirmedRoutes()
        .map((page) => page.route)
        .toSorted(),
    ).toEqual([
      "/account",
      "/admin",
      "/admin/{enterpriseAccountId}/audit-logs",
      "/admin/{enterpriseAccountId}/billing",
      "/admin/{enterpriseAccountId}/groups",
      "/admin/{enterpriseAccountId}/reports",
      "/admin/{enterpriseAccountId}/settings",
      "/admin/{enterpriseAccountId}/users",
      "/create/oauth",
      "/create/tokens",
      "/{baseId}/api/docs",
    ]);
  });

  // A 200 is what the single-page shell answers for a signed-out visitor at a path resolving to nothing,
  // including `/{baseId}` with an invented base id. Recording those as reached would be a wish list.
  it("never claims a shell 200 confirms a route exists", () => {
    const confirmed = airtableConfirmedRoutes();
    const ambiguousClaimedConfirmed = confirmed.filter((page) => page.evidence !== "auth-gated-redirect");

    expect(ambiguousClaimedConfirmed).toEqual([]);
  });

  // The organisation's own base, workspace and enterprise ids are provider identifiers this repository may
  // not carry. Every parameterised route is a template, and this is the gate that keeps it one.
  it("carries no real provider identifier, only braced parameters", () => {
    const leaking = AIRTABLE_BROWSER_PAGES.filter((page) =>
      PROVIDER_ID_PREFIXES.some((prefix) => new RegExp(`/${prefix}[0-9A-Za-z]{10,}`).test(page.route)),
    );

    expect(leaking.map((page) => page.route)).toEqual([]);
  });

  // The owner's ruling: settings and admin pages get a screenshot; a page whose content is the
  // organisation's own data does not, because photographing it is holding the entities by another route.
  it("does not photograph a base's own grid", () => {
    const grid = AIRTABLE_BROWSER_PAGES.find((page) => page.route === "/{baseId}")!;
    const users = AIRTABLE_BROWSER_PAGES.find((page) => page.route === "/admin/{enterpriseAccountId}/users")!;

    expect(grid.screenshot).toBe(false);
    expect(users.screenshot).toBe(true);
  });

  it("declares the automations route, which is the surface no REST operation reaches", () => {
    const automations = AIRTABLE_BROWSER_PAGES.find((page) => page.route === "/{baseId}/automations")!;

    expect(automations.holds).toContain("ships no operation");
    expect(automations.screenshot).toBe(true);
  });
});
