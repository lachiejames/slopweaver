import { describe, expect, it } from "vitest";

import {
  isConsolePath,
  TWILIO_BROWSER_PAGES,
  TWILIO_CONSOLE_ORIGIN,
  TWILIO_REGION_PLACEHOLDER,
  toDeclaredRoute,
  twilioConsoleUrl,
} from "../../../../atlas/twilio/browserPages.js";

describe("the declared Twilio console page list", () => {
  it("declares every route Twilio's own documentation names", () => {
    expect(TWILIO_BROWSER_PAGES.length).toBe(80);
  });

  // The provenance is what makes the denominator checkable rather than a claim about the author's memory.
  it("carries the documentation page that named each route", () => {
    for (const page of TWILIO_BROWSER_PAGES) {
      expect(page.citedBy.length).toBeGreaterThan(0);
      for (const url of page.citedBy) {
        expect(url.startsWith("https://www.twilio.com/docs/")).toBe(true);
      }
    }
  });

  // A region is an installation fact, so it lives in the generation and never in the repository.
  it("holds a placeholder rather than a home region", () => {
    for (const page of TWILIO_BROWSER_PAGES) {
      expect(/\/(?:us|ie|au|jp|br|sg|de)\d\//.test(page.route)).toBe(false);
    }
    expect(TWILIO_BROWSER_PAGES.some((page) => page.route.includes(TWILIO_REGION_PLACEHOLDER))).toBe(true);
  });

  // `docs/atlas-intent/06-holdings.md`: a list surface is one declared page and a row never gets a route of its own.
  it("declares no route naming one individual record", () => {
    for (const page of TWILIO_BROWSER_PAGES) {
      expect(/[A-Z]{2}[0-9a-fA-F]{32}/.test(page.route)).toBe(false);
    }
  });

  it("declares no sign-up or upgrade redirect", () => {
    const routes = TWILIO_BROWSER_PAGES.map((page) => page.route);
    expect(routes).not.toContain("/go");
    expect(routes).not.toContain("/account/go");
    expect(routes).not.toContain("/account/upgrade");
  });

  it("names one route exactly once, so the denominator cannot double-count", () => {
    expect(new Set(TWILIO_BROWSER_PAGES.map((page) => page.route)).size).toBe(TWILIO_BROWSER_PAGES.length);
  });

  it("groups every route under one of Twilio's own console sections", () => {
    expect([...new Set(TWILIO_BROWSER_PAGES.map((page) => page.section))].toSorted()).toEqual([
      "account",
      "develop",
      "monitor",
      "organization",
      "user",
    ]);
  });

  it("resolves a declared route to an absolute console URL for a discovered region", () => {
    expect(twilioConsoleUrl({ region: "ie1", route: "/{region}/develop/sms/services" })).toBe(
      `${TWILIO_CONSOLE_ORIGIN}/ie1/develop/sms/services`,
    );
  });

  it("leaves a route carrying no region placeholder alone", () => {
    expect(twilioConsoleUrl({ region: "us1", route: "/organization/settings/overview" })).toBe(
      `${TWILIO_CONSOLE_ORIGIN}/organization/settings/overview`,
    );
  });

  it("folds an observed region prefix back to the placeholder, so one page is one row", () => {
    expect(toDeclaredRoute({ path: "/au1/monitor/logs/calls" })).toBe("/{region}/monitor/logs/calls");
    expect(toDeclaredRoute({ path: "/organization/settings/overview" })).toBe("/organization/settings/overview");
  });

  it("treats any non-root path as a console surface, so the frontier is not narrowed by this filter", () => {
    expect(isConsolePath({ path: "/us1/develop/sms/services" })).toBe(true);
    expect(isConsolePath({ path: "/" })).toBe(false);
  });
});
