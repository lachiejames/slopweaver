/*
 * What the page-walk engine's test files share: a toy platform with two pages at its origin and one beneath a
 * root its probe has to learn, the walk spec over it, a transport whose probe lands on that root, and one page
 * observation with only the fields a test is about stated.
 */
import type { PageObservation, PageWalkSpec } from "../../../../../atlas/kit/pageWalk.js";
import { ok } from "../../../../../lib/result.js";

import { type FakeVisit, fakeTransport } from "../../../../walkTransportFake.js";

/** A toy platform: two pages at the origin, one beneath a root the probe has to learn. */
interface ToyPage {
  readonly surface: string;
  readonly path: string;
  readonly needsRoot: boolean;
}

/** The toy platform's origin, which every walked and compared address hangs off. */
export const ORIGIN = "https://toy.test";
/** The address the toy platform's own root probe visits first. */
export const PROBE = `${ORIGIN}/`;

const TOY_PAGES: readonly ToyPage[] = [
  { needsRoot: false, path: "one", surface: "one" },
  { needsRoot: false, path: "two", surface: "two" },
  { needsRoot: true, path: "three", surface: "three" },
];

/**
 * The toy spec, with the one decision a test is about overridden.
 *
 * @returns the walk spec over the toy platform's three pages
 */
export function toySpec({ over = {} }: { over?: Partial<PageWalkSpec<ToyPage, string>> } = {}): PageWalkSpec<
  ToyPage,
  string
> {
  return {
    artifactPathFor: ({ sha256 }) => `artifacts/pages/${sha256}.png`,
    gradeOutcome: ({ requestedUrl, capture }) =>
      capture.finalUrl === requestedUrl
        ? { redirected: false, unreachableBecause: null }
        : { redirected: true, unreachableBecause: "the client sent this address somewhere else" },
    pages: TOY_PAGES,
    photographPolicy: () => null,
    progressLabel: "toy",
    reduceCalls: ({ responses }) => responses.map((response) => response.url),
    resolveRoot: async ({ transport }) => {
      const probe = await transport.visit({ settleMs: 0, url: PROBE });
      return probe.isErr() ? ok(null) : ok(probe.value.finalUrl === PROBE ? null : `${ORIGIN}/root`);
    },
    rootMissingBecause: "this page hangs off a root the probe did not find",
    sessionLostOn: () => false,
    settleMs: 0,
    signedOutHint: "sign in again",
    urlFor: ({ root, page }) => {
      if (!page.needsRoot) {
        return `${ORIGIN}/${page.path}`;
      }
      return root === null ? null : `${root}/${page.path}`;
    },
    ...over,
  };
}

/**
 * A transport whose probe lands on a root, so every declared page resolves.
 *
 * @param visits per-address answers laid over the probe's own landing
 * @returns the fake transport and the addresses it was asked for
 */
export function withRoot({ visits = {} }: { visits?: Readonly<Record<string, FakeVisit>> } = {}): ReturnType<
  typeof fakeTransport
> {
  return fakeTransport({ visits: { [PROBE]: { capture: { finalUrl: `${ORIGIN}/root/landed` } }, ...visits } });
}

/**
 * One observation, with only the fields a test is about stated.
 *
 * @param over the fields a case sets, laid over a reached, photographed-looking page at the toy origin
 * @returns the observation
 */
export function observation({ over }: { over: Partial<PageObservation<string>> }): PageObservation<string> {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: `${ORIGIN}/one`,
    observedAt: "2026-09-05T00:00:00.000Z",
    redirected: false,
    requestedUrl: `${ORIGIN}/one`,
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "one",
    title: "One",
    unreachableBecause: null,
    ...over,
  };
}
