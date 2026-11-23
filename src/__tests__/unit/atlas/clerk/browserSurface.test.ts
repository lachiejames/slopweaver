/**
 * The walk PUBLISHER's own judgement: what it refuses, what it counts as undocumented, and the gaps it
 * writes.
 *
 * `undocumentedOperations` is the one worth the most: judged against the STORED compiled rows rather than
 * against the pinned documents, so a walk run before any sync reports nothing undocumented instead of
 * reporting everything it saw.
 */
import { describe, expect, it } from "vitest";

import { clerkDeclaredPageSurfaces } from "../../../../atlas/clerk/browserPages.js";
import type { ClerkObservedCall } from "../../../../atlas/clerk/browserReduction.js";
import { foldClerkOperations, undocumentedOperations } from "../../../../atlas/clerk/browserSurface.js";
import { type ClerkAtlasEntity, emptyClerkKindFile } from "../../../../atlas/clerk/model.js";
import type { PageObservation } from "../../../../atlas/kit/pageWalk.js";
import { refuseUndeclaredWalk } from "../../../../atlas/kit/walkPublish.js";
import { unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T11:00:00.000Z";

/** One reduced call, as `browserReduction.ts` hands it over. */
function call({ wirePath, api = "bapi" }: { wirePath: string; api?: ClerkObservedCall["api"] }): ClerkObservedCall {
  return { api, host: "api.clerk.com", method: "GET", responseFields: ["id"], statusCode: 200, wirePath };
}

/** One page observation carrying whatever calls a case needs. */
function page({
  surface,
  calls,
}: {
  surface: string;
  calls: readonly ClerkObservedCall[];
}): PageObservation<ClerkObservedCall> {
  return {
    artifacts: [],
    attempted: true,
    calls,
    captureComplete: true,
    finalUrl: "https://dashboard.clerk.com/apps",
    observedAt: AT,
    redirected: false,
    requestedUrl: "https://dashboard.clerk.com/apps",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 1 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface,
    title: "Dashboard",
    unreachableBecause: null,
  };
}

/** One stored operation row carrying only the compiled channel. */
function declared({ providerId }: { providerId: string }): ClerkAtlasEntity {
  return {
    channels: {
      api: null,
      browser: null,
      compiled: {
        channel: "compiled",
        detail: { responseFields: ["id"] },
        firstSeenAt: AT,
        lastSeenAt: AT,
        source: null,
        state: "observed",
      },
    },
    id: providerId,
    kind: "operation",
    providerId,
  };
}

describe("foldClerkOperations", () => {
  it("folds one operation seen on two pages into one row that names both", () => {
    const folded = foldClerkOperations({
      pages: [
        page({ calls: [call({ wirePath: "/v1/users" })], surface: "account-applications" }),
        page({ calls: [call({ wirePath: "/v1/users" })], surface: "account-team" }),
      ],
    });
    expect(folded.length).toBe(1);
    expect(folded[0]!.callCount).toBe(2);
    expect(folded[0]!.seenOn).toEqual(["account-applications", "account-team"]);
  });

  it("keeps two different operations apart", () => {
    const folded = foldClerkOperations({
      pages: [
        page({
          calls: [call({ wirePath: "/v1/users" }), call({ api: "dashboard", wirePath: "/v1/workspace_status" })],
          surface: "account-applications",
        }),
      ],
    });
    expect(folded.length).toBe(2);
  });
});

describe("undocumentedOperations", () => {
  it("names an observed operation no compiled row declares", () => {
    const stored = {
      ...emptyClerkKindFile({ kind: "operation", updatedAt: AT }),
      entities: [declared({ providerId: "GET bapi:/v1/users" })],
    };
    const observed = foldClerkOperations({
      pages: [
        page({
          calls: [call({ api: "dashboard", wirePath: "/v1/workspace_status" })],
          surface: "account-applications",
        }),
      ],
    });
    expect(undocumentedOperations({ observed, stored })).toEqual(["GET dashboard:/v1/workspace_status"]);
  });

  it("does NOT name one a compiled row declares", () => {
    const stored = {
      ...emptyClerkKindFile({ kind: "operation", updatedAt: AT }),
      entities: [declared({ providerId: "GET bapi:/v1/users" })],
    };
    const observed = foldClerkOperations({
      pages: [page({ calls: [call({ wirePath: "/v1/users" })], surface: "account-applications" })],
    });
    expect(undocumentedOperations({ observed, stored })).toEqual([]);
  });

  it("does not name a parameter-shape twin, which the comparison would otherwise manufacture", () => {
    const stored = {
      ...emptyClerkKindFile({ kind: "operation", updatedAt: AT }),
      entities: [declared({ providerId: "GET bapi:/v1/users/{user_id}" })],
    };
    const observed = foldClerkOperations({
      pages: [page({ calls: [call({ wirePath: "/v1/users/{user}" })], surface: "account-applications" })],
    });
    expect(undocumentedOperations({ observed, stored })).toEqual([]);
  });

  it("names NOTHING when no compiled row has been published, rather than everything it saw", () => {
    const observed = foldClerkOperations({
      pages: [page({ calls: [call({ wirePath: "/v1/users" })], surface: "account-applications" })],
    });
    expect(
      undocumentedOperations({ observed, stored: emptyClerkKindFile({ kind: "operation", updatedAt: AT }) }),
    ).toEqual([]);
  });
});

describe("refuseUndeclaredWalk over this atlas's declared list", () => {
  it("refuses a walk that covered fewer pages than are declared", () => {
    const refused = refuseUndeclaredWalk({
      declaredSurfaces: clerkDeclaredPageSurfaces(),
      pages: [page({ calls: [], surface: "account-applications" })],
    });
    expect(unwrapErr(refused)[0]).toBe(
      `this walk does not cover the declared page list: ${String(clerkDeclaredPageSurfaces().length - 1)} declared page(s) absent, 0 row(s) for a page that is not declared, 0 duplicated row(s)`,
    );
  });

  it("refuses an EMPTY walk, which a publisher grading against its own array would call complete", () => {
    const refused = refuseUndeclaredWalk({ declaredSurfaces: clerkDeclaredPageSurfaces(), pages: [] });
    expect(unwrapErr(refused)[1]).toBe(
      "nothing was published — a publisher that graded this against its own array would report full coverage over whatever it was handed",
    );
  });

  it("accepts a walk that covers the declared list exactly", () => {
    const accepted = refuseUndeclaredWalk({
      declaredSurfaces: clerkDeclaredPageSurfaces(),
      pages: clerkDeclaredPageSurfaces().map((surface) => page({ calls: [], surface })),
    });
    expect(accepted.isOk()).toBe(true);
  });
});
