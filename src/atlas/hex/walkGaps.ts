/**
 * What one app walk says about the pages it did NOT hold: the words a page row carries for why, and the gaps
 * the walk raises against the `page` kind.
 *
 * Separate from `walkPublish.ts` because this half is pure vocabulary — a grade in, a sentence or a gap out —
 * while that file folds observations into rows and publishes them.
 */
import { openHexGap } from "./gaps.js";
import type { HexAtlasGap } from "./model.js";
import { HEX_BROWSER_UNBLOCKED_BY } from "./sync.js";
import type { HexWalkResult } from "./walk.js";

/**
 * Why a page is not held, in the words its row carries.
 *
 * @param outcome the grade the walk gave it
 * @returns the explanation, or `null` when the page landed and was photographed
 */
export function outcomeExplanation({ outcome }: { outcome: string }): string | null {
  if (outcome === "landed") {
    return null;
  }
  if (outcome === "signed-out") {
    return "the app sent this route to its own sign-in wall at /login — nobody is signed in to app.hex.tech in this browser";
  }
  if (outcome === "redirected") {
    return "the app settled somewhere other than the route that was asked for";
  }
  if (outcome === "unavailable") {
    return "the app answered an error status for this route";
  }
  if (outcome === "unphotographed") {
    return "the page rendered and no screenshot was written, so the atlas holds no picture to back the row";
  }
  if (outcome === "not-attempted") {
    return "the walk stopped before this route was reached — a lost session, or the sign-in wall";
  }
  return "the visit failed before the page rendered";
}

/**
 * The gaps one walk earns: the sign-in wall once when it is universal, otherwise one per page not held.
 *
 * A signed-out walk raises ONE gap rather than forty, because forty rows saying "redirected" is a reader
 * having to work out for themselves that they are one sign-in. When only some pages fail, each is its own
 * gap, because then the reasons genuinely differ.
 *
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @returns the gaps to store against the page kind
 */
export function walkGaps({ walk, at }: { walk: HexWalkResult; at: string }): readonly HexAtlasGap[] {
  if (walk.signedOut) {
    return [
      openHexGap({
        at,
        condition: "signed-out",
        fields: [],
        kind: "page",
        reason:
          "the app settled on its own sign-in wall at /login, so this surface holds nothing at all — " +
          `${String(walk.notAttempted.length)} further declared route(s) were not attempted, because a wall ` +
          `is a property of the session rather than of a route. ${HEX_BROWSER_UNBLOCKED_BY}`,
        scope: "declared-app-pages",
        surfaces: ["browser"],
      }),
    ];
  }
  const ended =
    walk.sessionEndedAt === null
      ? []
      : [
          openHexGap({
            at,
            condition: "session-ended-by-page",
            fields: [],
            kind: "page",
            reason:
              `${walk.sessionEndedAt} reported the browser session driving this walk gone, and a fresh attach ` +
              `did not bring it back — so ${String(walk.notAttempted.length)} further declared route(s) went ` +
              "unattempted. A page that merely closes its own tab costs only itself, so this is the relay or " +
              "the browser rather than the page. Run `slopweaver atlas hex walk` again to pick the remaining " +
              "routes up; the generation accumulates",
            scope: walk.sessionEndedAt,
            surfaces: ["browser"],
          }),
        ];
  return [
    ...ended,
    ...walk.pages
      .filter((page) => page.outcome !== "landed")
      .map((page) =>
        openHexGap({
          at,
          condition: page.outcome === "unphotographed" ? "page-unphotographed" : "page-unreachable",
          fields: [],
          kind: "page",
          // Only `landed` explains as `null`, and every landed page was filtered out above.
          reason: `${page.route}: ${outcomeExplanation({ outcome: page.outcome })!}`,
          scope: page.route,
          surfaces: ["browser"],
        }),
      ),
  ];
}
