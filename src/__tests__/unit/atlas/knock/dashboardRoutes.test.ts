/**
 * The Knock dashboard route vocabulary: the five scopes and two session parameters, how a route pattern's
 * bracket parameters are extracted (catch-all kept verbatim), which routes a signed-in walk can address, and
 * the shape rules that scope a route — each rule beside the near-miss that falls to the next one.
 */
import { describe, expect, it } from "vitest";

import {
  isKnockWalkableRoute,
  KNOCK_ROUTE_SCOPES,
  KNOCK_SESSION_PARAMETERS,
  knockRouteParameters,
  knockRouteScope,
} from "../../../../atlas/knock/dashboardRoutes.js";

describe("the route vocabulary", () => {
  it("names the five scopes and the two session parameters, in order", () => {
    expect(KNOCK_ROUTE_SCOPES).toEqual(["account", "environment", "auth", "integration", "internal"]);
    expect(KNOCK_SESSION_PARAMETERS).toEqual(["slug", "environment"]);
  });
});

describe("knockRouteParameters", () => {
  it("is empty for a route with no bracket", () => {
    expect(knockRouteParameters({ route: "/login" })).toEqual([]);
  });

  it("lists every parameter in path order, a repeated one each time it appears", () => {
    expect(knockRouteParameters({ route: "/[slug]/[environment]/workflows/[workflowKey]/steps/[id]/[id]" })).toEqual([
      "slug",
      "environment",
      "workflowKey",
      "id",
      "id",
    ]);
  });

  it("keeps a catch-all verbatim, dots included", () => {
    expect(knockRouteParameters({ route: "/[slug]/[...path]" })).toEqual(["slug", "...path"]);
  });
});

describe("isKnockWalkableRoute", () => {
  it("walks a route with no parameters and one carrying only the slug and environment", () => {
    expect(isKnockWalkableRoute({ route: "/" })).toBe(true);
    expect(isKnockWalkableRoute({ route: "/[slug]/settings" })).toBe(true);
    expect(isKnockWalkableRoute({ route: "/[slug]/[environment]/workflows" })).toBe(true);
  });

  it("refuses a route carrying one parameter the session does not answer, catch-all included", () => {
    expect(isKnockWalkableRoute({ route: "/[slug]/[environment]/workflows/[workflowKey]" })).toBe(false);
    expect(isKnockWalkableRoute({ route: "/[slug]/[...path]" })).toBe(false);
  });
});

describe("knockRouteScope", () => {
  it("scopes /auth/ routes and the listed signed-out routes as auth, and an unlisted neighbour as internal", () => {
    expect(
      ["/auth/mfa", "/login", "/create-account", "/invites/account/[token]", "/signup/profile", "/signup/other"].map(
        (route) => knockRouteScope({ route }),
      ),
    ).toEqual(["auth", "auth", "auth", "auth", "auth", "internal"]);
  });

  it("scopes integration prefixes and the slug's callback and Slack routes as integration", () => {
    expect(
      [
        "/integrations/github/install",
        "/slack/oauth",
        "/[slug]/callback/slack",
        "/[slug]/slack/link",
        "/[slug]/callback/github",
        "/[slug]/slack/settings",
      ].map((route) => knockRouteScope({ route })),
    ).toEqual(["integration", "integration", "integration", "integration", "integration", "integration"]);
  });

  it("scopes a route under the slug and environment as environment, even one naming integrations", () => {
    expect(
      ["/[slug]/[environment]/workflows", "/[slug]/[environment]/integrations/sources"].map((route) =>
        knockRouteScope({ route }),
      ),
    ).toEqual(["environment", "environment"]);
  });

  it("scopes the account picker and a slug route as account, and the bare environment segment as account too", () => {
    expect(
      ["/", "/[slug]/settings", "/[slug]", "/[slug]/[environment]"].map((route) => knockRouteScope({ route })),
    ).toEqual(["account", "account", "account", "account"]);
  });

  it("scopes an unknown root as internal", () => {
    expect(["/_error", "/dev-login", "/[...path]"].map((route) => knockRouteScope({ route }))).toEqual([
      "internal",
      "internal",
      "internal",
    ]);
  });
});
