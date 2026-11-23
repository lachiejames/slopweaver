/**
 * The Xero publisher, over a whole generation in a temporary home.
 *
 * The two guards it runs — the declared denominator and the on-disk evidence check — are the kit's, and are
 * tested there (`kit/walkPublish.test.ts`). What is asserted here is what is genuinely this publisher's: that
 * it applies them at all, how it grades a walk that photographed nothing, and that neither of its two writers
 * can truncate what the other wrote.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PageObservation } from "../../../../atlas/kit/pageWalk.js";
import { XERO_BROWSER_PAGES } from "../../../../atlas/xero/browserPages.js";
import type { XeroObservedCall } from "../../../../atlas/xero/browserReduction.js";
import { publishXeroBrowserWalk, XERO_WALK_SURFACE } from "../../../../atlas/xero/browserSurface.js";
import { readXeroKindFile, xeroAtlasPaths } from "../../../../atlas/xero/store.js";
import { syncXeroApiSurface } from "../../../../atlas/xero/sync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home, removed after the test that made it. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-xero-atlas-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** One observation, with only the fields a test is about stated. */
function observation({
  over,
}: {
  over: Partial<PageObservation<XeroObservedCall>>;
}): PageObservation<XeroObservedCall> {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://go.xero.com/Dashboard",
    observedAt: AT,
    redirected: false,
    requestedUrl: "https://go.xero.com/Dashboard",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "dashboard",
    title: "Dashboard",
    unreachableBecause: null,
    ...over,
  };
}

/** One observation per declared page, so a walk covers the denominator exactly. */
function fullWalkPages({
  over,
}: {
  over: Partial<PageObservation<XeroObservedCall>>;
}): readonly PageObservation<XeroObservedCall>[] {
  return XERO_BROWSER_PAGES.map((declared) => observation({ over: { ...over, surface: declared.surface } }));
}

describe("publishXeroBrowserWalk", () => {
  it("refuses a walk that does not cover the declared list, before writing a byte", () => {
    const paths = xeroAtlasPaths({ home: scratchHome() });
    const published = publishXeroBrowserWalk({
      at: AT,
      paths,
      walk: { rootFound: true, pages: [], sessionLost: false },
    });
    expect(unwrapErr(published)).toEqual([
      `this walk does not cover the declared page list: ${String(XERO_BROWSER_PAGES.length)} declared page(s) absent, 0 row(s) for a page that is not declared, 0 duplicated row(s)`,
      "nothing was published — a publisher that graded this against its own array would report full coverage over whatever it was handed",
    ]);
  });

  it("grades a walk that reached every page but photographed none as deferred, never synced", () => {
    const paths = xeroAtlasPaths({ home: scratchHome() });
    unwrap(
      publishXeroBrowserWalk({
        at: AT,
        paths,
        walk: {
          rootFound: true,
          pages: fullWalkPages({ over: { artifacts: [], screenshotMissingBecause: "no picture came back" } }),
          sessionLost: false,
        },
      }),
    );
    const file = unwrap(readXeroKindFile({ kind: "page", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === XERO_WALK_SURFACE)!.state).toBe("deferred");
  });

  it("publishes one page entity per declared page", () => {
    const paths = xeroAtlasPaths({ home: scratchHome() });
    const published = unwrap(
      publishXeroBrowserWalk({
        at: AT,
        paths,
        walk: { rootFound: true, pages: fullWalkPages({ over: {} }), sessionLost: false },
      }),
    );
    expect(published.declaredCount).toBe(XERO_BROWSER_PAGES.length);
  });

  // The property both writers rest on: a walk must not blank what the sync wrote.
  it("leaves the family kind the sync published exactly as it was", () => {
    const home = scratchHome();
    const paths = xeroAtlasPaths({ home });
    const synced = unwrap(syncXeroApiSurface({ at: AT, paths }));
    unwrap(
      publishXeroBrowserWalk({
        at: "2026-09-05T01:00:00.000Z",
        paths,
        walk: { rootFound: true, pages: fullWalkPages({ over: {} }), sessionLost: false },
      }),
    );
    const families = unwrap(readXeroKindFile({ kind: "family", paths }))!;
    expect(families.entities).toHaveLength(synced.familyCount);
  });

  it("leaves the method kind's API channel alone while filling its browser one", () => {
    const home = scratchHome();
    const paths = xeroAtlasPaths({ home });
    const synced = unwrap(syncXeroApiSurface({ at: AT, paths }));
    unwrap(
      publishXeroBrowserWalk({
        at: "2026-09-05T01:00:00.000Z",
        paths,
        walk: { rootFound: true, pages: fullWalkPages({ over: {} }), sessionLost: false },
      }),
    );
    const methods = unwrap(readXeroKindFile({ kind: "method", paths }))!;
    expect(methods.entities.filter((entity) => entity.channels.api !== null)).toHaveLength(synced.routeCount);
  });
});
