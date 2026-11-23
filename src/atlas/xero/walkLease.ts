/**
 * Every origin a Xero walk's relay lease admits, and the one it is redirected to without asking.
 *
 * Its own module rather than `browserPages.ts`: that file declares the pages a walk ASKS for, and this one
 * says where a walk may END UP.
 */
import { XERO_ACCOUNT_ORIGIN, XERO_LOGIN_ORIGIN, XERO_REPORTING_ORIGIN, XERO_WEB_ORIGIN } from "./browserPages.js";

/**
 * The origin Xero's employee portal is served from, where an employee-only login's console routes redirect.
 *
 * No page is declared there: it is a place the client SENDS a walk, MEASURED (`descriptor.ts`).
 */
export const XERO_PAYROLL_ORIGIN = "https://payroll.xero.com";

/**
 * Every origin a Xero walk's relay lease admits: the three it addresses, the sign-in it can be sent to, and the
 * employee portal it is redirected to.
 *
 * The payroll origin is here because an off-lease settle STOPS the walk rather than grading the page. MEASURED
 * (`recipe-failing-resync-atlas-xero-2026-09-26t14-00-00.000z-a2`): signed in, the walk stopped at
 * its first declared page on `payroll.xero.com` and read nothing after it, where the same redirect had been graded per page
 * before the lease existed.
 */
export const XERO_WALK_LEASE_ORIGINS: readonly string[] = [
  XERO_WEB_ORIGIN,
  XERO_ACCOUNT_ORIGIN,
  XERO_REPORTING_ORIGIN,
  XERO_PAYROLL_ORIGIN,
  XERO_LOGIN_ORIGIN,
];
