/**
 * The deterministic {@link BrowserPageTransport} every page-walk test in this repository drives.
 *
 * One fake rather than one per atlas, and it sits beside the other cross-cutting helpers rather than inside
 * one platform's own test directory: a capture is a capture, so a copy per atlas is a second place a default
 * drifts, and the tests that depend on the default are exactly the ones about a page the walk could not
 * complete. MEASURED, which is why it moved here and widened: thirteen test files had grown
 * their own `capture()` and their own transport literal, and the four capabilities those copies expressed
 * that this one could not — an ordered answer, the settle a visit was asked for, the photograph flag it was
 * asked for, and a refusal for an address nobody scripted — are the four fields added below.
 *
 * A plain function passed in, never a mock: it answers from a table keyed by the URL asked for, records
 * every URL and every argument it was given, and can be told to fail with a real typed transport error.
 * That is what lets a redirect, a lost session, a lost response body, an unphotographed page and a missing
 * screenshot all be settled by unit tests rather than by luck in a live run.
 */
import { err, ok, type Result } from "#lib/result.js";
import {
  type BrowserPageTransport,
  type BrowserTransportError,
  BrowserTransportErrors,
  type PageCapture,
} from "../browser/pageTransport.js";
import { renderedPng } from "./pngFixture.js";

/**
 * What the fake should do for one requested URL.
 *
 * `thenCapture` is what the SECOND and later visits to that URL answer, and it exists for exactly one
 * behaviour: `visitPhotographed` looks again at a page whose first shot was a loading frame, so a fake that
 * can only answer one thing per URL cannot express a page that eventually renders.
 *
 * @internal
 */
export type FakeVisit =
  | { readonly capture: Partial<PageCapture>; readonly thenCapture?: Partial<PageCapture> }
  | { readonly failWith: BrowserTransportError };

/**
 * One visit as the walk ASKED for it, rather than as the fake answered it.
 *
 * `photographed` is the load-bearing half and it is why this record exists rather than a list of URLs: a
 * picture that must never be kept must never be TAKEN, and the only place that is observable from a test is
 * what the walk asked the transport for. Every guard downstream of `visit` is guarding a file the real
 * transport has already written. Omitting the flag means yes, per {@link BrowserPageTransport.visit}, so it
 * is normalised here and a test never has to repeat that rule.
 *
 * @internal
 */
export interface AskedVisit {
  readonly url: string;
  readonly settleMs: number;
  readonly photographed: boolean;
}

/**
 * A capture with every field set, so a test states only the field it is about.
 *
 * @param over the fields this test is about
 * @param url the URL asked for, which is both the requested and the settled address unless overridden
 * @returns the capture
 */
export function capture({ over, url }: { over: Partial<PageCapture>; url: string }): PageCapture {
  return {
    finalUrl: url,
    observedAt: "2026-09-05T00:00:00.000Z",
    requestedUrl: url,
    links: [],
    linksBlockedBecause: null,
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    responses: [],
    screenshotBlockedBecause: null,
    screenshotPng: renderedPng(),
    statusCode: 200,
    title: "a page",
    ...over,
  };
}

/**
 * What a fake transport recorded about the run it served.
 *
 * @internal
 */
export interface FakeTransport {
  readonly transport: BrowserPageTransport;
  /** Every URL `visit` was asked for, in order. */
  readonly visited: readonly string[];
  /** Every visit as it was asked for, in order — the settle and the photograph flag beside the URL. */
  readonly asked: readonly AskedVisit[];
  /** How many times `release` was called. */
  readonly releases: () => number;
}

/**
 * Turn one scripted entry into the answer for this visit.
 *
 * Pure, and split out of {@link fakeTransport} so the builder stays one readable body: this is where the
 * SECOND-visit rule lives, which is the only part of the fake that depends on what came before.
 *
 * @param entry what the script says about this address
 * @param seenBefore whether this exact address has already been visited
 * @param url the address asked for, which fills the capture that is not overridden
 * @returns the capture, or the typed failure the script asked for
 */
function answered({
  entry,
  seenBefore,
  url,
}: {
  entry: FakeVisit;
  seenBefore: boolean;
  url: string;
}): Result<PageCapture, BrowserTransportError> {
  if ("failWith" in entry) {
    return err(entry.failWith);
  }
  const later = entry.thenCapture;
  if (seenBefore && later !== undefined) {
    return ok(capture({ over: later, url }));
  }
  return ok(capture({ over: entry.capture, url }));
}

/**
 * Build a fake transport.
 *
 * `answer` and `visits` are two spellings of the same decision and a caller uses one: the table is the
 * declarative form and covers most walks, while `answer` is what an ORDERED script needs — a walk whose
 * second visit to the same address must differ, or whose reply is computed from the address rather than
 * looked up. When `answer` is supplied it decides every visit and the table is not consulted at all.
 *
 * The default picture is the SAME bytes for every URL, which the kit grades as a duplicate screenshot: a
 * walk whose pages must be independently evidenced passes `answer` and varies `renderedPng({ seed })`
 * itself. The default is left constant because the tests that depend on it are about a page the walk could
 * not complete, where the picture is not the subject.
 *
 * @param visits what to answer for each requested URL; a URL with no entry gets `defaultCapture`
 * @param defaultCapture what to answer for a URL with no entry, so a test can make every page behave one way
 * @param answer decides every visit from the address and the 0-based count of visits already served
 * @param unscriptedFails the failure an address with no `visits` entry gets, instead of `defaultCapture`
 * @param releaseFails the failure `release` answers with, instead of succeeding
 * @returns the transport and what it recorded
 */
