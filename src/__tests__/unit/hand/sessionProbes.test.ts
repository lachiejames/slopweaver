import { describe, expect, it } from "vitest";

import { XERO_PAYROLL_ORIGIN, XERO_WALK_LEASE_ORIGINS } from "../../../atlas/xero/walkLease.js";
import { browserSessionVerdict, sessionProbePlatform, sessionProbeVisit } from "../../../hand/sessionProbes.js";

const CLERK = "https://dashboard.clerk.com";
const XERO = "https://go.xero.com";

describe("sessionProbePlatform — which origins the fleet reads a sign-in at", () => {
  it.each([
    [CLERK, "clerk"],
    ["https://go.xero.com", "xero"],
    ["https://app.hex.tech", "hex"],
    ["https://acme.trelica.app", "trelica"],
    ["https://console.cloud.google.com", undefined],
    ["http://acme.trelica.app", undefined],
    ["https://evil.acme.trelica.app", undefined],
  ])("%s → %s", (origin, platform) => {
    expect(sessionProbePlatform({ origin })).toBe(platform);
  });

  it("carries each platform's own settle time, on a lease of the asked origin alone", () => {
    expect(sessionProbeVisit({ origin: CLERK })).toEqual({ leaseOrigins: [CLERK], platform: "clerk", settleMs: 6000 });
  });

  it("visits a Trelica tenant on a lease that admits the vendor's sign-in origin, so a landing there is judged", () => {
    expect(sessionProbeVisit({ origin: "https://acme.trelica.app" })).toEqual({
      leaseOrigins: ["https://acme.trelica.app", "https://app.trelica.com"],
      platform: "trelica",
      settleMs: 9000,
    });
  });

  it("visits Xero on its walk's own lease, so the payroll redirect and the sign-in page are both judged", () => {
    expect(sessionProbeVisit({ origin: XERO })!.leaseOrigins).toEqual(XERO_WALK_LEASE_ORIGINS);
    expect(XERO_WALK_LEASE_ORIGINS).toContain(XERO_PAYROLL_ORIGIN);
    expect(XERO_WALK_LEASE_ORIGINS).toContain("https://login.xero.com");
  });
});

