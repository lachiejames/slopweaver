/**
 * The walk spec Clerk hands the shared page-walk engine: which pages it walks, what it photographs, what reads
 * as a lost session, how a page is addressed with and without an instance root, and how long a page settles.
 * The ENGINE's own behaviour is `kit/pageWalk/`.
 */
import { describe, expect, it } from "vitest";

import { CLERK_BROWSER_PAGES } from "../../../../../atlas/clerk/browserPages.js";
import { CLERK_PAGE_SETTLE_MS, clerkPageWalkSpec } from "../../../../../atlas/clerk/browserWalk.js";
import { CLERK_DASHBOARD_ORIGIN } from "../../../../../atlas/clerk/dashboardAddress.js";

import { capture } from "../../../../walkTransportFake.js";
import { PAGE_URL } from "./harness.js";

describe("clerkPageWalkSpec", () => {
  const spec = clerkPageWalkSpec({ remembered: null, rememberRoot: () => undefined });

  it("walks the declared inventory and nothing else", () => {
    expect(spec.pages).toBe(CLERK_BROWSER_PAGES);
  });

  it("photographs every page it reaches, because nothing this dashboard renders is withheld", () => {
    expect(spec.photographPolicy({ page: CLERK_BROWSER_PAGES[0]! })).toBe(null);
  });

  it("reads a settle on a sign-in wall as the session ending", () => {
    const settled = capture({ over: { finalUrl: "https://acme.accounts.dev/sign-in" }, url: PAGE_URL });
    expect(spec.sessionLostOn({ capture: settled })).toBe(true);
  });

  it("reads an ordinary settle as the session continuing", () => {
    expect(spec.sessionLostOn({ capture: capture({ over: {}, url: PAGE_URL }) })).toBe(false);
  });

  it("cannot address an instance page with no root", () => {
    const instancePage = CLERK_BROWSER_PAGES.find((page) => page.root === "instance")!;
    expect(spec.urlFor({ page: instancePage, root: null })).toBe(null);
  });

  it("addresses an account page with no root, because it hangs off the origin", () => {
    const accountPage = CLERK_BROWSER_PAGES.find((page) => page.root === "account")!;
    expect(spec.urlFor({ page: accountPage, root: null })).toContain(CLERK_DASHBOARD_ORIGIN);
  });

  it("lets a page settle for six seconds, so the deferred half of its own call chain is caught", () => {
    expect(spec.settleMs).toBe(CLERK_PAGE_SETTLE_MS);
  });
});
