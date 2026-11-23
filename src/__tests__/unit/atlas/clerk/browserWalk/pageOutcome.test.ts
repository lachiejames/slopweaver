/**
 * How one settled Clerk page is graded. Clerk's dashboard is a single-page client that answers an unrecognised
 * route by rewriting the address to the instance overview and returning 200, so the interesting failure is a
 * SILENT redirect rather than a 404 — and the reason it records may never quote the settled path.
 */
import { describe, expect, it } from "vitest";

import { clerkPageOutcome } from "../../../../../atlas/clerk/browserWalk.js";
import { CLERK_DASHBOARD_ORIGIN } from "../../../../../atlas/clerk/dashboardAddress.js";

import { capture } from "../../../../walkTransportFake.js";
import { INSTANCE_ROOT, PAGE_URL } from "./harness.js";

describe("clerkPageOutcome", () => {
  it("holds a page the client settled on exactly", () => {
    expect(clerkPageOutcome({ capture: capture({ over: {}, url: PAGE_URL }), requestedUrl: PAGE_URL })).toEqual({
      redirected: false,
      unreachableBecause: null,
    });
  });

  it("tolerates a query string, because the client restores its own view state", () => {
    const settled = capture({ over: { finalUrl: `${PAGE_URL}?filter=admins` }, url: PAGE_URL });
    expect(clerkPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).redirected).toBe(false);
  });

  it("treats a trailing slash as the same address", () => {
    const settled = capture({ over: { finalUrl: `${PAGE_URL}/` }, url: PAGE_URL });
    expect(clerkPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause).toBe(null);
  });

  // A sign-in wall is a 200 on a route the walk did not ask for, so it has to be read BEFORE the path rule
  // or a lost session reads as forty separately-moved pages.
  it("recognises the sign-in wall before the path rule", () => {
    const settled = capture({ over: { finalUrl: "https://accounts.clerk.com/sign-in" }, url: PAGE_URL });
    expect(clerkPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause).toContain(
      "no longer signed in",
    );
  });

  it("names the origin when the client settled somewhere else entirely", () => {
    const settled = capture({ over: { finalUrl: "https://clerk.com/pricing" }, url: PAGE_URL });
    expect(clerkPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause).toContain(
      "https://clerk.com",
    );
  });

  // The whole Clerk failure mode: 200, same origin, a route the client quietly rewrote to the overview.
  it("records a same-origin rewrite as unreachable, and says the client did not keep the address", () => {
    const settled = capture({ over: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}${INSTANCE_ROOT}` }, url: PAGE_URL });
    expect(clerkPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause).toContain(
      "did not keep this address",
    );
  });

  // The settled path carries the application and instance identifiers, so it may never be quoted.
  it("does not quote the settled path, which carries two private identifiers", () => {
    const settled = capture({
      over: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps/app_2zzzzzzzzzzzzzzzz/instances/ins_2zzzzzzzzzzzzzzzz` },
      url: PAGE_URL,
    });
    const because = clerkPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause;
    expect(because).not.toContain("app_2zzzzzzzzzzzzzzzz");
    expect(because).not.toContain("ins_2zzzzzzzzzzzzzzzz");
  });

  it("carries the status code the client answered the rewrite with, so 200 is visible in the reason", () => {
    const settled = capture({
      over: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}${INSTANCE_ROOT}`, statusCode: 200 },
      url: PAGE_URL,
    });
    expect(clerkPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause).toContain("200");
  });

  it("refuses an address it cannot read rather than grading it reached", () => {
    const settled = capture({ over: { finalUrl: "::::" }, url: PAGE_URL });
    expect(clerkPageOutcome({ capture: settled, requestedUrl: PAGE_URL })).toEqual({
      redirected: true,
      unreachableBecause: "the browser settled on an address this atlas cannot read",
    });
  });
});
