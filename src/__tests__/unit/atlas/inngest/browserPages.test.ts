import { describe, expect, it } from "vitest";

import {
  INNGEST_INADMISSIBLE_ROUTES,
  INNGEST_UNPHOTOGRAPHABLE_ROUTES,
  inngestPageUrl,
  inngestPhotographPolicy,
  inngestWalkablePages,
  isInngestSignInLanding,
} from "../../../../atlas/inngest/browserPages.js";
import { pageRechecks } from "../../../../atlas/inngest/browserSurface.js";
import { type InngestPageObservation, inngestPageOutcome } from "../../../../atlas/inngest/browserWalk.js";
import type { InngestAtlasEntity } from "../../../../atlas/inngest/model.js";
import type { PageCapture } from "../../../../browser/pageTransport.js";

/** One stored page entity carrying only the compiled channel a sync writes. */
function pageEntity({ routePath, section = "settings" }: { routePath: string; section?: string }): InngestAtlasEntity {
  return {
    channels: {
      api: null,
      browser: null,
      compiled: {
        channel: "compiled",
        detail: { routePath, section },
        firstSeenAt: "2026-09-07T00:00:00.000Z",
        lastSeenAt: "2026-09-07T00:00:00.000Z",
        source: null,
        state: "observed",
      },
    },
    id: routePath,
    kind: "page",
    providerId: routePath,
  };
}

describe("choosing which declared routes a walk may visit", () => {
  it("keeps a plain route and one that needs only the environment the client supplies", () => {
    const pages = inngestWalkablePages({
      entities: [
        pageEntity({ routePath: "/settings/api-keys" }),
        pageEntity({ routePath: "/env/$envSlug/apps", section: "env" }),
      ],
    });
    expect(pages.map((page) => page.surface)).toEqual(["/env/$envSlug/apps", "/settings/api-keys"]);
    expect(pages.find((page) => page.surface === "/env/$envSlug/apps")!.section).toBe("env");
  });

  // The transport performs no click, so read-only is a property of construction — and this filter is the
  // other half of it: a route whose mere visit signs you out or starts an OAuth handshake is not a read.
  it("refuses every route whose visit would itself be an act, each with a stated reason", () => {
    const pages = inngestWalkablePages({
      entities: [pageEntity({ routePath: "/sign-out" }), pageEntity({ routePath: "/intent/create-webhook" })],
    });
    expect(pages).toEqual([]);
    expect(INNGEST_INADMISSIBLE_ROUTES["/sign-out"]).toContain("ends the session");
    expect(Object.values(INNGEST_INADMISSIBLE_ROUTES).filter((reason) => reason.trim() === "").length).toBe(0);
  });

  it("refuses a route carrying an identifier no client landing supplies", () => {
    expect(
      inngestWalkablePages({
        entities: [
          pageEntity({ routePath: "/env/$envSlug/runs/$runID" }),
          pageEntity({ routePath: "/settings/user/$" }),
        ],
      }),
    ).toEqual([]);
  });
});

describe("deciding which pages may be photographed", () => {
  // Checked BEFORE the bytes exist rather than after, because clearing an artifact reference is not
  // withholding a file — the failure `kit/pageWalk.ts` carries the measurement for.
  it("refuses a picture of every page that renders a credential, each with its own reason", () => {
    expect(Object.keys(INNGEST_UNPHOTOGRAPHABLE_ROUTES).toSorted()).toEqual([
      "/env/$envSlug/manage/$ingestKeys",
      "/env/$envSlug/manage/signing-key",
      "/settings/api-keys",
    ]);
    expect(
      inngestPhotographPolicy({ page: { section: "settings", surface: "/settings/api-keys" } })!.refusedBecause,
    ).toBe("the page lists this account's API keys");
  });

  it("photographs every other declared page", () => {
    expect(inngestPhotographPolicy({ page: { section: "env", surface: "/env/$envSlug/apps" } })).toBe(null);
    expect(inngestPhotographPolicy({ page: { section: "settings", surface: "/settings" } })).toBe(null);
  });
});

