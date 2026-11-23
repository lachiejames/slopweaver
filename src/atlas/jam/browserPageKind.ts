/**
 * The `page` kind's half of publishing a browser walk: the gaps a walk opens and closes, its coverage cell,
 * and the kind file those assemble into. Pure over its arguments — the lock, the read and the write stay in
 * `browserSurface.ts`, which calls {@link pageKindFile} inside them.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { isPageHeld } from "../kit/pageWalk.js";
import { assembleWalkKind, walkTally } from "../kit/walkPublish.js";

import { JAM_INVENTED_CONTROL_SURFACE, JAM_NOT_FOUND_CONTROL_SURFACE, type JamPageObservation } from "./browserWalk.js";
import { succeededJamCoverageCell } from "./coverage.js";
import { type JamGapRecheck, openJamGap, reconcileJamGaps } from "./gaps.js";
import { mergeJamChannel } from "./merge.js";
import { JAM_PAGE_KIND, type JamAtlasGap, type JamAtlasKindFile, type JamCoverageCell } from "./model.js";
import { projectJamPage } from "./projection.js";
import { JAM_WEB_APP_SURFACE } from "./surfaces.js";

/** What this walk genuinely rechecked, so a page that opened this time closes its last failure's gap. */
function walkRechecks({ pages }: { pages: readonly JamPageObservation[] }): readonly JamGapRecheck[] {
  return pages.flatMap((page) => [
    { condition: "web-page-unreachable", resolved: page.unreachableBecause === null, scope: page.surface },
    { condition: "web-screenshot-missing", resolved: isPageHeld({ page }), scope: page.surface },
  ]);
}

/** The gaps one walk opens. */
function walkGaps({ pages, at }: { pages: readonly JamPageObservation[]; at: string }): readonly JamAtlasGap[] {
  const gaps: JamAtlasGap[] = [
    openJamGap({
      at,
      condition: "web-denominator-is-harvested",
      fields: [],
      kind: JAM_PAGE_KIND,
      reason:
        "Jam's sitemap carries 33 marketing addresses and no application route, every application path " +
        "answers the same marketing shell to an unauthenticated prober, and the application renders almost " +
        "no anchors — so this walk's denominator is the router table its own bundle declares and nothing " +
        "can widen it by crawling. Permanently open by construction",
      scope: JAM_WEB_APP_SURFACE,
      surfaces: ["browser"],
    }),
  ];
  for (const page of pages) {
    // Both controls are SUPPOSED to be unreachable: that verdict is this walk's evidence that its oracle
    // fires, and raising either as a gap would put two permanent false rows on every honest run.
    if (page.surface === JAM_NOT_FOUND_CONTROL_SURFACE || page.surface === JAM_INVENTED_CONTROL_SURFACE) {
      continue;
    }
    if (page.unreachableBecause !== null) {
      gaps.push(
        openJamGap({
          at,
          condition: page.attempted ? "web-page-unreachable" : "web-page-not-attempted",
          fields: [],
          kind: JAM_PAGE_KIND,
          reason: page.unreachableBecause,
          scope: page.surface,
          surfaces: ["browser"],
        }),
      );
      continue;
    }
    if (page.screenshotMissingBecause !== null) {
      gaps.push(
        openJamGap({
          at,
          condition: "web-screenshot-missing",
          fields: [],
          kind: JAM_PAGE_KIND,
          reason: page.screenshotMissingBecause,
          scope: page.surface,
          surfaces: ["browser"],
        }),
      );
    }
  }
  return gaps;
}

/** The `page` kind's browser coverage cell, whose reason names the denominator's limit rather than a total. */
function pageCoverageCell({ pages, at }: { pages: readonly JamPageObservation[]; at: string }): JamCoverageCell {
  const tally = walkTally({ pages });
  return succeededJamCoverageCell({
    artifacts: pages.flatMap((page) => page.artifacts),
    at,
    channel: "browser",
    reason:
      `${String(tally.reached)} of ${String(pages.length)} declared page(s) reached and ` +
      `${String(tally.photographed)} photographed. The denominator is the application's own bundle-declared ` +
      "router table, not a list Jam publishes — see the permanently open `web-denominator-is-harvested` gap",
    role: "authoritative",
    scope: "web-application",
    state: "synced",
    surface: JAM_WEB_APP_SURFACE,
  });
}

/**
 * The `page` kind's next file: its browser channel merged on, its coverage cell, and this walk's gaps.
 *
 * @returns the page kind file to publish, or every reason the merge or gap reconciliation refused
 */
export function pageKindFile({
  stored,
  pages,
  at,
}: {
  stored: JamAtlasKindFile;
  pages: readonly JamPageObservation[];
  at: string;
}): Result<JamAtlasKindFile> {
  const fields = assembleWalkKind({
    at,
    cell: pageCoverageCell({ at, pages }),
    merge: () =>
      mergeJamChannel({
        at,
        channel: "browser",
        observed: pages.map((page) => projectJamPage({ at, page })),
        stored: stored.entities,
      }),
    reconcile: () =>
      reconcileJamGaps({
        at,
        observed: walkGaps({ at, pages }),
        rechecks: walkRechecks({ pages }),
        runFailed: false,
        stored: stored.gaps,
      }),
    stored,
    surface: JAM_WEB_APP_SURFACE,
  });
  return fields.isErr() ? err(fields.error) : ok({ ...stored, ...fields.value });
}
