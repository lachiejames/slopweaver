/**
 * What a walk publishes onto a generation a sync has already stamped.
 *
 * The load-bearing case is the `integration` kind, the one kind a walk REWRITES without reaching anything:
 * its browser cell becomes the stated limit, so the file changes, while `walkManifest` records no success
 * for it. `kit/manifestClock.ts` compares a written kind's file clock with the success published beside it,
 * so a walk that restamped this file refused itself outright — losing every page it had just landed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pageKindFile } from "../../../../atlas/jam/browserPageKind.js";
import { JAM_BROWSER_PAGES } from "../../../../atlas/jam/browserPages.js";
import { publishJamWebWalk } from "../../../../atlas/jam/browserSurface.js";
import type { JamBrowserWalkResult, JamPageObservation } from "../../../../atlas/jam/browserWalk.js";
import { succeededJamCoverageCell } from "../../../../atlas/jam/coverage.js";
import { JamAtlasErrors, jamAtlasErrorLines } from "../../../../atlas/jam/errors.js";
import {
  emptyJamKindFile,
  initialJamManifest,
  JAM_INTEGRATION_KIND,
  JAM_PAGE_KIND,
  type JamAtlasKindFile,
  type JamAtlasManifest,
} from "../../../../atlas/jam/model.js";
import {
  type JamAtlasPaths,
  jamAtlasPaths,
  publishJamAtlas,
  readJamKindFile,
  readJamManifest,
} from "../../../../atlas/jam/store.js";
import { JAM_SPEC_SURFACE, JAM_WEB_APP_SURFACE } from "../../../../atlas/jam/surfaces.js";
import { syncJamAtlas } from "../../../../atlas/jam/sync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** The instant the compiled sync last stamped the stored generation. */
const SYNCED_AT = "2026-09-17T08:40:51.889Z";

/** This walk's instant, deliberately later than {@link SYNCED_AT} so a restamp would be visible. */
const WALKED_AT = "2026-09-17T08:43:41.090Z";

/** A later compiled sync, for the resync ordering that runs a walk and then folds the table onto it. */
const RESYNCED_AT = "2026-09-17T09:10:00.000Z";

/** The two controls this platform's grading rests on, which are declared pages like any other. */
const CONTROL_SURFACES = ["not-found-control", "not-found-invented"];

/** Declared application surfaces a fixture walk lands, excluding the controls. */
const LANDED_SURFACES = JAM_BROWSER_PAGES.map((page) => page.surface).filter(
  (surface) => !CONTROL_SURFACES.includes(surface),
);

let home: string;
let paths: JamAtlasPaths;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-jam-atlas-"));
  paths = jamAtlasPaths({ home });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One landed page observation, varied only in the surface that becomes its provider key. */
function observation({ surface }: { surface: string }): JamPageObservation {
  return {
    artifacts: [],
    attempted: true,
    calls: [{ method: "GET", origin: "https://api.jam.dev", pathShape: "/v1/team/{id}/members" }],
    captureComplete: true,
    finalUrl: `https://jam.dev/s/team-0000${surface === "overview" ? "" : `/${surface}`}`,
    observedAt: WALKED_AT,
    redirected: false,
    requestedUrl: `https://jam.dev/s/team-0000${surface === "overview" ? "" : `/${surface}`}`,
    responseAccounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 40 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface,
    title: "Jam",
    unreachableBecause: null,
  };
}

/** One control's observation: graded not-found, which is what makes the other gradings mean anything. */
function controlObservation({ surface }: { surface: string }): JamPageObservation {
  return {
    ...observation({ surface }),
    statusCode: 404,
    unreachableBecause: "the route answered Jam's own not-found page, which is what this control asserts",
  };
}

/** A walk whose control fired, covering the declared page list exactly. */
function completeWalk(): JamBrowserWalkResult {
  return {
    controlFailure: null,
    pages: [
      ...CONTROL_SURFACES.map((surface) => controlObservation({ surface })),
      ...LANDED_SURFACES.map((surface) => observation({ surface })),
    ],
    rootFound: true,
    sessionLost: false,
  };
}