describe("addressing one declared page", () => {
  it("substitutes the environment the running client itself landed on", () => {
    expect(
      inngestPageUrl({ environmentSlug: "staging", page: { section: "env", surface: "/env/$envSlug/apps" } }),
    ).toBe("https://app.inngest.com/env/staging/apps");
  });

  it("answers null when the page needs an environment the client named none of", () => {
    expect(inngestPageUrl({ environmentSlug: null, page: { section: "env", surface: "/env/$envSlug/apps" } })).toBe(
      null,
    );
  });

  it("leaves a page needing no environment alone", () => {
    expect(inngestPageUrl({ environmentSlug: null, page: { section: "settings", surface: "/settings" } })).toBe(
      "https://app.inngest.com/settings",
    );
  });
});

describe("grading where the browser settled", () => {
  const capture: PageCapture = {
    finalUrl: "",
    links: [],
    linksBlockedBecause: null,
    observedAt: "2026-09-07T02:00:00.000Z",
    requestedUrl: "",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    responses: [],
    screenshotBlockedBecause: null,
    screenshotPng: null,
    statusCode: 200,
    title: "x",
  };

  it("calls a page reached when the client kept the address it was asked for", () => {
    expect(
      inngestPageOutcome({
        capture: { ...capture, finalUrl: "https://app.inngest.com/settings?tab=a" },
        requestedUrl: "https://app.inngest.com/settings",
      }),
    ).toEqual({ redirected: false, unreachableBecause: null });
  });

  // A sign-in landing is checked before every other rule, because it means the session is gone and every
  // page after it would otherwise be recorded as its own independent failure.
  it("reports a sign-in landing as a lost session rather than as a redirect", () => {
    const outcome = inngestPageOutcome({
      capture: { ...capture, finalUrl: "https://app.inngest.com/sign-in?redirect_url=%2Fsettings" },
      requestedUrl: "https://app.inngest.com/settings",
    });
    expect(outcome.redirected).toBe(true);
    expect(outcome.unreachableBecause).toContain("no longer signed in");
    expect(isInngestSignInLanding({ finalUrl: "https://app.inngest.com/sign-in" })).toBe(true);
    expect(isInngestSignInLanding({ finalUrl: "https://app.inngest.com/settings" })).toBe(false);
  });

  // No settled path is ever quoted: it can carry the environment slug, an app's external id or a function
  // slug, and every one of those is this organisation's own name for something.
  it("names the origin and never the path when the client sent the address elsewhere", () => {
    const outcome = inngestPageOutcome({
      capture: { ...capture, finalUrl: "https://app.inngest.com/env/a-private-env/apps" },
      requestedUrl: "https://app.inngest.com/env/a-private-env/manage",
    });
    expect(outcome.redirected).toBe(true);
    expect(outcome.unreachableBecause).toBe(
      "the dashboard did not keep this address — it answered 200 and settled on a different path under https://app.inngest.com",
    );
  });
});

describe("pageRechecks", () => {
  const observation = ({ over }: { over: Partial<InngestPageObservation> }): InngestPageObservation => ({
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://app.inngest.com/billing",
    observedAt: "2026-09-07T07:39:20.488Z",
    redirected: false,
    requestedUrl: "https://app.inngest.com/billing",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "/billing",
    title: "Billing",
    unreachableBecause: null,
    ...over,
  });

  const screenshotRecheck = ({ page }: { page: InngestPageObservation }) =>
    pageRechecks({ pages: [page] }).find((recheck) => recheck.condition === "dashboard-screenshot-missing")!;

  it("resolves a page's screenshot gap once it has a picture again", () => {
    // Without this recheck the condition never closes, so the thirty-one gaps left by an earlier
    // capture defect survived a walk that photographed everything its policy permits.
    const page = observation({
      over: {
        artifacts: [
          {
            byteLength: 4,
            kind: "page-png" as const,
            mediaType: "image/png",
            relativePath: "artifacts/pages/a.png",
            sha256: "a",
          },
        ],
      },
    });
    expect(screenshotRecheck({ page }).resolved).toBe(true);
  });

  it("leaves a page's screenshot gap open when this atlas ruled it may not be photographed", () => {
    const page = observation({ over: { screenshotMissingBecause: "the page lists this account's API keys" } });
    expect(screenshotRecheck({ page }).resolved).toBe(false);
  });

  it("leaves a page's screenshot gap open when the capture failed", () => {
    const page = observation({
      over: { screenshotMissingBecause: "the page was reached but the browser returned no screenshot for it" },
    });
    expect(screenshotRecheck({ page }).resolved).toBe(false);
  });
});
