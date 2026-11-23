/**
 * What one GitHub admin walk PROVED: a tally of how its pages resolved, whether it closed its own frontier,
 * and the gaps its shortfalls raise, in the atlas's own vocabulary. `webSurface.ts` publishes from these.
 *
 * One gap is raised however well the walk went. `browser-denominator-unproven` stays open in every
 * generation, because no run can close it: GitHub publishes no authenticated settings sitemap, so even a
 * closed frontier proves only that every link GitHub RENDERED was followed — never that every admin page was
 * found.
 */
import { countBy } from "#lib/collections.js";
import { githubKindScope } from "./coverage.js";
import type { GithubGap } from "./kindFiles.js";
import { openGithubGap } from "./reconcile.js";
import type { GithubWebWalkResult } from "./webWalk.js";

/**
 * A one-line tally of how the walk's pages resolved, for a coverage reason to quote.
 *
 * @param walk what the walk produced
 * @returns the tally
 *
 * @internal
 */
export function summariseOutcomes({ walk }: { walk: GithubWebWalkResult }): string {
  return [...countBy({ keys: walk.pages.map((page) => page.outcome) }).entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([outcome, count]) => `${String(count)} ${outcome}`)
    .join(", ");
}

/**
 * Whether the walk closed its own frontier.
 *
 * The strongest claim a frontier walk can make: a whole round of expansion discovered nothing new, the
 * round cap was not what stopped it, and no page FAILED to navigate.
 *
 * The last two conditions are the ones a review caught missing, and neither is pedantry. A page that failed
 * to navigate rendered no links, so the frontier looks closed precisely because the walk saw nothing: with
 * one seed and one navigation failure, an earlier version reported a closed frontier over zero pages and
 * staled every admin page the atlas already held. And a page that LOST a response body saw less than it
 * looks like it did, so the endpoints it did not record must not be concluded gone either. A page whose
 * LINK READ threw is the same failure in the place it hurts most — the frontier is built from links, so a
 * page that rendered links and could not report them looks identical to one with none.
 *
 * Deliberately still NOT the same as "every page landed". A 403 or a redirect is a COMPLETED attempt whose
 * answer happens to be no, and it renders the navigation a walk needs; a closed frontier over pages that
 * mostly 403'd is genuinely closed, and the page outcomes say the rest.
 *
 * @param walk what the walk produced
 * @returns whether expansion reached a fixed point
 *
 * @internal
 */
export function frontierClosed({ walk }: { walk: GithubWebWalkResult }): boolean {
  return (
    walk.frontierRemaining.length === 0 &&
    walk.notAttempted.length === 0 &&
    walk.incompletePages.length === 0 &&
    walk.linkReadFailures.length === 0 &&
    !walk.pages.some((page) => page.outcome === "failed")
  );
}

/** One walk gap, with everything the six call sites below share already filled in. */
function walkGap({
  at,
  condition,
  kind,
  scopeRef,
  reason,
}: {
  at: string;
  condition: GithubGap["condition"];
  kind: "admin-page" | "web-request";
  scopeRef: string;
  reason: string;
}): GithubGap {
  return openGithubGap({
    at,
    condition,
    fields: [],
    kind,
    reason,
    scope: githubKindScope({ kind, scopeRef }),
    surfaces: ["github-web"],
  });
}

/**
 * The gap this atlas raises in EVERY generation, however well the walk went.
 *
 * It never closes, because no run can close it — see this file's header and `gaps.ts`. It is the atlas
 * saying, each time it publishes, what its browser coverage does and does not prove.
 */
function denominatorGap({ at }: { at: string }): GithubGap {
  return walkGap({
    at,
    condition: "browser-denominator-unproven",
    kind: "admin-page",
    reason:
      "GitHub publishes no authenticated settings sitemap, so this walk is judged against the navigation GitHub rendered to this principal rather than against a list GitHub declared. Every link it rendered was followed; a page reachable only by direct URL, gated behind a feature flag, or shown only to a different role would never appear in it",
    scopeRef: "github",
  });
}

/**
 * The gaps a walk's own shortfalls raise, in the atlas's own vocabulary.
 *
 * @returns the denominator gap first, then one gap per shortfall the walk actually had
 */
export function walkGaps({ walk, at }: { walk: GithubWebWalkResult; at: string }): readonly GithubGap[] {
  const unreachable = walk.pages.filter((page) => page.outcome !== "landed").length;
  const unphotographed = walk.pages.filter((page) => page.outcome === "unphotographed").length;
  const shortfalls: readonly (GithubGap | null)[] = [
    denominatorGap({ at }),
    unreachable === 0
      ? null
      : walkGap({
          at,
          condition: "admin-page-unreachable",
          kind: "admin-page",
          reason: `${String(unreachable)} of ${String(walk.pages.length)} discovered admin page(s) did not render — ${summariseOutcomes({ walk })}`,
          scopeRef: "unreachable",
        }),
    unphotographed === 0
      ? null
      : walkGap({
          at,
          condition: "admin-page-unphotographed",
          kind: "admin-page",
          reason: `${String(unphotographed)} page(s) rendered and could not be photographed, so the atlas holds no proof of what they showed — a stored screenshot is what lets an agent read a page without piloting a browser to it`,
          scopeRef: "unphotographed",
        }),
    walk.incompletePages.length === 0
      ? null
      : walkGap({
          at,
          condition: "web-response-body-lost",
          kind: "web-request",
          reason: `${String(walk.incompletePages.length)} page(s) lost at least one response body, so what GitHub's own client asked for on them is recorded incompletely`,
          scopeRef: "github",
        }),
    walk.linkReadFailures.length === 0
      ? null
      : walkGap({
          at,
          condition: "admin-page-unreachable",
          kind: "admin-page",
          reason: `${String(walk.linkReadFailures.length)} page(s) rendered and their links could not be read (${walk.linkReadFailures[0]!.reason}), so the frontier they would have contributed was never seen`,
          scopeRef: "links-unread",
        }),
    walk.frontierRemaining.length === 0
      ? null
      : walkGap({
          at,
          condition: "incomplete-read",
          kind: "admin-page",
          reason: `the walk stopped after ${String(walk.roundsRun)} round(s) with ${String(walk.frontierRemaining.length)} discovered page(s) still unvisited, so the frontier was still growing when expansion was cut off`,
          scopeRef: "frontier",
        }),
  ];
  return shortfalls.filter((gap): gap is GithubGap => gap !== null);
}
