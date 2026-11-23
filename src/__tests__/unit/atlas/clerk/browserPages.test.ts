/**
 * The declared page inventory, the two root probes, and the sign-in test that keeps one sign-out from
 * becoming forty page failures.
 *
 * `clerkInstanceRootFromTraffic` is the one this file exists for: it was written because the origin probe
 * alone returned an answer that depended on where the owner's browser had last been pointed, and a probe
 * like that is not a probe.
 */
import { describe, expect, it } from "vitest";

import { CLERK_BROWSER_PAGES, clerkDeclaredPageSurfaces } from "../../../../atlas/clerk/browserPages.js";
import {
  clerkInstanceRootFromFinalUrl,
  clerkInstanceRootFromTraffic,
  clerkPageUrl,
  isClerkSignInUrl,
} from "../../../../atlas/clerk/dashboardAddress.js";

describe("CLERK_BROWSER_PAGES", () => {
  it("gives every declared page a unique surface name, which is the walk's denominator", () => {
    const surfaces = clerkDeclaredPageSurfaces();
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("declares at least one account page, so a walk with no instance root still holds something", () => {
    expect(CLERK_BROWSER_PAGES.filter((page) => page.root === "account").length).toBeGreaterThan(0);
  });

  it("gives every page a non-empty description, because a surface name alone does not say what it shows", () => {
    expect(CLERK_BROWSER_PAGES.filter((page) => page.description.length === 0)).toEqual([]);
  });

  it("declares no path with a leading slash, since the URL builder supplies the separator", () => {
    expect(CLERK_BROWSER_PAGES.filter((page) => page.path.startsWith("/"))).toEqual([]);
  });
});

describe("clerkPageUrl", () => {
  it("builds an account page with no root at all", () => {
    const page = CLERK_BROWSER_PAGES.find((declared) => declared.surface === "account-applications")!;
    expect(clerkPageUrl({ instanceRoot: null, page })).toBe("https://dashboard.clerk.com/apps");
  });

  it("hangs an instance page off the root the probe learned", () => {
    const page = CLERK_BROWSER_PAGES.find((declared) => declared.surface === "instance-domains")!;
    expect(clerkPageUrl({ instanceRoot: "/apps/app_x/instances/ins_y", page })).toBe(
      "https://dashboard.clerk.com/apps/app_x/instances/ins_y/domains",
    );
  });

  it("answers null for an instance page when no root was found, rather than guessing one", () => {
    const page = CLERK_BROWSER_PAGES.find((declared) => declared.surface === "instance-domains")!;
    expect(clerkPageUrl({ instanceRoot: null, page })).toBe(null);
  });
});

describe("isClerkSignInUrl", () => {
  it("reads a landing on Clerk's accounts host as a lost session", () => {
    expect(isClerkSignInUrl({ finalUrl: "https://accounts.clerk.accounts.dev/sign-in" })).toBe(true);
  });

  it("reads the dashboard's own sign-in path as a lost session too", () => {
    expect(isClerkSignInUrl({ finalUrl: "https://dashboard.clerk.com/sign-in?redirect=%2Fapps" })).toBe(true);
  });

  it("does not read an ordinary dashboard page as one", () => {
    expect(isClerkSignInUrl({ finalUrl: "https://dashboard.clerk.com/apps/app_x/instances/ins_y/domains" })).toBe(
      false,
    );
  });
});

describe("clerkInstanceRootFromFinalUrl", () => {
  it("reads the root off a landing that carries one", () => {
    expect(
      clerkInstanceRootFromFinalUrl({ finalUrl: "https://dashboard.clerk.com/apps/app_x/instances/ins_y?tab=1" }),
    ).toBe("/apps/app_x/instances/ins_y");
  });

  it("stops at the instance segment rather than swallowing the page beneath it", () => {
    expect(
      clerkInstanceRootFromFinalUrl({ finalUrl: "https://dashboard.clerk.com/apps/app_x/instances/ins_y/domains" }),
    ).toBe("/apps/app_x/instances/ins_y");
  });

  it("answers null when the dashboard sent the origin to the application list instead", () => {
    expect(clerkInstanceRootFromFinalUrl({ finalUrl: "https://dashboard.clerk.com/apps" })).toBe(null);
  });
});

describe("clerkInstanceRootFromTraffic", () => {
  it("recovers the root from the URLs the application list asked for", () => {
    expect(
      clerkInstanceRootFromTraffic({
        bodies: [],
        urls: [
          "https://dapi.clerk.com/v1/applications/app_0SYNFIXTUREAPP0000000000000",
          "https://dapi.clerk.com/v1/instances/ins_0SYNFIXTUREINS0000000000000/updates",
        ],
      }),
    ).toBe("/apps/app_0SYNFIXTUREAPP0000000000000/instances/ins_0SYNFIXTUREINS0000000000000");
  });

  it("recovers it from a response BODY when no URL carries one", () => {
    expect(
      clerkInstanceRootFromTraffic({
        bodies: [
          {
            data: [
              {
                id: "app_0SYNFIXTUREAPP0000000000000",
                instances: [{ environment_type: "development", id: "ins_0SYNFIXTUREINS0000000000000" }],
              },
            ],
          },
        ],
        urls: ["https://dapi.clerk.com/v1/applications"],
      }),
    ).toBe("/apps/app_0SYNFIXTUREAPP0000000000000/instances/ins_0SYNFIXTUREINS0000000000000");
  });

  it("answers null when only one of the two identifiers is anywhere to be found", () => {
    expect(
      clerkInstanceRootFromTraffic({
        bodies: [],
        urls: ["https://dapi.clerk.com/v1/applications/app_0SYNFIXTUREAPP0000000000000"],
      }),
    ).toBe(null);
  });

  it("answers null for traffic carrying neither", () => {
    expect(clerkInstanceRootFromTraffic({ bodies: [{ ok: true }], urls: ["https://dapi.clerk.com/v1/me"] })).toBe(null);
  });
});
