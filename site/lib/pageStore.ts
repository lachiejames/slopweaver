/**
 * The console's one way to a published page in the store: what the store says a page serves, kept per page, and a
 * bounded fetch of a signed address's bytes. The page route and the `/view` page's title both read through these two,
 * so a page open asks the store once (`./pageStoreSource.ts` carries why each is shaped as it is).
 *
 * The store is the one `slopweaver page read` selects in the child, from the `$SLOPWEAVER_HOME` the console was started
 * with, so a page another home published is not found here.
 */
import type { PresentationSource, SignedBodyFetch } from "./localPageServe";
import {
  PAGE_PRESENTATION_TIMEOUT_MS,
  PAGE_PRESENTATION_TITLE,
  pagePresentationArgv,
  presentationOf,
} from "./pagePresentation";
import { boundedFetch, fetchSignedBody, keptPresentation, SIGNED_FETCHES_AT_ONCE } from "./pageStoreSource";
import { spawnVerb } from "./spawnVerb";

/** What the store says a page serves, one kept answer per page, shared by every request this server answers. */
export const storedPagePresentation: PresentationSource = keptPresentation({
  // Monotonic, never the wall clock: a clock stepped back would make a stale answer look fresh.
  nowMs: () => performance.now(),
  read: async ({ slug }) =>
    presentationOf({
      outcome: await spawnVerb({
        argv: pagePresentationArgv({ slug }),
        timeoutMs: PAGE_PRESENTATION_TIMEOUT_MS,
        title: PAGE_PRESENTATION_TITLE,
      }),
      slug,
    }),
});

/** Every signed fetch this server makes, bounded together. */
export const storedPageBody: SignedBodyFetch = boundedFetch({
  fetchBody: fetchSignedBody,
  max: SIGNED_FETCHES_AT_ONCE,
});
