/**
 * The declared page inventory, its three roots, and the two rules that keep a walk of it honest.
 *
 * The last describe block is the read-only rule made checkable: `browserPages.ts` says no declared route may
 * DO anything, and a rule stated only in prose is a rule the next page added breaks.
 */
import { describe, expect, it } from "vitest";

import type { XeroBrowserPage } from "../../../../atlas/xero/browserPageEntries.js";
import {
  appRootFromFinalUrl,
  isShortCodeSegment,
  isSignInOrigin,
  XERO_ACCOUNT_ORIGIN,
  XERO_BROWSER_PAGES,
  XERO_LOGIN_ORIGIN,
  XERO_REPORTING_ORIGIN,
  XERO_WEB_ORIGIN,
  xeroPageOrigin,
  xeroPageUrl,
} from "../../../../atlas/xero/browserPages.js";
import { XERO_FAMILY_JUDGEMENTS } from "../../../../atlas/xero/families.js";

/** One declared page, with only the fields a test is about stated. */
function page({ over }: { over: Partial<XeroBrowserPage> }): XeroBrowserPage {
  return {
    description: "a page",
    family: null,
    path: "Dashboard",
    query: {},
    root: "origin",
    surface: "a-page",
    ...over,
  };
}

describe("isSignInOrigin", () => {
  it("recognises the origin Xero sends a signed-out browser to", () => {
    expect(isSignInOrigin({ finalUrl: "https://login.xero.com/identity/connect/authorize" })).toBe(true);
  });

  it("does not mistake the web client for the sign-in wall", () => {
    expect(isSignInOrigin({ finalUrl: "https://go.xero.com/Dashboard" })).toBe(false);
  });

  it("answers false for an address it cannot read, rather than throwing mid-walk", () => {
    expect(isSignInOrigin({ finalUrl: "not a url" })).toBe(false);
  });
});

describe("isShortCodeSegment", () => {
  it("recognises the organisation short code Xero writes with a leading bang", () => {
    expect(isShortCodeSegment({ segment: "!Ab3dE-f" })).toBe(true);
  });

  // Getting this wrong in the permissive direction addresses every declared page beneath a page name.
  it("does not mistake an ordinary path segment for an organisation", () => {
    expect(isShortCodeSegment({ segment: "dashboard" })).toBe(false);
  });

  it("does not accept a bare bang with nothing after it", () => {
    expect(isShortCodeSegment({ segment: "!" })).toBe(false);
  });
});

describe("appRootFromFinalUrl", () => {
  it("infers the app root from where a signed-in client sends the bare origin", () => {
    expect(appRootFromFinalUrl({ finalUrl: "https://go.xero.com/app/!Ab3dE/dashboard" })).toBe(
      "https://go.xero.com/app/!Ab3dE",
    );
  });

  it("answers null when the client landed with no short-code segment at all", () => {
    expect(appRootFromFinalUrl({ finalUrl: "https://go.xero.com/Dashboard" })).toBe(null);
  });

  it("answers null when the client landed on another origin entirely", () => {
    expect(appRootFromFinalUrl({ finalUrl: "https://login.xero.com/identity" })).toBe(null);
  });

  it("answers null for an address it cannot read", () => {
    expect(appRootFromFinalUrl({ finalUrl: "not a url" })).toBe(null);
  });

  it("refuses a path whose second segment is not a short code, so a page name cannot become the root", () => {
    expect(appRootFromFinalUrl({ finalUrl: "https://go.xero.com/app/settings/general" })).toBe(null);
  });
});

describe("xeroPageUrl", () => {
  it("addresses an origin-rooted page at the web client", () => {
    expect(xeroPageUrl({ appRoot: null, page: page({ over: { path: "Contacts" } }) })).toBe(
      "https://go.xero.com/Contacts",
    );
  });

  it("addresses an account-rooted page at the account hub", () => {
    expect(xeroPageUrl({ appRoot: null, page: page({ over: { path: "subscriptions", root: "account" } }) })).toBe(
      "https://my.xero.com/subscriptions",
    );
  });

  it("addresses a reporting-rooted page at the origin the report client moved to", () => {
    expect(xeroPageUrl({ appRoot: null, page: page({ over: { path: "reports", root: "reporting" } }) })).toBe(
      "https://reporting.xero.com/reports",
    );
  });

  it("addresses an app-rooted page beneath the root the probe learned", () => {
    expect(
      xeroPageUrl({
        appRoot: "https://go.xero.com/app/!Ab3dE",
        page: page({ over: { path: "dashboard", root: "app" } }),
      }),
    ).toBe("https://go.xero.com/app/!Ab3dE/dashboard");
  });

  it("answers null for an app-rooted page when no short code was found, rather than addressing a wrong URL", () => {
    expect(xeroPageUrl({ appRoot: null, page: page({ over: { path: "dashboard", root: "app" } }) })).toBe(null);
  });

  it("applies declared query state, so a page is not left on whatever view the client last showed", () => {
    expect(xeroPageUrl({ appRoot: null, page: page({ over: { path: "Contacts", query: { status: "ALL" } } }) })).toBe(
      "https://go.xero.com/Contacts?status=ALL",
    );
  });
});