describe("browserSessionVerdict — signed in only on positive evidence", () => {
  it("is signed in on a same-origin landing that is not the sign-in page", () => {
    expect(
      browserSessionVerdict({ finalUrl: `${CLERK}/apps/app_1/instances/ins_1`, origin: CLERK, statusCode: 200 }),
    ).toEqual({ kind: "signed-in", observed: `clerk opened ${CLERK} signed in, no sign-in page` });
  });

  it("is signed in when Xero sends go.xero.com on to its payroll employee portal", () => {
    expect(
      browserSessionVerdict({
        finalUrl: `${XERO_PAYROLL_ORIGIN}/EmployeePortal?CID=!abcde`,
        origin: XERO,
        statusCode: 200,
      }),
    ).toEqual({
      kind: "signed-in",
      observed: `xero opened ${XERO} signed in, landing on ${XERO_PAYROLL_ORIGIN}, no sign-in page`,
    });
  });

  it("reads a payroll landing as a Xero landing only, never another platform's", () => {
    expect(
      browserSessionVerdict({ finalUrl: `${XERO_PAYROLL_ORIGIN}/EmployeePortal`, origin: CLERK, statusCode: 200 }),
    ).toEqual({ kind: "signed-out", observed: `${CLERK} sent the browser to ${XERO_PAYROLL_ORIGIN}` });
  });

  it("is signed out when the payroll landing answers an HTTP error", () => {
    expect(browserSessionVerdict({ finalUrl: `${XERO_PAYROLL_ORIGIN}/`, origin: XERO, statusCode: 500 })).toEqual({
      kind: "signed-out",
      observed: `${XERO} answered HTTP 500`,
    });
  });

  it("is signed in when the Trelica tenant renders an app page on its own origin", () => {
    expect(
      browserSessionVerdict({
        finalUrl: "https://acme.trelica.app/Catalog",
        origin: "https://acme.trelica.app",
        statusCode: 200,
      }),
    ).toEqual({
      kind: "signed-in",
      observed: "trelica opened https://acme.trelica.app signed in, no sign-in page",
    });
  });

  it("is signed in when the transport saw no document status", () => {
    expect(browserSessionVerdict({ finalUrl: `${CLERK}/`, origin: CLERK, statusCode: null }).kind).toBe("signed-in");
  });

  it.each([
    [CLERK, `${CLERK}/sign-in`, 200, `${CLERK} settled on its own sign-in page`],
    [CLERK, "https://welcome.accounts.dev/sign-in", 200, `${CLERK} sent the browser to https://welcome.accounts.dev`],
    ["https://go.xero.com", "https://login.xero.com/identity", 200, "sent the browser to https://login.xero.com"],
    ["https://app.hex.tech", "https://app.hex.tech/login", 200, "settled on its own sign-in page"],
    ["https://app.hex.tech", "https://app.hex.tech/login/sso", 200, "settled on its own sign-in page"],
    ["https://acme.trelica.app", "https://app.trelica.com/Login", 200, "sent the browser to https://app.trelica.com"],
    [
      "https://acme.trelica.app",
      "https://acme.trelica.app/Account/Login?ReturnUrl=%2F",
      200,
      "https://acme.trelica.app settled on its own sign-in page",
    ],
    [CLERK, `${CLERK}/`, 503, `${CLERK} answered HTTP 503`],
    [CLERK, "not a url", 200, "an unreadable address"],
    ["https://example.com", "https://example.com/", 200, "no sign-in test is registered for https://example.com"],
  ])("is signed out asking %s and settling on %s", (origin, finalUrl, statusCode, observed) => {
    const verdict = browserSessionVerdict({ finalUrl, origin, statusCode });
    expect(verdict.kind).toBe("signed-out");
    expect(verdict.observed).toContain(observed);
  });

  it("never carries the settled page's path, only its origin", () => {
    const verdict = browserSessionVerdict({
      finalUrl: "https://welcome.accounts.dev/sign-in?redirect_url=secret-looking-token",
      origin: CLERK,
      statusCode: 200,
    });
    expect(verdict.observed).toBe(`${CLERK} sent the browser to https://welcome.accounts.dev`);
  });
});

describe("the Google Admin console — signed out on any Google accounts page", () => {
  const ADMIN = "https://admin.google.com";
  const ACCOUNTS = "https://accounts.google.com";

  it("visits the console on a lease that admits Google's accounts origin, so a sign-in wall is judged", () => {
    expect(sessionProbeVisit({ origin: ADMIN })).toEqual({
      leaseOrigins: [ADMIN, ACCOUNTS],
      platform: "google-admin",
      settleMs: 6000,
    });
  });

  it("is signed in when the console renders on its own origin", () => {
    expect(browserSessionVerdict({ finalUrl: `${ADMIN}/ac/home`, origin: ADMIN, statusCode: 200 })).toEqual({
      kind: "signed-in",
      observed: `google-admin opened ${ADMIN} signed in, no sign-in page`,
    });
  });

  it.each([
    `${ACCOUNTS}/v3/signin/identifier?continue=https%3A%2F%2Fadmin.google.com`,
    `${ACCOUNTS}/v2/challenge/pwd?TL=token`,
    `${ACCOUNTS}/ServiceLogin?service=CPanel`,
  ])("is signed out settling on %s, naming the origin and never the path", (finalUrl) => {
    expect(browserSessionVerdict({ finalUrl, origin: ADMIN, statusCode: 200 })).toEqual({
      kind: "signed-out",
      observed: `${ADMIN} sent the browser to ${ACCOUNTS}`,
    });
  });
});