export function fakeTransport({
  visits = {},
  defaultCapture = {},
  answer,
  unscriptedFails,
  releaseFails,
}: {
  visits?: Readonly<Record<string, FakeVisit>>;
  defaultCapture?: Partial<PageCapture>;
  answer?: (input: { url: string; visitIndex: number }) => FakeVisit;
  unscriptedFails?: BrowserTransportError;
  releaseFails?: BrowserTransportError;
} = {}): FakeTransport {
  const visited: string[] = [];
  const asked: AskedVisit[] = [];
  let releaseCount = 0;
  const served = ({
    url,
    visitIndex,
  }: {
    url: string;
    visitIndex: number;
  }): Result<PageCapture, BrowserTransportError> => {
    const entry = answer === undefined ? visits[url] : answer({ url, visitIndex });
    if (entry === undefined) {
      if (unscriptedFails !== undefined) {
        return err(unscriptedFails);
      }
      return ok(capture({ over: defaultCapture, url }));
    }
    const seenBefore = visited.filter((seen) => seen === url).length > 1;
    return answered({ entry, seenBefore, url });
  };
  return {
    asked,
    releases: () => releaseCount,
    transport: {
      release: async () => {
        releaseCount += 1;
        if (releaseFails !== undefined) {
          return err(releaseFails);
        }
        return ok(null);
      },
      // A destructured default rather than a coalesce: omitting the flag means yes, per the seam, and
      // `no-silent-fallback` wants the substitution said out loud rather than spelled `??`.
      visit: async ({ url, settleMs, photograph = true }) => {
        const visitIndex = visited.length;
        visited.push(url);
        asked.push({ photographed: photograph, settleMs, url });
        return served({ url, visitIndex });
      },
    },
    visited,
  };
}

/**
 * An artifact writer that records what it was ASKED to write and always succeeds.
 *
 * The `written` list is what it was OFFERED rather than what survived, and that is the load-bearing half:
 * a walk that clears a withheld page's `artifacts` array after the fact leaves the bytes on disk, and every
 * assertion over the OBSERVATION reads clean while it does.
 *
 * @returns the writer and the relative paths it was given
 */
export function recordingWriter(): {
  write: (input: { relativePath: string; bytes: Uint8Array; sha256: string }) => Result<null>;
  written: readonly string[];
} {
  const written: string[] = [];
  return {
    write: ({ relativePath }) => {
      written.push(relativePath);
      return ok(null);
    },
    written,
  };
}

/**
 * An `answer` that replies to each visit from a QUEUE, in the order the walk asks.
 *
 * A combinator over `answer` rather than a fourth field on {@link fakeTransport}, so the precedence rules
 * inside the fake stay at one. It is here rather than in each test because two behaviours need it and both
 * are about ORDER rather than address: `visitPhotographed` looks at the same URL twice and the second look
 * must differ, and a walk driven page by page is asserted on what its Nth visit got back.
 *
 * Running out is a typed NAVIGATION_FAILED rather than a default capture: a walk that asked for more pages
 * than the test scripted is a test that is not saying what it thinks it is, and a silent default hides it.
 *
 * @param visits what to answer, one per visit, in order
 * @returns the `answer` to hand {@link fakeTransport}
 */
export function inOrder({
  visits,
}: {
  visits: readonly FakeVisit[];
}): (input: { url: string; visitIndex: number }) => FakeVisit {
  return ({ url, visitIndex }) => {
    const next = visits[visitIndex];
    if (next === undefined) {
      return {
        failWith: BrowserTransportErrors.navigationFailed({
          because: "the fake reported this page unreachable",
          reason: "the fake ran out of captures",
          url,
        }),
      };
    }
    return next;
  };
}

/**
 * An `answer` that replies to each visit from a queue and REPEATS its last entry once exhausted.
 *
 * The difference from {@link inOrder} is the whole reason both exist: a test about what the second look got
 * back scripts two answers and cares that a third never happens, while a test about a walk over forty
 * declared pages scripts one answer and means "every page behaves this way".
 *
 * @param visits what to answer, one per visit, the last repeating forever
 * @returns the `answer` to hand {@link fakeTransport}
 */
export function inOrderThenRepeat({
  visits,
}: {
  visits: readonly FakeVisit[];
}): (input: { url: string; visitIndex: number }) => FakeVisit {
  return ({ url, visitIndex }) => {
    const last = visits.at(-1);
    if (last === undefined) {
      return {
        failWith: BrowserTransportErrors.navigationFailed({
          because: "the fake reported this page unreachable",
          reason: "the fake was given no captures",
          url,
        }),
      };
    }
    const next = visits[visitIndex];
    if (next === undefined) {
      return last;
    }
    return next;
  };
}
