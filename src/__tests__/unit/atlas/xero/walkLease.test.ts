/**
 * The Xero walk's relay lease: every origin a declared page is addressed at, the sign-in, and the employee
 * portal the console redirects to.
 *
 * MEASURED: signed in, the console redirect to the employee portal was off the lease, which stopped
 * the walk at its first declared page instead of grading the page.
 */
import { describe, expect, it } from "vitest";

import {
  XERO_BROWSER_PAGES,
  XERO_LOGIN_ORIGIN,
  XERO_WEB_ORIGIN,
  xeroPageOrigin,
} from "../../../../atlas/xero/browserPages.js";
import { xeroPageOutcome } from "../../../../atlas/xero/browserWalk.js";
import { XERO_PAYROLL_ORIGIN, XERO_WALK_LEASE_ORIGINS } from "../../../../atlas/xero/walkLease.js";
import { capture } from "../../../walkTransportFake.js";

describe("the walk's relay lease", () => {
  it("admits every origin a page is addressed at, the sign-in, and the employee portal it is redirected to", () => {
    const addressed = [...new Set(XERO_BROWSER_PAGES.map((declared) => xeroPageOrigin({ page: declared })))];
    expect(addressed.length).toBeGreaterThan(0);
    expect(addressed.filter((origin) => !XERO_WALK_LEASE_ORIGINS.includes(origin))).toEqual([]);
    expect(XERO_WALK_LEASE_ORIGINS).toContain(XERO_LOGIN_ORIGIN);
    expect(XERO_WALK_LEASE_ORIGINS).toContain(XERO_PAYROLL_ORIGIN);
  });

  it("grades a console page the client sent to the employee portal as a redirect naming that origin", () => {
    const requestedUrl = `${XERO_WEB_ORIGIN}/app/!abcde/dashboard`;
    const settled = capture({
      over: { finalUrl: `${XERO_PAYROLL_ORIGIN}/EmployeePortal?CID=!abcde` },
      url: requestedUrl,
    });
    expect(xeroPageOutcome({ capture: settled, requestedUrl })).toEqual({
      redirected: true,
      unreachableBecause: `the client sent this address to ${XERO_PAYROLL_ORIGIN}, which is not where it was asked to go`,
    });
  });
});
