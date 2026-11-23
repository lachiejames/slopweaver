/**
 * The two seams `./localPageServe.ts` serves a page over, as the route builds them: what the store says a page serves,
 * kept while its addresses read, and a fetch of one signed address's bytes, bounded.
 *
 * **Kept, so one page open is one child.** A page open asks the store afresh for its document; every image, stylesheet
 * or script the page then loads reuses that answer, so a page with forty images costs one CLI start and one signing
 * request, never forty. An answer is kept until a minute before its addresses expire, and only a page's: an absence or
 * a store that could not say is asked again next time. A fresh ask takes an answer at most {@link FRESH_REUSE_MS} old.
 *
 * **Bounded, because the local gateway closes sockets past it.** MEASURED by
 * `src/__tests__/integration/publishedPageObjects.test.ts`: 300 addresses fetched 20 at a time each gave back its own
 * bytes, and all 300 at once had the local Storage gateway close sockets (`docs/store/published-pages.md` § The proof).
 */
import type { PresentationSource, SignedBodyFetch } from "./localPageServe";
import type { PresentationRead } from "./pagePresentation";

/** How long before its addresses expire a kept answer stops being reused, in milliseconds. */
export const PRESENTATION_MARGIN_MS = 60_000;

/**
 * How old an answer a FRESH ask still takes, in milliseconds: the `/view` page reads the title, then its frame asks for
 * the document, and both are one page open. Past this, a fresh ask goes to the store, so a republished page is shown.
 */
export const FRESH_REUSE_MS = 5_000;

/** How many signed addresses the console fetches at once: the measured bound above. */
export const SIGNED_FETCHES_AT_ONCE = 20;

/**
 * Ask the store through `read`, keeping a page's answer while its addresses still read.
 *
 * @param read asks the store about one page
 * @param nowMs the monotonic clock a kept answer is judged by
 * @returns the source the page route serves over
 */
export function keptPresentation({
  read,
  nowMs,
}: {
  read: (args: { slug: string }) => Promise<PresentationRead>;
  nowMs: () => number;
}): PresentationSource {
  const kept = new Map<
    string,
    { readonly askedAtMs: number; readonly untilMs: number; readonly read: PresentationRead }
  >();
  return async ({ slug, fresh }) => {
    const held = kept.get(slug);
    const now = nowMs();
    // An answer asked "after" now is a clock that went backwards, and is never reused.
    const reusable = held !== undefined && now >= held.askedAtMs && now < held.untilMs;
    if (reusable && (!fresh || now - held.askedAtMs <= FRESH_REUSE_MS)) {
      return held.read;
    }
    const askedAtMs = now;
    const answer = await read({ slug });
    // Timed from when the read BEGAN, the conservative end: the addresses were signed some time after that.
    const untilMs = answer.kind === "page" ? askedAtMs + answer.expiresInSeconds * 1000 - PRESENTATION_MARGIN_MS : 0;
    if (answer.kind === "page" && nowMs() < untilMs) {
      kept.set(slug, { askedAtMs, read: answer, untilMs });
    } else {
      kept.delete(slug);
    }
    // Returned even when a slow read left it past its window: the ask that started it gets it, and an address that
    // has since expired fails its fetch, which `./localPageServe.ts` re-asks for once, fresh.
    return answer;
  };
}

/**
 * Wrap a fetch so at most `max` run at once, the rest waiting their turn in order.
 *
 * @param max how many may run at once
 * @param fetchBody the fetch to bound
 * @returns the bounded fetch
 */
export function boundedFetch({ max, fetchBody }: { max: number; fetchBody: SignedBodyFetch }): SignedBodyFetch {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (args) => {
    if (running >= max) {
      await new Promise<void>((resume) => {
        waiting.push(resume);
      });
    }
    running += 1;
    try {
      return await fetchBody(args);
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

/**
 * One signed address's bytes over HTTP, or `undefined` for any answer but a whole 200.
 *
 * @param url the signed address
 * @returns the bytes, or `undefined`
 */
export async function fetchSignedBody({ url }: { url: string }): Promise<Uint8Array | undefined> {
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      return undefined;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return undefined;
  }
}
