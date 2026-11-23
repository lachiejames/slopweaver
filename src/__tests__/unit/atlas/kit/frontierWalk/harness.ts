/*
 * What the frontier-walk test files share: the console origin and clock every case is stated against, a toy
 * platform spec whose grading reads only where the browser settled, the scripted visits a fake transport answers,
 * and one page observation with only the fields a test is about stated.
 */
import type { FrontierPageObservation, FrontierWalkSpec } from "../../../../../atlas/kit/frontierContract.js";

import type { FakeVisit } from "../../../../walkTransportFake.js";

/** The toy console's origin, which every walked and compared address hangs off. */
export const BASE = "https://console.example.com";
/** The instant a projection or a kind status is stamped with. */
export const AT = "2026-10-12T00:00:00.000Z";

/**
 * A platform whose grading reads only where the browser settled, so each test scripts one fact.
 *
 * @param lines the progress sink a case reads back
 * @returns the frontier walk spec over the toy console
 */
export function spec({
  declaredRoutes,
  maxRounds = 3,
  maxConsecutiveSessionLosses = 1,
  lines = [],
}: {
  declaredRoutes: readonly string[];
  maxRounds?: number;
  maxConsecutiveSessionLosses?: number;
  lines?: string[];
}): FrontierWalkSpec<string> {
  return {
    artifactDirectory: "shots",
    callFrom: ({ response, route }) => `${route} → ${response.method} ${response.url}`,
    declaredRoutes,
    gradeOutcome: ({ capture }) => {
      if (capture.finalUrl.includes("/login")) {
        return "signed-out";
      }
      if (capture.statusCode === 404) {
        return "unavailable";
      }
      return capture.finalUrl === capture.requestedUrl ? "landed" : "redirected";
    },
    isFirstParty: ({ response }) => response.url.startsWith("https://api.example.com/"),
    maxConsecutiveSessionLosses,
    maxRounds,
    progress: ({ line }) => {
      lines.push(line);
    },
    routesRenderedBy: ({ capture }) => capture.links.map((link) => new URL(link).pathname),
    settleMs: 0,
    urlFor: ({ route }) => `${BASE}${route}`,
  };
}

/**
 * A page that renders links to the given routes and nothing else.
 *
 * @returns the scripted visit whose capture carries only those links
 */
export function rendering({ routes }: { routes: readonly string[] }): FakeVisit {
  return { capture: { links: routes.map((route) => `${BASE}${route}`) } };
}

/**
 * The scripted outcome of one walk, keyed by route rather than by URL.
 *
 * @returns the same visits keyed by the absolute address the transport is asked for
 */
export function visits({ byRoute }: { byRoute: Readonly<Record<string, FakeVisit>> }): Record<string, FakeVisit> {
  return Object.fromEntries(Object.entries(byRoute).map(([route, visit]) => [`${BASE}${route}`, visit]));
}

/**
 * A stop rule that never ends the walk early.
 *
 * @returns false, always
 */
export const never = (): boolean => false;

/**
 * An observation with every field set, so a test states only the field it is about.
 *
 * @param over the fields a case sets, laid over a landed home page
 * @returns the observation
 */
export function observation({ over }: { over: Partial<FrontierPageObservation> }): FrontierPageObservation {
  return {
    artifacts: [],
    discoveredFrom: null,
    finalUrl: `${BASE}/home`,
    linksRendered: [],
    outcome: "landed",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 3 },
    route: "/home",
    statusCode: 200,
    title: "Home",
    ...over,
  };
}

/**
 * The toy platform's reason for each outcome, naming none for a landed page.
 *
 * @returns null for a landed page, else a reason naming the outcome
 */
export const explain = ({ outcome }: { outcome: string }): string | null =>
  outcome === "landed" ? null : `why ${outcome}`;
