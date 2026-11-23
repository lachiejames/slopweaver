import { describe, expect, it } from "vitest";

import {
  BRAZE_BROWSER_ROUTES,
  BRAZE_DASHBOARD_ORIGIN,
  BRAZE_INFERRED_CLUSTER,
  type BrazeBrowserRoute,
  brazeRouteUrl,
} from "../../../../atlas/braze/browserPages.js";

/** A route declaration the test builds itself, so a URL claim does not lean on the shipped list's order. */
function route({ path }: { path: string | null }): BrazeBrowserRoute {
  return {
    description: "a destination built by this test",
    grounding: "constructed in the test",
    path,
    section: "settings",
    surface: "test-surface",
  };
}

describe("the declared Braze dashboard routes", () => {
  it("declares eight routes, three with a path and five breadcrumb-only, in this order", () => {
    expect(BRAZE_BROWSER_ROUTES.map(({ path, section, surface }) => ({ path, section, surface }))).toEqual([
      { path: "/", section: "root", surface: "dashboard-root" },
      { path: "/sign_in", section: "root", surface: "dashboard-sign-in" },
      {
        path: "/app_settings/developer_console/activitylog/",
        section: "settings",
        surface: "developer-console-activity-log",
      },
      { path: null, section: "settings", surface: "settings-api-keys" },
      { path: null, section: "settings", surface: "settings-app-settings" },
      { path: null, section: "settings", surface: "settings-api-usage-dashboard" },
      { path: null, section: "settings", surface: "settings-email-preferences" },
      { path: null, section: "data", surface: "data-settings-custom-attributes" },
    ]);
  });

  it("gives each declared route a non-empty grounding", () => {
    expect(BRAZE_BROWSER_ROUTES.length).toBeGreaterThan(0);
    expect(BRAZE_BROWSER_ROUTES.filter((declared) => declared.grounding.trim() === "")).toEqual([]);
  });

  it("expresses routes against the cluster-agnostic dashboard origin", () => {
    expect(BRAZE_DASHBOARD_ORIGIN).toBe("https://dashboard.braze.com");
  });

  it("records the AU-01 cluster as an inference, not a fact", () => {
    expect(BRAZE_INFERRED_CLUSTER).toEqual({
      dashboardOrigin: "https://dashboard.au-01.braze.com",
      evidence:
        "every Cloudflare DNS record tagged `braze` on this organisation's domain is ap-southeast-2 Amazon SES, " +
        "including a click-tracking CNAME to r.ap-southeast-2.awstrack.me",
      name: "AU-01",
      restOrigin: "https://rest.au-01.braze.com",
      status: "inferred",
    });
  });
});

describe("brazeRouteUrl", () => {
  it("joins the root path onto the dashboard origin", () => {
    expect(brazeRouteUrl({ route: route({ path: "/" }) })).toBe("https://dashboard.braze.com/");
  });

  it("joins the activity-log path onto the dashboard origin", () => {
    expect(brazeRouteUrl({ route: route({ path: "/app_settings/developer_console/activitylog/" }) })).toBe(
      "https://dashboard.braze.com/app_settings/developer_console/activitylog/",
    );
  });

  it("answers null for a breadcrumb-only route a walk must discover", () => {
    expect(brazeRouteUrl({ route: route({ path: null }) })).toBeNull();
  });

  it("resolves the shipped declarations to three URLs and five nulls, in declaration order", () => {
    expect(BRAZE_BROWSER_ROUTES.map((declared) => brazeRouteUrl({ route: declared }))).toEqual([
      "https://dashboard.braze.com/",
      "https://dashboard.braze.com/sign_in",
      "https://dashboard.braze.com/app_settings/developer_console/activitylog/",
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
