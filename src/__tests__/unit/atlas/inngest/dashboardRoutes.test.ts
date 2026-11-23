import { describe, expect, it } from "vitest";

import {
  compileDashboardRoutes,
  controlPathFor,
  controlPrefixFor,
  defaultEnvironmentSlug,
  entryBundleUrl,
  INNGEST_DASHBOARD_ORIGIN,
  probePathFor,
} from "../../../../atlas/inngest/dashboardRoutes.js";
import { unwrap } from "../../../../lib/result.js";

/** The sign-in page's own shape, reduced to the two things this module reads out of it. */
const SIGN_IN_PAGE =
  '<link rel="modulepreload" href="/assets/index-QVblTVbc.js"/>' +
  '<link rel="modulepreload" href="/assets/sign-in._-B56FmtXf.js"/>' +
  '<script>window.__clerk_init_state = {"__internal_clerk_state":{"__signUpForceRedirectUrl":"/user-setup",' +
  '"__signInFallbackRedirectUrl":"/env/production/apps","__signUpFallbackRedirectUrl":""}};</script>';

/** The declaration shape the application's own bundle minifies its route tree into. */
const BUNDLE =
  'a=x.update({id:"/settings",path:"/settings",getParentRoute:()=>root}),' +
  'b=y.update({id:"/api-keys/",path:"/api-keys/",getParentRoute:()=>a}),' +
  'c=z.update({id:"/env/$envSlug",path:"/env/$envSlug",getParentRoute:()=>root}),' +
  'd=w.update({id:"/apps",path:"/apps",getParentRoute:()=>c}),' +
  'e=v.update({id:"/",path:"/",getParentRoute:()=>root})';

describe("reading the dashboard's own route table", () => {
  it("finds the content-hashed entry bundle on the page that preloads it", () => {
    expect(unwrap(entryBundleUrl({ html: SIGN_IN_PAGE }))).toBe(`${INNGEST_DASHBOARD_ORIGIN}/assets/index-QVblTVbc.js`);
  });

  it("refuses a page that preloads no entry bundle, naming what changed", () => {
    const found = entryBundleUrl({ html: "<html></html>" });
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr()[0]).toContain("preloads no /assets/index-*.js entry");
  });

  // The slug is READ from the application's own post-sign-in default rather than assumed, so a probe below
  // `/env/` is addressed at an environment the vendor named rather than one this atlas invented.
  it("reads the default environment slug out of the application's own fallback redirect", () => {
    expect(defaultEnvironmentSlug({ html: SIGN_IN_PAGE })).toBe("production");
    expect(defaultEnvironmentSlug({ html: "<html></html>" })).toBe(null);
  });

  it("composes a full address by walking each route's parent chain", () => {
    const routes = unwrap(compileDashboardRoutes({ bundle: BUNDLE }));
    expect(routes.map((route) => route.routePath)).toEqual([
      "/",
      "/env/$envSlug",
      "/env/$envSlug/apps",
      "/settings",
      "/settings/api-keys",
    ]);
  });

  it("marks a route carrying a parameter segment and names each route's own section", () => {
    const routes = unwrap(compileDashboardRoutes({ bundle: BUNDLE }));
    const apps = routes.find((route) => route.routePath === "/env/$envSlug/apps")!;
    expect(apps.parameterised).toBe(true);
    expect(apps.section).toBe("env");
    expect(routes.find((route) => route.routePath === "/")!.section).toBe("root");
    expect(routes.find((route) => route.routePath === "/settings/api-keys")!.parameterised).toBe(false);
  });

  it("refuses a bundle whose build no longer declares routes in that shape", () => {
    const compiled = compileDashboardRoutes({ bundle: "console.log('hello')" });
    expect(compiled.isErr()).toBe(true);
    expect(compiled._unsafeUnwrapErr()[0]).toContain("declares no route this compiler could read");
  });
});

describe("choosing the address one declared route is probed at", () => {
  const route = { parameterised: true, routePath: "/env/$envSlug/apps", section: "env" };

  it("substitutes only the environment slug the application itself named", () => {
    expect(probePathFor({ environmentSlug: "production", route })).toBe("/env/production/apps");
    expect(probePathFor({ environmentSlug: null, route })).toBe(null);
  });

  it("refuses to invent any other identifier, so such a route has no concrete address", () => {
    expect(
      probePathFor({
        environmentSlug: "production",
        route: { parameterised: true, routePath: "/env/$envSlug/runs/$runID", section: "env" },
      }),
    ).toBe(null);
  });

  it("leaves a route with no parameter exactly as declared", () => {
    expect(
      probePathFor({
        environmentSlug: null,
        route: { parameterised: false, routePath: "/settings", section: "settings" },
      }),
    ).toBe("/settings");
  });
});

describe("building the control that decides whether an answer means anything", () => {
  // The discrimination is per DEPTH: `/zzz…` answers 404 at the root and a sign-in redirect below a layout
  // segment, so one control for the whole origin would credit every settings route with an existence the
  // application never established.
  it("takes the control from each address's own parent prefix", () => {
    expect(controlPrefixFor({ path: "/settings" })).toBe("");
    expect(controlPrefixFor({ path: "/settings/api-keys" })).toBe("/settings");
    expect(controlPrefixFor({ path: "/env/production/apps" })).toBe("/env/production");
    expect(controlPathFor({ prefix: "" })).toBe("/zzzsyntheticzzz-control");
    expect(controlPathFor({ prefix: "/settings" })).toBe("/settings/zzzsyntheticzzz-control");
  });
});

describe("the route table's refusals, line for line", () => {
  it("refuses a page preloading no entry bundle with exactly its two lines", () => {
    expect(entryBundleUrl({ html: "<html></html>" })._unsafeUnwrapErr()).toEqual([
      "https://app.inngest.com/sign-in preloads no /assets/index-*.js entry, so the route table cannot be read",
      "the dashboard's build layout has changed — re-read the page's modulepreload links before editing this",
    ]);
  });

  it("refuses a bundle declaring no readable route with exactly its two lines", () => {
    expect(compileDashboardRoutes({ bundle: "console.log('hello')" })._unsafeUnwrapErr()).toEqual([
      "the dashboard's entry bundle declares no route this compiler could read",
      "a route is `X.update({id:…,path:…,getParentRoute:()=>PARENT})` — the application's build has changed shape",
    ]);
  });
});
