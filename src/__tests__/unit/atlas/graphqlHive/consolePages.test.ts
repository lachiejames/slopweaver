import { describe, expect, it } from "vitest";

import {
  consolePageProviderId,
  expandConsoleRoute,
  HIVE_CONSOLE_ORIGIN,
  HIVE_CONSOLE_ROUTES,
} from "../../../../atlas/graphqlHive/consolePages.js";

const TARGET_ROUTE = HIVE_CONSOLE_ROUTES.find((route) => route.template.endsWith("/{targetSlug}/settings"))!;
const ROOT_ROUTE = HIVE_CONSOLE_ROUTES.find((route) => route.template === "/")!;

describe("HIVE_CONSOLE_ROUTES", () => {
  it("carries no real slug anywhere, because a slug is a private identifier this repo may not hold", () => {
    const withSlugs = HIVE_CONSOLE_ROUTES.filter((route) => /\{[a-zA-Z]+Slug\}/.test(route.template));
    expect(withSlugs.every((route) => !/\/[a-z-]*acme/.test(route.template))).toBe(true);
  });

  it("declares every scope, so a route table cannot silently cover only one level", () => {
    expect([...new Set(HIVE_CONSOLE_ROUTES.map((route) => route.scope))].toSorted()).toStrictEqual([
      "organization",
      "project",
      "root",
      "target",
    ]);
  });
});

describe("expandConsoleRoute", () => {
  it("expands a root route with no slugs at all", () => {
    const url = expandConsoleRoute({
      route: ROOT_ROUTE,
      slugs: { organizationSlug: null, projectSlug: null, targetSlug: null },
    });
    expect(url).toBe(`${HIVE_CONSOLE_ORIGIN}/`);
  });

  it("substitutes every placeholder a deep route names", () => {
    const url = expandConsoleRoute({
      route: TARGET_ROUTE,
      slugs: { organizationSlug: "org", projectSlug: "proj", targetSlug: "prod" },
    });
    expect(url).toBe(`${HIVE_CONSOLE_ORIGIN}/org/proj/prod/settings`);
  });

  it("percent-encodes a slug, so a slug with a slash cannot forge a different address", () => {
    const url = expandConsoleRoute({
      route: TARGET_ROUTE,
      slugs: { organizationSlug: "a/b", projectSlug: "proj", targetSlug: "prod" },
    });
    expect(url).toBe(`${HIVE_CONSOLE_ORIGIN}/a%2Fb/proj/prod/settings`);
  });

  it("answers null when a placeholder has no slug, because an unexpanded address is not an address", () => {
    const url = expandConsoleRoute({
      route: TARGET_ROUTE,
      slugs: { organizationSlug: "org", projectSlug: null, targetSlug: "prod" },
    });
    expect(url).toBeNull();
  });
});

describe("consolePageProviderId", () => {
  it("keys a root route by its template alone", () => {
    const id = consolePageProviderId({
      route: ROOT_ROUTE,
      slugs: { organizationSlug: null, projectSlug: null, targetSlug: null },
    });
    expect(id).toBe("/");
  });

  it("keys a scoped route by template AND slug path, so two targets' settings pages are two rows", () => {
    const id = consolePageProviderId({
      route: TARGET_ROUTE,
      slugs: { organizationSlug: "org", projectSlug: "proj", targetSlug: "prod" },
    });
    expect(id).toBe("/{organizationSlug}/{projectSlug}/{targetSlug}/settings#org/proj/prod");
  });
});
