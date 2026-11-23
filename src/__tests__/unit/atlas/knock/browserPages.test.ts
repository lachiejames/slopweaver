import { describe, expect, it } from "vitest";

import {
  isKnockSignInUrl,
  KNOCK_BROWSER_PAGES,
  knockPageUrl,
  knockPhotographPolicy,
  knockRootFromFinalUrl,
  parsePath,
} from "../../../../atlas/knock/browserPages.js";
import { KNOCK_ROUTES } from "../../../../atlas/knock/generated/routes.js";

describe("knock sign-in detection", () => {
  it("names the walls the dashboard answers a signed-out request with", () => {
    expect(isKnockSignInUrl({ finalUrl: "https://dashboard.knock.app/login" })).toBe(true);
    expect(isKnockSignInUrl({ finalUrl: "https://dashboard.knock.app/auth/mfa/challenge" })).toBe(true);
    expect(isKnockSignInUrl({ finalUrl: "https://dashboard.knock.app/signup/profile" })).toBe(true);
    expect(isKnockSignInUrl({ finalUrl: "https://dashboard.knock.app/join-account" })).toBe(true);
  });

  it("does not mistake a dashboard page for a wall", () => {
    expect(isKnockSignInUrl({ finalUrl: "https://dashboard.knock.app/acme/production/workflows" })).toBe(false);
  });

  it("answers false rather than throwing on an address it cannot read", () => {
    expect(isKnockSignInUrl({ finalUrl: "not a url" })).toBe(false);
  });
});

describe("knock root resolution", () => {
  it("reads both slugs off a landing that carried an environment", () => {
    expect(knockRootFromFinalUrl({ finalUrl: "https://dashboard.knock.app/acme/production/overview" })).toStrictEqual({
      account: "acme",
      environment: "production",
    });
  });

  it("reads the account alone when the session last left on an account-level page", () => {
    expect(knockRootFromFinalUrl({ finalUrl: "https://dashboard.knock.app/acme/settings/team" })).toStrictEqual({
      account: "acme",
      environment: null,
    });
  });

  it("does not read a dashboard route as an account slug", () => {
    expect(knockRootFromFinalUrl({ finalUrl: "https://dashboard.knock.app/login" })).toBe(null);
    expect(knockRootFromFinalUrl({ finalUrl: "https://dashboard.knock.app/integrations/vercel/install" })).toBe(null);
  });

  it("answers null on the bare origin, which names no account", () => {
    expect(knockRootFromFinalUrl({ finalUrl: "https://dashboard.knock.app/" })).toBe(null);
  });
});

describe("knock page addressing", () => {
  const page = {
    apiBacked: true,
    kind: "workflow",
    needsEnvironment: true,
    surface: "/[slug]/[environment]/workflows",
  };
  const accountPage = { apiBacked: false, kind: null, needsEnvironment: false, surface: "/[slug]/settings/audit-log" };

  it("substitutes both slugs into an environment-scoped route", () => {
    expect(knockPageUrl({ page, root: { account: "acme", environment: "production" } })).toBe(
      "https://dashboard.knock.app/acme/production/workflows",
    );
  });

  it("addresses an account page from the account slug alone", () => {
    expect(knockPageUrl({ page: accountPage, root: { account: "acme", environment: null } })).toBe(
      "https://dashboard.knock.app/acme/settings/audit-log",
    );
  });

  it("refuses an environment-scoped page when the landing carried no environment", () => {
    expect(knockPageUrl({ page, root: { account: "acme", environment: null } })).toBe(null);
  });

  it("refuses every page when there is no root at all", () => {
    expect(knockPageUrl({ page: accountPage, root: null })).toBe(null);
  });
});

describe("the declared walk set", () => {
  it("is 57 of the dashboard's 154 routes", () => {
    expect(KNOCK_ROUTES.length).toBe(154);
    expect(KNOCK_BROWSER_PAGES.length).toBe(57);
  });

  it("declares no page carrying a parameter the session cannot answer", () => {
    const withRecordIds = KNOCK_BROWSER_PAGES.filter((page) =>
      [...page.surface.matchAll(/\[([^\]]+)\]/g)].some((match) => match[1] !== "slug" && match[1] !== "environment"),
    );
    expect(withRecordIds).toStrictEqual([]);
  });

  it("declares no auth, OAuth-callback or internal route, because visiting one would DO something", () => {
    const declared = new Set(KNOCK_BROWSER_PAGES.map((page) => page.surface));
    const forbidden = KNOCK_ROUTES.filter(
      (route) => route.scope !== "account" && route.scope !== "environment" && declared.has(route.route),
    );
    expect(forbidden).toStrictEqual([]);
  });

  it("carries 19 pages no callable operation backs, the Agents workspace among them", () => {
    const unbacked = KNOCK_BROWSER_PAGES.filter((page) => !page.apiBacked).map((page) => page.surface);
    expect(unbacked.length).toBe(19);
    expect(unbacked).toContain("/[slug]/agents");
    expect(unbacked).toContain("/[slug]/settings/audit-log");
    expect(unbacked).toContain("/[slug]/settings/service-tokens");
  });
});

describe("path trimming", () => {
  it("makes a trailing slash the same address", () => {
    expect(parsePath({ url: "https://dashboard.knock.app/acme/settings/" })).toBe("/acme/settings");
  });

  it("keeps the bare origin readable as a path", () => {
    expect(parsePath({ url: "https://dashboard.knock.app/" })).toBe("/");
  });

  it("answers null for an address it cannot read", () => {
    expect(parsePath({ url: "nonsense" })).toBe(null);
  });
});

describe("the photograph policy", () => {
  const page = ({ kind }: { kind: string | null }): Parameters<typeof knockPhotographPolicy>[0]["page"] => ({
    apiBacked: true,
    kind,
    needsEnvironment: true,
    surface: "/[slug]/[environment]/x",
  });

  it("photographs a settings or configuration page", () => {
    expect(knockPhotographPolicy({ page: page({ kind: "workflow" }) })).toBe(null);
    expect(knockPhotographPolicy({ page: page({ kind: "channel" }) })).toBe(null);
  });

  it("photographs a page no kind covers, which is where the browser-only findings are", () => {
    expect(knockPhotographPolicy({ page: page({ kind: null }) })).toBe(null);
  });

  it("REFUSES a picture of the organisation's own recipients, before the write", () => {
    expect(knockPhotographPolicy({ page: page({ kind: "user" }) })?.refusedBecause).toContain("real people");
    expect(knockPhotographPolicy({ page: page({ kind: "tenant" }) })?.refusedBecause).toContain("real people");
    expect(knockPhotographPolicy({ page: page({ kind: "object" }) })?.refusedBecause).toContain("real people");
  });

  it("REFUSES a picture of delivered messages", () => {
    expect(knockPhotographPolicy({ page: page({ kind: "event-shape" }) })?.refusedBecause).toContain(
      "never photographed",
    );
  });

  it("refuses every declared page whose kind is in the withheld set, and no other", () => {
    const refused = KNOCK_BROWSER_PAGES.filter((candidate) => knockPhotographPolicy({ page: candidate }) !== null)
      .map((candidate) => candidate.surface)
      .toSorted();
    expect(refused).toStrictEqual([
      "/[slug]/[environment]/logs",
      "/[slug]/[environment]/logs/runs",
      "/[slug]/[environment]/messages",
      "/[slug]/[environment]/objects",
      "/[slug]/[environment]/runs",
      "/[slug]/[environment]/tenants",
      "/[slug]/[environment]/users",
    ]);
  });
});