/** The `integration` file a compiled sync leaves behind: one API cell, its own clock, no browser cell. */
function syncedIntegrationFile(): JamAtlasKindFile {
  return {
    ...emptyJamKindFile({ kind: JAM_INTEGRATION_KIND, updatedAt: SYNCED_AT }),
    coverage: [
      succeededJamCoverageCell({
        artifacts: [],
        at: SYNCED_AT,
        channel: "compiled",
        reason: "the compiled table names every integration Jam documents",
        role: "discovery",
        scope: "jam",
        state: "synced",
        surface: JAM_SPEC_SURFACE,
      }),
    ],
  };
}

/** The manifest beside it: `integration` succeeded at the sync's instant and nowhere near this walk's. */
function syncedManifest(): JamAtlasManifest {
  const base = initialJamManifest({ updatedAt: SYNCED_AT });
  return {
    ...base,
    kinds: {
      ...base.kinds,
      integration: {
        digest: null,
        entityCount: 0,
        lastAttempt: { at: SYNCED_AT, outcome: "ok", reasons: [] },
        lastSuccessAt: SYNCED_AT,
      },
    },
  };
}

/** Seed the store with the generation a compiled sync published, which this walk then folds onto. */
function seedSyncedGeneration(): void {
  unwrap(
    publishJamAtlas({
      derivedFrom: null,
      files: { [JAM_INTEGRATION_KIND]: syncedIntegrationFile() },
      manifest: syncedManifest(),
      paths,
    }),
  );
}

