import { describe, expect, it } from "vitest";

import {
  isVantaNotFound,
  tenantRootFromFinalUrl,
  VANTA_BROWSER_PAGES,
  VANTA_WEB_ORIGIN,
  vantaControlPage,
  vantaControlSurface,
  vantaPageUrl,
} from "../../../../atlas/vanta/browserPages.js";

describe("tenantRootFromFinalUrl", () => {
  it("reads the tenant root out of where a bare path landed", () => {
    expect(tenantRootFromFinalUrl({ finalUrl: "https://app.vanta.com/c/acme/tests?status=OVERDUE" })).toBe(
      "https://app.vanta.com/c/acme",
    );
  });

  it("refuses a URL that never reached the tenanted form, which is what a sign-in wall looks like", () => {
    expect(tenantRootFromFinalUrl({ finalUrl: "https://app.vanta.com/login" })).toBe(null);
  });

  it("refuses another origin outright, so a redirect off Vanta cannot mint a root", () => {
    expect(tenantRootFromFinalUrl({ finalUrl: "https://accounts.google.com/c/acme/tests" })).toBe(null);
  });

  it("refuses a `/c/` with no tenant after it", () => {
    expect(tenantRootFromFinalUrl({ finalUrl: "https://app.vanta.com/c/" })).toBe(null);
  });

  it("refuses something that is not a URL at all", () => {
    expect(tenantRootFromFinalUrl({ finalUrl: "not a url" })).toBe(null);
  });
});

describe("vantaPageUrl", () => {
  it("has at least one entry in VANTA_BROWSER_PAGES, so the guards below are not vacuously green", () => {
    expect(VANTA_BROWSER_PAGES.length).toBeGreaterThan(0);
  });

  it("hangs a page off the tenant root", () => {
    const page = VANTA_BROWSER_PAGES.find((candidate) => candidate.surface === "audits-collection")!;
    expect(vantaPageUrl({ page, tenantRoot: "https://app.vanta.com/c/acme" })).toBe(
      "https://app.vanta.com/c/acme/audits",
    );
  });

  it("states the page's own query, which is what overrides the view the client restored", () => {
    const page = VANTA_BROWSER_PAGES.find((candidate) => candidate.surface === "policies-collection")!;
    expect(vantaPageUrl({ page, tenantRoot: "https://app.vanta.com/c/acme" })).toBe(
      "https://app.vanta.com/c/acme/policies?page=1",
    );
  });
});

describe("isVantaNotFound", () => {
  it("recognises the client's own not-found page, which answers HTTP 200", () => {
    expect(isVantaNotFound({ title: "Page not found - Vanta" })).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(isVantaNotFound({ title: "  Page not found - Vanta  " })).toBe(true);
  });

  it("does not mistake a real page for one", () => {
    expect(isVantaNotFound({ title: "Tests - Vanta" })).toBe(false);
  });
});

describe("VANTA_BROWSER_PAGES", () => {
  it("gives every declared page a distinct surface", () => {
    const surfaces = VANTA_BROWSER_PAGES.map((page) => page.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("declares no absolute URL, so the tenant is never written down", () => {
    expect(VANTA_BROWSER_PAGES.filter((page) => page.path.includes(VANTA_WEB_ORIGIN))).toEqual([]);
    expect(VANTA_BROWSER_PAGES.filter((page) => page.path.startsWith("/"))).toEqual([]);
  });

  it("declares no empty query value, because an empty value does not override the client's stored view", () => {
    const empty = VANTA_BROWSER_PAGES.flatMap((page) =>
      Object.entries(page.query)
        .filter(([, value]) => value.length === 0)
        .map(([key]) => `${page.surface}.${key}`),
    );
    expect(empty).toEqual([]);
  });

  it("routes the risk register at the path the client actually has", () => {
    const risks = VANTA_BROWSER_PAGES.find((page) => page.surface === "risks-collection")!;
    expect(risks.path).toBe("risk-management/risk-register");
  });
});

describe("vantaControlPage", () => {
  it("selects the control by its provider id, on a query the client cannot silently restore over", () => {
    const page = vantaControlPage({ providerId: "data-encrypted-gdpr" });
    expect(page.path).toBe("controls");
    expect(page.query).toEqual({ controlId: "data-encrypted-gdpr" });
    expect(page.surface).toBe("control:data-encrypted-gdpr");
  });

  it("builds the address Vanta's own client picked, which is what established the shape", () => {
    const url = vantaPageUrl({
      page: vantaControlPage({ providerId: "policies-password-complexity-gdpr" }),
      tenantRoot: "https://app.vanta.com/c/acme",
    });
    expect(url).toBe("https://app.vanta.com/c/acme/controls?controlId=policies-password-complexity-gdpr");
  });

  it("cannot collide with a declared collection surface, whatever a provider id happens to be", () => {
    const declared = new Set(VANTA_BROWSER_PAGES.map((page) => page.surface));
    const colliding = [...declared].filter((surface) => declared.has(vantaControlSurface({ providerId: surface })));
    expect(colliding).toEqual([]);
  });
});
