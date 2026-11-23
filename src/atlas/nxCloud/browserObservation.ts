/**
 * What the Nx Cloud walk's visits came to, and how each is judged. Pure: no transport, no artifact write.
 *
 * ## Reachability is graded on the HTTP STATUS, which this platform actually returns
 *
 * The sibling walks all had to work around a single-page app that answers 200 for a route it does not have.
 * Nx Cloud does not: MEASURED, the workspace settings page answered **403** and the organisation
 * settings path answered **404**, each rendering the client's own error view inside the real application
 * shell. So a status of 400 or more is the honest, checkable reachability signal here, and the walk grades
 * on it rather than on a title constant nobody can verify later. Where the browser settles somewhere else
 * entirely, that is still recorded as a redirect.
 */
import type { PageCapture, ResponseAccounting } from "../../browser/pageTransport.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { addressDisagreement } from "../kit/pageWalk.js";

import type { NxCloudDeclaredRoute, NxCloudObservedCall } from "./browserReduction.js";

/** What one declared route's visit came to. */
export interface NxCloudRouteObservation {
  /** The declared path PATTERN, which is this route's identity. */
  readonly pathPattern: string;
  /** Whether the walk got as far as asking for this page at all. `false` after a lost session. */
  readonly attempted: boolean;
  /** The URL asked for, or `""` when the page was never addressed. */
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number | null;
  readonly title: string;
  readonly observedAt: string;
  /** Whether the client sent this page somewhere other than where it was asked to go. */
  readonly redirected: boolean;
  /** Whether every eligible response body was read; false means the walk saw less than it looks like. */
  readonly captureComplete: boolean;
  /** What the page's capture actually accounted for, so incompleteness is a number rather than a silence. */
  readonly responseAccounting: ResponseAccounting;
  /** Why this declared route is not held, or `null` when it is. */
  readonly unreachableBecause: string | null;
  /** Why this page has no proof screenshot, or `null` when it has one. */
  readonly screenshotMissingBecause: string | null;
  readonly calls: readonly NxCloudObservedCall[];
  /** The proof screenshot, or an empty list when there is none. */
  readonly artifacts: readonly AtlasArtifactRef[];
}

/** What the walk produced. */
export interface NxCloudBrowserWalkResult {
  readonly routes: readonly NxCloudRouteObservation[];
  /** Every route the client itself declared during the walk, folded across every page. */
  readonly declaredRoutes: readonly NxCloudDeclaredRoute[];
  /** Whether the walk stopped early because the session was lost. */
  readonly sessionLost: boolean;
}

/**
 * How one visited page's reachability is graded.
 *
 * @param requestedUrl the URL the walk asked for
 * @param capture what the transport returned
 * @returns whether the page was redirected, and why it is not held when it is not
 */
export function nxCloudRouteOutcome({ requestedUrl, capture }: { requestedUrl: string; capture: PageCapture }): {
  redirected: boolean;
  unreachableBecause: string | null;
} {
  const settled = parseUrl({ url: capture.finalUrl });
  const disagreement = addressDisagreement({ finalUrl: capture.finalUrl, requestedUrl });
  if (settled === null || disagreement === "unreadable") {
    return { redirected: true, unreachableBecause: "the browser settled on an address this atlas cannot read" };
  }
  if (disagreement === "origin") {
    return {
      redirected: true,
      unreachableBecause: `the client sent this address to ${settled.origin}, which is not where it was asked to go`,
    };
  }
  const status = capture.statusCode;
  if (status !== null && status >= 400) {
    const refused = status === 401 || status === 403;
    const because = refused
      ? "this account's Nx Cloud role does not reach it — a bound on the atlas, not an absence in the platform"
      : "the application has no such route";
    return { redirected: false, unreachableBecause: `HTTP ${String(status)}: ${because}` };
  }
  if (disagreement !== null) {
    return {
      redirected: true,
      unreachableBecause: `the client did not keep this address — it answered ${String(status)} and settled on a different path`,
    };
  }
  return { redirected: false, unreachableBecause: null };
}

/** A URL, or `null` when it cannot be read. */
function parseUrl({ url }: { url: string }): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Whether one observation is fully held — reached, photographed, and carrying the artifact to prove it.
 *
 * The artifact check is not redundant with `screenshotMissingBecause === null`: those two fields are set by
 * the walk and the artifact list is set by the writer, so a row can carry both nullable reasons and an empty
 * artifact list. The Notion atlas found that gap by counterexample and this walk inherits the guard.
 *
 * @param route the observation to judge
 * @returns whether the atlas holds this declared route in full
 */
export function isRouteHeld({ route }: { route: NxCloudRouteObservation }): boolean {
  return route.unreachableBecause === null && route.screenshotMissingBecause === null && route.artifacts.length > 0;
}

/**
 * Mark every page whose picture is byte-identical to another declared route's as not independently evidenced.
 *
 * Artifacts are content-addressed, so two pages that photograph the same thing share one file — correct
 * storage, and a silent disaster for a coverage claim. Nx Cloud's error views make this reachable: a walk
 * whose session had lapsed would photograph the same sign-in shell on every route and report them all held.
 *
 * @param routes every declared route's observation
 * @returns the observations, with a shared picture recorded on each route that shares one
 */
export function markIndistinguishableRoutes({
  routes,
}: {
  routes: readonly NxCloudRouteObservation[];
}): readonly NxCloudRouteObservation[] {
  const bySha = Map.groupBy(
    routes.flatMap((route) =>
      route.artifacts.map((artifact) => ({ pathPattern: route.pathPattern, sha256: artifact.sha256 })),
    ),
    (entry) => entry.sha256,
  );
  return routes.map((route): NxCloudRouteObservation => {
    // Every artifact any route carries was grouped above, so each lookup here is present.
    const shared = route.artifacts.flatMap((artifact) => bySha.get(artifact.sha256)!.map((entry) => entry.pathPattern));
    const others = [...new Set(shared)].filter((pattern) => pattern !== route.pathPattern).toSorted();
    if (others.length === 0) {
      return route;
    }
    return {
      ...route,
      artifacts: [],
      screenshotMissingBecause:
        `its screenshot is byte-identical to ${String(others.length)} other declared route(s) ` +
        `(${others.join(", ")}), so it evidences no surface of its own`,
    };
  });
}
