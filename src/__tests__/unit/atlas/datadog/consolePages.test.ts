/**
 * The declared console page list, judged against the rules its own header states.
 *
 * The list was read from the live left nav on one date, so what a test can prove is not that it matches
 * the console today — the walk's nav leg does that — but that every row obeys the exclusion rule, that no
 * page is declared twice, and that the drift and redirect checks turn evidence into the right gap.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import {
  canonicalNavHref,
  DATADOG_CONSOLE_NAV_READ_AT,
  DATADOG_CONSOLE_ROUTES,
  DATADOG_CONSOLE_SECTIONS,
  isConsolePageHref,
  navDrift,
  undeclaredDestinations,
} from "../../../../atlas/datadog/consolePages.js";

const ORIGIN = "https://ap1.datadoghq.invalid";

describe("DATADOG_CONSOLE_ROUTES", () => {
  it("declares a real list, read on a stated date", () => {
    expect(DATADOG_CONSOLE_ROUTES.length).toBeGreaterThan(0);
    expect(DATADOG_CONSOLE_NAV_READ_AT).toBe("2026-09-16");
  });

  it("declares every page once, by href", () => {
    const hrefs = DATADOG_CONSOLE_ROUTES.map((route) => route.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("declares nothing the exclusion rule refuses — no org resource, no off-origin link, no org id", () => {
    expect(DATADOG_CONSOLE_ROUTES.filter((route) => !isConsolePageHref({ href: route.href }))).toStrictEqual([]);
  });

  it("files every route under a declared section, and leaves no section empty", () => {
    const sections = new Set(DATADOG_CONSOLE_SECTIONS.map((section) => section.id));
    expect(DATADOG_CONSOLE_ROUTES.filter((route) => !sections.has(route.section))).toStrictEqual([]);
    for (const section of DATADOG_CONSOLE_SECTIONS) {
      expect(DATADOG_CONSOLE_ROUTES.some((route) => route.section === section.id)).toBe(true);
    }
  });

  it("marks the pages that render a creation form as compose, and nothing else", () => {
    const compose = DATADOG_CONSOLE_ROUTES.filter((route) => route.posture === "compose").map((route) => route.href);
    expect(compose).toContain("/monitors/create");
    expect(compose).toContain("/workflow/create");
    expect(compose).not.toContain("/monitors/manage");
  });

  it("carries the nav's own badge-free labels", () => {
    const badged = DATADOG_CONSOLE_ROUTES.filter((route) => / (new|preview|beta)$/.test(route.label));
    expect(badged).toStrictEqual([]);
  });
});

describe("isConsolePageHref", () => {
  it("refuses one of the organisation's own dashboards", () => {
    expect(isConsolePageHref({ href: "/dashboard/abc-def-ghi/partners-sync-failures" })).toBe(false);
  });

  it("refuses a team addressed by uuid", () => {
    expect(isConsolePageHref({ href: "/teams/a0000011-0000-4000-8000-000000000012/platform" })).toBe(false);
  });

  it("refuses a query carrying the organisation's id", () => {
    expect(isConsolePageHref({ href: "/personal-settings/organizations/qrcode?orgUuid=00000000-0000" })).toBe(false);
  });

  it("refuses an absolute link off the console", () => {
    expect(isConsolePageHref({ href: "https://help.datadoghq.com/" })).toBe(false);
  });

  it("accepts the dashboard LIST, which is a page and not a dashboard", () => {
    expect(isConsolePageHref({ href: "/dashboard/lists" })).toBe(true);
  });
});

describe("canonicalNavHref", () => {
  it("drops the nav's click-tracking parameter and the `?` it leaves behind", () => {
    expect(canonicalNavHref({ href: "/bits-ai/investigations?from-top-level-nav=true" })).toBe(
      "/bits-ai/investigations",
    );
  });

  it("keeps a query that names the page", () => {
    expect(canonicalNavHref({ href: "/software?lens=Ownership" })).toBe("/software?lens=Ownership");
  });
});

describe("undeclaredDestinations", () => {
  it("names a same-origin landing the list does not declare, once, sorted", () => {
    const finalUrls = [
      `${ORIGIN}/somewhere/new`,
      `${ORIGIN}/somewhere/new`,
      `${ORIGIN}/another`,
      `${ORIGIN}/monitors/manage`,
    ];
    expect(undeclaredDestinations({ finalUrls, origin: ORIGIN })).toStrictEqual(["/another", "/somewhere/new"]);
  });

  it("ignores a foreign destination and one the exclusion rule refuses", () => {
    const finalUrls = ["https://elsewhere.invalid/x", `${ORIGIN}/dashboard/abc-def-ghi/one`];
    expect(undeclaredDestinations({ finalUrls, origin: ORIGIN })).toStrictEqual([]);
  });
});

describe("navDrift", () => {
  const declared = [
    { href: "/a", label: "A", posture: "read" as const, section: "one" },
    { href: "/b", label: "B", posture: "read" as const, section: "one" },
    { href: "/c", label: "C", posture: "read" as const, section: "two" },
  ];

  it("reports a live page the list lacks, and a declared page the live nav lacks", () => {
    const live = [
      { href: "/a", label: "A", section: "One" },
      { href: "/new?from-top-level-nav=true", label: "New", section: "One" },
      { href: "/c", label: "C", section: "Two" },
    ];
    expect(navDrift({ declared, hovered: ["one", "two"], live })).toStrictEqual({ gone: ["/b"], undeclared: ["/new"] });
  });

  it("never reports a section's routes gone when that section was not hovered", () => {
    const live = [{ href: "/a", label: "A", section: "One" }];
    expect(navDrift({ declared, hovered: ["one"], live })).toStrictEqual({ gone: ["/b"], undeclared: [] });
  });

  it("ignores live links the exclusion rule refuses", () => {
    const live = [
      { href: "/a", label: "A", section: "One" },
      { href: "/b", label: "B", section: "One" },
      { href: "/c", label: "C", section: "Two" },
      { href: "/dashboard/abc-def-ghi/pinned", label: "Pinned", section: "Two" },
      { href: "https://help.datadoghq.com/", label: "Support", section: "Two" },
    ];
    expect(navDrift({ declared, hovered: ["one", "two"], live })).toStrictEqual({ gone: [], undeclared: [] });
  });
});

describe("the screenshot policy", () => {
  it("withholds a picture of every occurrence explorer and every page listing people", () => {
    const withheld = new Set(
      DATADOG_CONSOLE_ROUTES.filter((route) => route.photograph === "withheld").map((route) => route.href),
    );
    for (const href of [
      "/logs",
      "/rum/sessions",
      "/rum/replay/search",
      "/apm/traces",
      "/error-tracking",
      "/event/explorer",
      "/audit-trail",
      "/security/signals",
      "/organization-settings/users",
      "/organization-settings/teams",
      "/personal-settings/profile",
    ]) {
      expect(withheld.has(href)).toBe(true);
    }
  });

  it("permits a configuration page's picture, which is what a proof screenshot is FOR", () => {
    const permitted = DATADOG_CONSOLE_ROUTES.filter((route) => route.photograph === undefined).map(
      (route) => route.href,
    );
    expect(permitted).toContain("/monitors/manage");
    expect(permitted).toContain("/dashboard/lists");
    expect(permitted).toContain("/logs/pipelines");
  });
});