describe("xeroPageOrigin", () => {
  it("names the web origin for an origin-rooted page", () => {
    expect(xeroPageOrigin({ page: page({ over: {} }) })).toBe(XERO_WEB_ORIGIN);
  });

  it("names the account origin for an account-rooted page", () => {
    expect(xeroPageOrigin({ page: page({ over: { root: "account" } }) })).toBe(XERO_ACCOUNT_ORIGIN);
  });

  it("names the reporting origin for a reporting-rooted page", () => {
    expect(xeroPageOrigin({ page: page({ over: { root: "reporting" } }) })).toBe(XERO_REPORTING_ORIGIN);
  });

  it("names the web origin for an app-rooted page, which is where its short code hangs off", () => {
    expect(xeroPageOrigin({ page: page({ over: { root: "app" } }) })).toBe(XERO_WEB_ORIGIN);
  });
});

describe("the declared inventory", () => {
  it("has at least one entry in XERO_BROWSER_PAGES, so the guards below are not vacuously green", () => {
    expect(XERO_BROWSER_PAGES.length).toBeGreaterThan(0);
  });

  it("declares a surface name exactly once, because coverage is keyed on it", () => {
    const surfaces = XERO_BROWSER_PAGES.map((declared) => declared.surface);
    expect(surfaces.filter((surface, index) => surfaces.indexOf(surface) !== index)).toEqual([]);
  });

  it("gives every page a description, because a route with no stated purpose is a route nobody can review", () => {
    expect(XERO_BROWSER_PAGES.filter((declared) => declared.description.length < 10)).toEqual([]);
  });

  it("names only families the judgement table knows, so the page-to-family join cannot rot silently", () => {
    const known = new Set(Object.keys(XERO_FAMILY_JUDGEMENTS));
    expect(
      XERO_BROWSER_PAGES.filter((declared) => declared.family !== null && !known.has(declared.family)).map(
        (declared) => declared.surface,
      ),
    ).toEqual([]);
  });

  it("declares no empty query value, because an empty string is not a way to clear a filter", () => {
    expect(
      XERO_BROWSER_PAGES.filter((declared) => Object.values(declared.query).some((value) => value.length === 0)),
    ).toEqual([]);
  });

  // `browserPages.ts`'s fourth rule, made checkable. A walk NAVIGATES; a route whose visit is an action
  // would make it a write surface, and the read-only property is held by construction rather than by a guard.
  //
  // Matched on whole path SEGMENTS rather than as substrings, and that is not a weakening: a substring rule
  // reads `payroll` as `pay` and `Settings/PaymentServices.aspx` as an act of paying somebody, so it flags
  // four legitimate read-only pages and would be switched off the first time somebody hit it.
  it("declares no route whose name is an action rather than a page", () => {
    const actions = new Set(["logout", "signout", "delete", "void", "approve", "pay", "invite", "export", "upgrade"]);
    const offending = XERO_BROWSER_PAGES.filter((declared) =>
      declared.path
        .toLowerCase()
        .split(/[/.]/)
        .some((segment) => actions.has(segment)),
    );
    expect(offending.map((declared) => declared.surface)).toEqual([]);
  });

  // Compared as a whole ORIGIN rather than as a substring, which is the same reason `isFirstPartyXeroCall`
  // is a suffix test: `https://login.xero.com.evil.test` contains the sign-in host and is not it.
  it("declares no page on the sign-in origin, which would make the lost-session signal ambiguous", () => {
    expect(XERO_BROWSER_PAGES.filter((declared) => xeroPageOrigin({ page: declared }) === XERO_LOGIN_ORIGIN)).toEqual(
      [],
    );
  });

  it("covers both halves of spend-per-vendor: the supplier list and the bills that name amounts", () => {
    const families = XERO_BROWSER_PAGES.map((declared) => declared.family);
    expect(families).toContain("api.xro/2.0:Contacts");
    expect(families).toContain("api.xro/2.0:Invoices");
  });
});
