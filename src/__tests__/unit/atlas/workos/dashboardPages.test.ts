/**
 * The declared dashboard page map, and the runtime expansion that addresses it.
 *
 * The measured fact this table stands on is that the dashboard gives NO route oracle to anyone without a
 * session, so nothing here is evidence and the tests hold it to being well-formed rather than correct.
 * The one exception is the self-evident route, which the vendor does corroborate for free.
 *
 * What the expansion is held to is sharper, because it is mechanical: an environment route must never be
 * addressed without the segment when one is resolved, a root route must never be addressed WITH it, and an
 * unresolved environment must still produce the bootstrap address a walk can be given.
 */
import { describe, expect, it } from "vitest";

import {
  WORKOS_DASHBOARD_ORIGIN,
  WORKOS_DASHBOARD_ROUTES,
  WORKOS_DASHBOARD_SELF_EVIDENT_ROUTE,
  workosDashboardRouteUrl,
  workosDashboardUrl,
} from "../../../../atlas/workos/dashboardPages.js";

import { TEST_ENVIRONMENT_ID } from "./workosFixtures.js";

describe("the dashboard route table", () => {
  it("declares each path exactly once, so two page entities cannot share an id", () => {
    const paths = WORKOS_DASHBOARD_ROUTES.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("gives every route a purpose a reader could act on", () => {
    const empty = WORKOS_DASHBOARD_ROUTES.filter((route) => route.purpose.length === 0);
    expect(empty).toEqual([]);
  });

  it("marks the API-keys page admin-only, since it is the page that would mint this atlas's own key", () => {
    const apiKeys = WORKOS_DASHBOARD_ROUTES.find((route) => route.path === "/api-keys")!;
    expect(apiKeys.needsAdmin).toBe(true);
  });

  it("declares the self-evident route, and declares it as a route", () => {
    const declared = WORKOS_DASHBOARD_ROUTES.map((route) => route.path);
    expect(declared.includes(WORKOS_DASHBOARD_SELF_EVIDENT_ROUTE.path)).toBe(true);
  });

  it("declares the sub-route that route redirects to, so the free fact is not thrown away", () => {
    const declared = WORKOS_DASHBOARD_ROUTES.map((route) => route.path);
    expect(declared.includes(WORKOS_DASHBOARD_SELF_EVIDENT_ROUTE.observedRedirect)).toBe(true);
  });

  // The self-evident redirect is a fact about the ORIGIN, measured with no session at all, so the two rows
  // it names have to stay outside the environment or the one free structural fact stops applying to them.
  it("keeps the self-evident route and its redirect at the root, where the vendor proved them", () => {
    const paths = new Set<string>([
      WORKOS_DASHBOARD_SELF_EVIDENT_ROUTE.path,
      WORKOS_DASHBOARD_SELF_EVIDENT_ROUTE.observedRedirect,
    ]);
    const scoped = WORKOS_DASHBOARD_ROUTES.filter((route) => paths.has(route.path) && route.scope !== "root");
    expect(scoped).toEqual([]);
  });

  // On a real walk the bare path answered the dashboard's own not-found page in a SIGNED-IN session.
  it("no longer declares the SSO page, whose address the dashboard has moved away from", () => {
    const declared = WORKOS_DASHBOARD_ROUTES.map((route) => route.path);
    expect(declared.includes("/sso")).toBe(false);
  });

  // WITNESSED: opening the bare /redirects ended on the environment-scoped /applications,
  // titled "Applications | WorkOS", which a not-found page does not produce.
  it("declares the applications page the redirects page moved to", () => {
    const applications = WORKOS_DASHBOARD_ROUTES.find((route) => route.path === "/applications")!;
    expect(applications.scope).toBe("environment");
  });

  it("carries no environment segment in any declared path, since that is per-install state", () => {
    const withSegment = WORKOS_DASHBOARD_ROUTES.filter((route) => route.path.includes("environment_"));
    expect(withSegment).toEqual([]);
  });

  it("declares ten environment-scoped routes, which is what makes the segment load-bearing", () => {
    const environmentScoped = WORKOS_DASHBOARD_ROUTES.filter((route) => route.scope === "environment");
    expect(environmentScoped.length).toBe(10);
  });
});

describe("workosDashboardRouteUrl", () => {
  it("hangs an environment route off the resolved segment", () => {
    const route = WORKOS_DASHBOARD_ROUTES.find((declared) => declared.path === "/organizations")!;
    expect(workosDashboardRouteUrl({ environmentId: TEST_ENVIRONMENT_ID, route })).toBe(
      `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/organizations`,
    );
  });

  it("leaves a root route at the origin even when a segment is resolved", () => {
    const route = WORKOS_DASHBOARD_ROUTES.find((declared) => declared.path === "/settings/team")!;
    expect(workosDashboardRouteUrl({ environmentId: TEST_ENVIRONMENT_ID, route })).toBe(
      "https://dashboard.workos.com/settings/team",
    );
  });

  // The bootstrap: `declaredPagesFrom` drops a page with no deepLink from the walk's brief, so an
  // unresolved environment still has to publish an address or nothing can ever learn the segment.
  it("addresses an environment route at its bare path when no segment is resolved", () => {
    const route = WORKOS_DASHBOARD_ROUTES.find((declared) => declared.path === "/api-keys")!;
    expect(workosDashboardRouteUrl({ environmentId: null, route })).toBe("https://dashboard.workos.com/api-keys");
  });

  it("hangs every address off the one declared origin", () => {
    const urls = WORKOS_DASHBOARD_ROUTES.map((route) =>
      workosDashboardRouteUrl({ environmentId: TEST_ENVIRONMENT_ID, route }),
    );
    const offOrigin = urls.filter((url) => !url.startsWith(WORKOS_DASHBOARD_ORIGIN));
    expect(offOrigin).toEqual([]);
  });
});

describe("workosDashboardUrl", () => {
  it("resolves a declared path through the same table the page map uses", () => {
    expect(workosDashboardUrl({ environmentId: TEST_ENVIRONMENT_ID, path: "/users" })).toBe(
      `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/users`,
    );
  });

  // A content kind pointing at a surface the table has stopped declaring must say it has no address,
  // never guess one: `/sso` is the standing case.
  it("answers null for a path the table does not declare", () => {
    expect(workosDashboardUrl({ environmentId: TEST_ENVIRONMENT_ID, path: "/sso" })).toBe(null);
  });
});
