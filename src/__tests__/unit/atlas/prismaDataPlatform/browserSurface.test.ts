/**
 * The two browser-adjacent inventories, and the property that makes each one honest.
 *
 * The console inventory's claim is unusual and worth pinning: it is SHORT because a signed-out probe
 * established nothing, not because nobody looked. So these assertions are mostly about what is NOT in it —
 * that no candidate path was promoted to a declared route on evidence the control also satisfies.
 */
import { describe, expect, it } from "vitest";

import {
  PRISMA_AUTH_ENDPOINTS,
  PRISMA_AUTH_ORIGIN,
  prismaAbsentAuthEndpoints,
  prismaConfirmedAuthEndpoints,
} from "../../../../atlas/prismaDataPlatform/authEndpoints.js";
import {
  PRISMA_CONSOLE_CANDIDATES,
  PRISMA_CONSOLE_CONTROL,
  PRISMA_CONSOLE_MANIFEST,
  PRISMA_CONSOLE_ORIGIN,
  PRISMA_CONSOLE_ROUTES,
} from "../../../../atlas/prismaDataPlatform/consoleRoutes.js";
import { PRISMA_UNDECLARED_ENDPOINTS } from "../../../../atlas/prismaDataPlatform/generated/specLock.js";

describe("the console route inventory", () => {
  it("declares three routes and no more, because that is what a signed-out request established", () => {
    expect(PRISMA_CONSOLE_ROUTES.map((route) => route.route).toSorted()).toEqual(["/", "/login", "/logout"]);
  });

  // The whole finding: a candidate is a path the probe could not tell apart from an invented one, so
  // promoting it to a declared route would be declaring it on the control's own evidence.
  it("keeps every candidate out of the declared inventory", () => {
    const declared = new Set(PRISMA_CONSOLE_ROUTES.map((route) => route.route));

    expect(PRISMA_CONSOLE_CANDIDATES.filter((candidate) => declared.has(candidate))).toEqual([]);
    expect(declared.has(PRISMA_CONSOLE_CONTROL)).toBe(false);
  });

  it("keeps the paths a reader would assume exist among the candidates, so the negative is recorded", () => {
    expect(PRISMA_CONSOLE_CANDIDATES).toContain("/robots.txt");
    expect(PRISMA_CONSOLE_CANDIDATES).toContain("/sitemap.xml");
    expect(PRISMA_CONSOLE_CANDIDATES).toContain("/settings");
  });

  it("grades the index by the route manifest rather than by its HTTP answer, which is the control's", () => {
    expect(PRISMA_CONSOLE_ROUTES.find((route) => route.route === "/")!.evidence).toBe("manifest-declared");
    expect(PRISMA_CONSOLE_ROUTES.find((route) => route.route === "/login")!.evidence).toBe("public-200");
    expect(PRISMA_CONSOLE_ROUTES.find((route) => route.route === "/logout")!.evidence).toBe("json-endpoint");
  });

  it("photographs the sign-in page and nothing else, since nothing else can be reached signed out", () => {
    expect(PRISMA_CONSOLE_ROUTES.filter((route) => route.screenshot).map((route) => route.route)).toEqual(["/login"]);
  });

  it("pins what the signed-out route manifest declared, so a widened one is a diff", () => {
    expect(PRISMA_CONSOLE_MANIFEST.declaredIds.length).toBe(PRISMA_CONSOLE_MANIFEST.declaredEntries);
    expect(PRISMA_CONSOLE_MANIFEST.addressablePaths).toBe(2);
    expect(PRISMA_CONSOLE_MANIFEST.servedFrom).toBe(`${PRISMA_CONSOLE_ORIGIN}/login`);
  });
});

describe("the authorization-server inventory", () => {
  it("confirms six endpoints and establishes three are absent", () => {
    expect(prismaConfirmedAuthEndpoints().length).toBe(6);
    expect(prismaAbsentAuthEndpoints().length).toBe(3);
    expect(PRISMA_AUTH_ENDPOINTS.length).toBe(9);
  });

  // The useful half: a reader who assumed OIDC would build an identity integration that is not there.
  it("records the missing OIDC layer as a confirmed absence rather than an omission", () => {
    const absent = prismaAbsentAuthEndpoints()
      .map((endpoint) => endpoint.path)
      .toSorted();

    expect(absent).toEqual(["/.well-known/openid-configuration", "/logout", "/userinfo"]);
  });

  it("says where each endpoint was named, so a probe-only find is distinguishable from a documented one", () => {
    const registration = PRISMA_AUTH_ENDPOINTS.find((endpoint) => endpoint.path === "/register")!;
    const authorize = PRISMA_AUTH_ENDPOINTS.find((endpoint) => endpoint.path === "/authorize")!;

    expect(registration.namedBy).toBe("authorization-server-metadata");
    expect(authorize.namedBy).toBe("openapi-security-scheme");
  });

  it("declares every endpoint the spec lock names as undeclared, and each exactly once", () => {
    const paths = new Set(PRISMA_AUTH_ENDPOINTS.map((endpoint) => `${PRISMA_AUTH_ORIGIN}${endpoint.path}`));
    const urls = PRISMA_UNDECLARED_ENDPOINTS.map((endpoint) => endpoint.url);

    expect(urls.filter((url) => !paths.has(url))).toEqual([]);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