describe("publishJamWebWalk", () => {
  it("publishes a walk onto a generation the sync stamped earlier, leaving integration on its own clock", () => {
    seedSyncedGeneration();

    const outcome = unwrap(publishJamWebWalk({ at: WALKED_AT, paths, walk: completeWalk() }));

    expect(outcome.reachedCount).toBe(LANDED_SURFACES.length);
    const integration = unwrap(readJamKindFile({ kind: JAM_INTEGRATION_KIND, paths }))!;
    const manifest = unwrap(readJamManifest({ paths }))!;
    // The file was genuinely rewritten — its browser cell is the stated limit that was not there before —
    // and it still carries the sync's clock, which is what keeps it out of the two-clock comparison.
    expect(integration.coverage.filter((cell) => cell.channel === "browser").length).toBe(1);
    expect(integration.updatedAt).toBe(SYNCED_AT);
    expect(manifest.kinds.integration.lastSuccessAt).toBe(SYNCED_AT);
    expect(manifest.kinds.page.lastSuccessAt).toBe(WALKED_AT);
    expect(manifest.updatedAt).toBe(WALKED_AT);
  });

  it("writes the browser channel's deferred cell onto integration rather than a completeness claim", () => {
    seedSyncedGeneration();

    unwrap(publishJamWebWalk({ at: WALKED_AT, paths, walk: completeWalk() }));

    const integration = unwrap(readJamKindFile({ kind: JAM_INTEGRATION_KIND, paths }))!;
    const browser = integration.coverage.find((cell) => cell.channel === "browser")!;
    expect(browser.state).toBe("deferred");
    expect(browser.surface).toBe(JAM_WEB_APP_SURFACE);
    expect(integration.coverage.filter((cell) => cell.channel === "compiled").length).toBe(1);
  });

  it("lets the compiled sync publish over a walk, which is the resync path that was refused outright", () => {
    // The other direction, and the one `slopweaver automation resync --atlas jam` actually takes. Both halves
    // go through the real store, so `publishAtlas`'s clock and evidence-loss guards judge them: this is the
    // only case in the suite that proves a walk and a sync can follow each other at all.
    seedSyncedGeneration();
    unwrap(publishJamWebWalk({ at: WALKED_AT, paths, walk: completeWalk() }));

    const report = unwrap(syncJamAtlas({ at: RESYNCED_AT, home }));

    // Every DECLARED page, controls included: the walk writes a row per declared surface, graded.
    expect(report.entitiesByKind.find((row) => row.kind === "page")!.entities).toBe(JAM_BROWSER_PAGES.length);
    const page = unwrap(readJamKindFile({ kind: "page", paths }))!;
    const manifest = unwrap(readJamManifest({ paths }))!;
    // The walk's pages, its browser cell and its own clock all survive the sync that follows it.
    expect(page.entities.length).toBe(JAM_BROWSER_PAGES.length);
    expect(page.coverage.filter((cell) => cell.channel === "browser" && cell.state === "synced").length).toBe(1);
    expect(page.updatedAt).toBe(WALKED_AT);
    expect(manifest.kinds.page.lastSuccessAt).toBe(WALKED_AT);
    expect(manifest.kinds.integration.lastSuccessAt).toBe(RESYNCED_AT);
    expect(manifest.updatedAt).toBe(RESYNCED_AT);
  });

  // The refusal's copy, per cause, is `errors.test.ts`'s; this is the wiring — the walk's typed failure is
  // what the refusal is built from, and nothing reaches the store.
  it("refuses the whole publication with the walk's own typed cause when its controls were unusable", () => {
    seedSyncedGeneration();
    const controlFailure = { because: "the visit failed", cause: "control-unreachable" } as const;

    const refused = unwrapErr(publishJamWebWalk({ at: WALKED_AT, paths, walk: { ...completeWalk(), controlFailure } }));

    expect(refused).toEqual(jamAtlasErrorLines({ error: JamAtlasErrors.uncorroborated(controlFailure) }));
    expect(refused).toHaveLength(3);
    expect(refused.at(-1)).toBe("nothing was published — remedy: run the walk again; cause: the visit failed");
    expect(unwrap(readJamKindFile({ kind: "page", paths }))).toBe(null);
  });

  // The other side of the remedy split: only a band disagreement is evidence about Jam's not-found page.
  it("refuses with the re-measure remedy when the two photographed controls disagreed", () => {
    seedSyncedGeneration();
    const controlFailure = { because: "the two controls do not corroborate each other", cause: "band" } as const;

    const refused = unwrapErr(publishJamWebWalk({ at: WALKED_AT, paths, walk: { ...completeWalk(), controlFailure } }));

    expect(refused.at(-1)).toBe(
      "nothing was published — remedy: re-measure the band in `notFoundControl.ts`; cause: the two controls do not corroborate each other",
    );
    expect(unwrap(readJamKindFile({ kind: "page", paths }))).toBe(null);
  });
});

describe("pageKindFile", () => {
  it("opens only the permanent denominator gap for a complete walk, the two controls raising none", () => {
    const file = unwrap(
      pageKindFile({
        at: WALKED_AT,
        pages: completeWalk().pages,
        stored: emptyJamKindFile({ kind: JAM_PAGE_KIND, updatedAt: SYNCED_AT }),
      }),
    );

    expect(file.entities.length).toBe(JAM_BROWSER_PAGES.length);
    expect(file.gaps.map((gap) => [gap.condition, gap.scope])).toEqual([
      ["web-denominator-is-harvested", JAM_WEB_APP_SURFACE],
    ]);
    expect(file.coverage.filter((cell) => cell.channel === "browser" && cell.state === "synced").length).toBe(1);
  });

  it("opens an unreachable gap scoped to the one landed page that did not render", () => {
    const missed = LANDED_SURFACES[0]!;
    const pages = completeWalk().pages.map((page) =>
      page.surface === missed ? { ...page, statusCode: 500, unreachableBecause: "the route answered 500" } : page,
    );

    const file = unwrap(
      pageKindFile({ at: WALKED_AT, pages, stored: emptyJamKindFile({ kind: JAM_PAGE_KIND, updatedAt: SYNCED_AT }) }),
    );

    expect(file.gaps.filter((gap) => gap.condition === "web-page-unreachable").map((gap) => gap.scope)).toEqual([
      missed,
    ]);
  });
});
