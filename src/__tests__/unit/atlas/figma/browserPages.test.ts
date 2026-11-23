import { describe, expect, it } from "vitest";

import {
  FIGMA_BROWSER_PAGES,
  FIGMA_ROUTE_EVIDENCE,
  figmaAbsentRoutes,
  figmaConfirmedRoutes,
} from "../../../../atlas/figma/browserPages.js";

/** The origin `projection.ts` resolves every declared route against. */
const FIGMA_WEB_ORIGIN = "https://www.figma.com";

describe("the declared Figma browser route inventory", () => {
  // Resolved against Figma's own origin, not matched as a substring: a route is a path, and the thing that
  // makes that worth asserting is that a protocol-relative `//elsewhere/x` also starts with a slash.
  it("declares every route once, and none of them can leave Figma's own origin", () => {
    const routes = FIGMA_BROWSER_PAGES.map((page) => page.route);

    expect(new Set(routes).size).toBe(routes.length);
    expect(routes.filter((route) => !route.startsWith("/"))).toEqual([]);
    expect(routes.filter((route) => new URL(route, FIGMA_WEB_ORIGIN).origin !== FIGMA_WEB_ORIGIN)).toEqual([]);
  });

  // Every route is a TEMPLATE. This organisation's team, project, org and file ids are provider
  // identifiers this repository may not carry.
  it("carries no concrete identifier, only braced parameters", () => {
    const parameterised = FIGMA_BROWSER_PAGES.filter((page) => page.route.includes("{"));
    const digits = FIGMA_BROWSER_PAGES.filter((page) => /\d/u.test(page.route));

    expect(parameterised.length).toBeGreaterThan(0);
    expect(digits.map((page) => page.route)).toEqual([]);
  });

  it("gives every route an evidence class from the closed vocabulary and a reader-facing description", () => {
    const unknown = FIGMA_BROWSER_PAGES.filter((page) => !FIGMA_ROUTE_EVIDENCE.includes(page.evidence));
    const undescribed = FIGMA_BROWSER_PAGES.filter((page) => page.holds.length === 0);

    expect(unknown.map((page) => page.route)).toEqual([]);
    expect(undescribed.map((page) => page.route)).toEqual([]);
  });

  // The measurement this whole file rests on, expressed as a count so a re-probe that quietly changes one
  // row's grade fails here rather than in somebody's memory.
  it("holds the counts the coverage cell reports", () => {
    expect(FIGMA_BROWSER_PAGES.length).toBe(41);
    expect(figmaConfirmedRoutes().length).toBe(23);
    expect(figmaAbsentRoutes().length).toBe(2);
  });

  // A gated redirect confirms the PREFIX, not the leaf: an invented sibling answers identically. Counting
  // one as a confirmation is the over-claim `tools/probeFigmaRoutes.ts` caught in this file's first draft.
  it("counts no prefix-only redirect as a confirmation", () => {
    const confirmed = figmaConfirmedRoutes().map((page) => page.evidence);

    expect(confirmed.filter((evidence) => evidence === "auth-gated-prefix")).toEqual([]);
    expect(confirmed.filter((evidence) => evidence === "absent-404")).toEqual([]);
    expect(FIGMA_BROWSER_PAGES.filter((page) => page.evidence === "auth-gated-prefix").length).toBe(16);
  });

  // The owner's ruling: settings and admin pages get a screenshot; a page whose content is the
  // organisation's own design work does not, because photographing it is holding the entities twice.
  it("photographs no page whose content is the organisation's own design work", () => {
    const canvases = FIGMA_BROWSER_PAGES.filter((page) => page.route.includes("{fileKey}"));

    expect(canvases.length).toBeGreaterThan(0);
    expect(canvases.filter((page) => page.screenshot).map((page) => page.route)).toEqual([]);
  });

  it("photographs the settings and team-administration pages, which no REST operation returns", () => {
    const wanted = FIGMA_BROWSER_PAGES.filter((page) => page.screenshot).map((page) => page.route);

    expect(wanted).toContain("/settings/organization");
    expect(wanted).toContain("/files/team/{teamId}/members");
    expect(wanted).toContain("/files/org/{orgId}");
  });

  // A probed absence is atlas content. A reader who guesses `/admin` learns from the atlas that Figma has
  // no such route, rather than from a browser.
  it("keeps the routes it established are NOT there, and never photographs one", () => {
    const absent = figmaAbsentRoutes();

    expect(absent.map((page) => page.route).toSorted()).toEqual(["/admin", "/organization/{orgId}"]);
    expect(absent.filter((page) => page.screenshot).map((page) => page.route)).toEqual([]);
  });
});
