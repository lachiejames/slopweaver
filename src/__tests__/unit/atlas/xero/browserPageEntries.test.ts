/*
 * The Xero page list is joined from two partial arrays, and the join is the one place an entry could be dropped,
 * duplicated or reordered. These cases pin the joined list's size, both ends, its whole surface order, and that
 * the bookkeeping half leads it.
 */
import { describe, expect, it } from "vitest";

import { XERO_BOOKKEEPING_PAGES } from "../../../../atlas/xero/browserPageEntries.js";
import { XERO_BROWSER_PAGES } from "../../../../atlas/xero/browserPages.js";

/** Every declared surface, in the order a walk visits them. */
const EXPECTED_SURFACES: readonly string[] = [
  "app-dashboard",
  "dashboard",
  "bank-accounts",
  "app-bank",
  "chart-of-accounts",
  "app-chart-of-accounts",
  "contacts",
  "app-contacts",
  "app-contacts-suppliers",
  "bills",
  "app-bills",
  "invoices",
  "app-invoicing",
  "purchase-orders",
  "quotes",
  "credit-notes",
  "manual-journals",
  "reports",
  "reporting-reports",
  "inventory",
  "fixed-assets",
  "expenses",
  "projects",
  "payroll",
  "app-payroll-employees",
  "files",
  "settings",
  "organisation-settings",
  "organisation-details",
  "settings-users",
  "settings-tax-rates",
  "settings-tracking",
  "settings-currencies",
  "settings-branding",
  "settings-payment-services",
  "settings-connected-apps",
  "account-connected-apps",
  "account-subscriptions",
  "account-organisations",
  "account-profile",
  "account-home",
];

describe("the joined Xero page list", () => {
  it("holds all 41 declared pages", () => {
    expect(XERO_BROWSER_PAGES).toHaveLength(41);
  });

  it("opens on the app-root dashboard", () => {
    expect(XERO_BROWSER_PAGES[0]!.surface).toBe("app-dashboard");
    expect(XERO_BROWSER_PAGES[0]!.path).toBe("dashboard");
  });

  it("closes on the account hub's landing page, whose path is empty", () => {
    expect(XERO_BROWSER_PAGES[40]!.surface).toBe("account-home");
    expect(XERO_BROWSER_PAGES[40]!.path).toBe("");
  });

  it("lists every surface in its declared order", () => {
    expect(XERO_BROWSER_PAGES.map((declared) => declared.surface)).toEqual(EXPECTED_SURFACES);
  });

  it("leads with the 26 bookkeeping pages, in their declared order", () => {
    expect(XERO_BOOKKEEPING_PAGES).toHaveLength(26);
    expect(XERO_BROWSER_PAGES.slice(0, XERO_BOOKKEEPING_PAGES.length)).toEqual(XERO_BOOKKEEPING_PAGES);
  });

  it("ends the bookkeeping half on the file library and starts the settings half on the settings hub", () => {
    expect(XERO_BOOKKEEPING_PAGES[25]!.surface).toBe("files");
    expect(XERO_BROWSER_PAGES[26]!.surface).toBe("settings");
  });
});
