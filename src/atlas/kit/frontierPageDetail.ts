/**
 * What every atlas stores about one page its frontier walk visited, and whether that page was reached.
 *
 * Its own module because it is the one part of a frontier walk that is a pure reading of an observation: the
 * engine in `./frontierWalk.ts` decides what a visit came to, and this decides what a stored row says about
 * it. The page it reads is declared structurally rather than as the engine's observation type, so this module
 * depends on nothing the engine owns.
 */
import type { ResponseAccounting } from "../../browser/pageTransport.js";

/**
 * Whether a page with this outcome was REACHED — it rendered behind the session. `unphotographed` counts:
 * the platform graded it `landed` and only its picture was lost afterwards, so it proves the session as
 * surely as a photographed one. One predicate, so a page detail and a platform's signed-out verdict agree.
 *
 * @returns `true` for `landed` and `unphotographed`
 */
export function wasReached({ outcome }: { outcome: string }): boolean {
  return outcome === "landed" || outcome === "unphotographed";
}

/**
 * Where a visit settled. A route the walk never visited has no address to report, and says so in words
 * rather than as an empty string, so "never visited" reads as itself.
 */
function settledUrl({ finalUrl }: { finalUrl: string | null }): string {
  if (finalUrl === null) {
    return "not-visited";
  }
  return finalUrl;
}

/**
 * What every atlas stores about one page its walk visited, assembled from the observation.
 *
 * Kit-owned because it was copied: two walk publishers built this object byte-identically, differing only
 * in the English each returns for an outcome. The four decisions inside it are the ones a copy loses.
 * `finalUrl` names an unvisited route as `not-visited` rather than an empty string, so "never visited" reads
 * as itself. `redirected` counts the sign-in wall, because the wall IS a redirect and a row that hid that
 * would claim the page was reached. And `screenshotMissingBecause` is keyed on the ARTIFACT list rather
 * than on the outcome, because a page can grade `landed` and still hold no picture — the outcome is set by
 * the walk and the artifact list by the writer, and grading on the outcome alone lets a complete-looking
 * walk with no screenshots anywhere on disk publish `synced` coverage. And `unreachableBecause` stays
 * `null` for an `unphotographed` page, because that page was reached and only its picture was lost — a
 * reader of the row alone would otherwise count a rendered page among the ones the walk never got to.
 *
 * @param page the observation to describe
 * @param callCount how many first-party calls this page produced
 * @param captureComplete whether every eligible response body on this page was read
 * @param explain the English one outcome carries, or `null` when the page is fully held
 * @returns the stored page detail
 *
 * @internal
 */
export function frontierPageDetail({
  page,
  callCount,
  captureComplete,
  explain,
}: {
  page: {
    readonly artifacts: readonly unknown[];
    readonly finalUrl: string | null;
    readonly outcome: string;
    readonly responseAccounting: ResponseAccounting;
    readonly statusCode: number | null;
    readonly title: string | null;
  };
  callCount: number;
  captureComplete: boolean;
  explain: (input: { outcome: string }) => string | null;
}): {
  callCount: number;
  captureComplete: boolean;
  finalUrl: string;
  redirected: boolean;
  responseAccounting: ResponseAccounting;
  screenshotMissingBecause: string | null;
  statusCode: number | null;
  title: string | null;
  unreachableBecause: string | null;
} {
  const reached = wasReached({ outcome: page.outcome });
  return {
    callCount,
    captureComplete,
    finalUrl: settledUrl({ finalUrl: page.finalUrl }),
    redirected: page.outcome === "redirected" || page.outcome === "signed-out",
    responseAccounting: { ...page.responseAccounting },
    screenshotMissingBecause: page.artifacts.length > 0 ? null : explain({ outcome: page.outcome }),
    statusCode: page.statusCode,
    title: page.title,
    unreachableBecause: reached ? null : explain({ outcome: page.outcome }),
  };
}
