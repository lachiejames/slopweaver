/**
 * The sync's own judgement, over a throwaway home: what a generation SAYS about what it does not hold.
 *
 * The `live-api` cell and the per-family ingest gaps are the whole point of this file. An atlas that held no
 * Xero record and said nothing about it would be indistinguishable from one that had decided not to hold
 * them, and the ruling is the opposite — this atlas SHOULD hold them, and a credential is what is missing.
 *
 * ## Every read-only assertion shares ONE generation, built once
 *
 * A sync parses 11 generated API classes and every model module beside them — MEASURED at about 1.7 seconds
 * on `xero-node` 19.1.0 — so a sync per test cost this file 25 seconds of the unit lane to publish the same
 * bytes fourteen times. The two tests that are ABOUT re-syncing keep their own home, because sharing one
 * would make them depend on each other's order.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { openXeroGaps } from "../../../../atlas/xero/gaps.js";
import type { XeroAtlasKind, XeroAtlasKindFile } from "../../../../atlas/xero/model.js";
import { readXeroKindFile, xeroAtlasPaths } from "../../../../atlas/xero/store.js";
import {
  syncXeroApiSurface,
  XERO_LIVE_SURFACE,
  XERO_SDK_SURFACE,
  type XeroSyncOutcome,
} from "../../../../atlas/xero/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home, removed after the test that made it. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-xero-sync-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const sharedHome = mkdtempSync(join(tmpdir(), "slopweaver-xero-sync-shared-"));
const sharedOutcome: XeroSyncOutcome = unwrap(
  syncXeroApiSurface({ at: AT, paths: xeroAtlasPaths({ home: sharedHome }) }),
);

afterAll(() => {
  rmSync(sharedHome, { force: true, recursive: true });
});

/** One kind's file from the shared generation. */
function sharedFile({ kind }: { kind: XeroAtlasKind }): XeroAtlasKindFile {
  return unwrap(readXeroKindFile({ kind, paths: xeroAtlasPaths({ home: sharedHome }) }))!;
}

describe("syncXeroApiSurface", () => {
  it("publishes every operation the installed client declares", () => {
    expect(sharedOutcome.operationCount).toBeGreaterThan(0);
  });

  // Reported separately because it is smaller, and a reader who did not know why would read the difference
  // as a parser dropping rows.
  it("reports fewer routes than operations, because three payroll clients share one base path", () => {
    expect(sharedOutcome.routeCount).toBeLessThan(sharedOutcome.operationCount);
  });

  it("judges every family, so an install never sees the unjudged fallback", () => {
    expect(sharedOutcome.unjudgedFamilyCount).toBe(0);
  });

  it("declares at least one voluminous family, which is the owner's own bound made a stored record", () => {
    expect(sharedOutcome.voluminousFamilyCount).toBeGreaterThan(0);
  });

  it("marks the compiled API surface synced, because the package was read in full", () => {
    const cell = sharedFile({ kind: "method" }).coverage.find((one) => one.surface === XERO_SDK_SURFACE)!;
    expect(cell.state).toBe("synced");
  });

  it("reads the compiled surface under the package's own ceiling, never a tenant's", () => {
    const cell = sharedFile({ kind: "method" }).coverage.find((one) => one.surface === XERO_SDK_SURFACE)!;
    expect(cell.visibilityScope).toBe("sdk-declarations");
  });

  // `not-configured` rather than `excluded`: nothing decided not to hold the entities.
  it("says the live API is not configured rather than excluded", () => {
    const cell = sharedFile({ kind: "family" }).coverage.find((one) => one.surface === XERO_LIVE_SURFACE)!;
    expect(cell.state).toBe("not-configured");
  });

  it("names the exact credential that would fill the live API surface", () => {
    const cell = sharedFile({ kind: "family" }).coverage.find((one) => one.surface === XERO_LIVE_SURFACE)!;
    expect(cell.unblockedBy).toContain("OAuth 2.0");
  });

  it("reads the unfilled live API under the OAuth ceiling rather than the package's", () => {
    const cell = sharedFile({ kind: "family" }).coverage.find((one) => one.surface === XERO_LIVE_SURFACE)!;
    expect(cell.visibilityScope).toBe("oauth-connection-scopes");
  });

  it("raises an ingest gap for a family it could hold and does not", () => {
    const open = openXeroGaps({ gaps: sharedFile({ kind: "family" }).gaps });
    expect(open.some((gap) => gap.scope === "api.xro/2.0:Contacts")).toBe(true);
  });

  // A voluminous family holding no rows is the disposition working. Filing it as a gap would put permanent,
  // uncloseable rows in a list whose whole value is that it shrinks.
  it("raises NO ingest gap for a voluminous family, because that is the disposition rather than a gap", () => {
    const open = openXeroGaps({ gaps: sharedFile({ kind: "family" }).gaps });
    expect(open.some((gap) => gap.scope === "api.xro/2.0:Journals")).toBe(false);
  });

  it("raises no unjudged-family gap on a build whose table is complete", () => {
    const open = openXeroGaps({ gaps: sharedFile({ kind: "family" }).gaps });
    expect(open.filter((gap) => gap.condition === "family-unjudged")).toEqual([]);
  });

  it("is idempotent: syncing twice publishes the same number of families", () => {
    const paths = xeroAtlasPaths({ home: scratchHome() });
    const first = unwrap(syncXeroApiSurface({ at: AT, paths }));
    const second = unwrap(syncXeroApiSurface({ at: "2026-09-05T01:00:00.000Z", paths }));
    expect(second.familyCount).toBe(first.familyCount);
  });

  it("does not accumulate a second copy of a family on a re-sync", () => {
    const paths = xeroAtlasPaths({ home: scratchHome() });
    const first = unwrap(syncXeroApiSurface({ at: AT, paths }));
    unwrap(syncXeroApiSurface({ at: "2026-09-05T01:00:00.000Z", paths }));
    const families = unwrap(readXeroKindFile({ kind: "family", paths }))!;
    expect(families.entities).toHaveLength(first.familyCount);
  });
});
