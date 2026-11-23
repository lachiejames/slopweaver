/**
 * Publishing what a browser walk saw: the `page` kind's browser channel, the browser half of `operation`,
 * their coverage cells, and the gaps a walk can open and close.
 *
 * The control flow — merge the channel, reconcile the gaps, abort on the first failure, and replace only
 * this surface's coverage cell — is `kit/walkPublish.ts`'s, because a copy of it is where one atlas ends up
 * assembling a file from a failed merge or blanking another channel's coverage. What is genuinely Jam's is
 * the two refusals below and what its gaps say.
 *
 * ## A run whose not-found controls were unusable is REFUSED
 *
 * Before that control existed this atlas published nine of Jam's own rendered not-found pages as routes it
 * had reached, each with a verified screenshot. A run whose detector has gone inert cannot tell a real page
 * from a rendered 404, so it may not write a page grading at all. The remedy follows the walk's typed cause:
 * controls that DISAGREED (`band`) prescribe re-measuring the band, because a retry of a broken oracle is the
 * same wrong answer again; a control missing, unreached or unphotographed is this run's fault, and
 * prescribes walking again.
 *
 * ## The denominator gap never closes, and that is the honest state
 *
 * `browserPages.ts` explains why: Jam publishes no sitemap for the application, every application path
 * answers the marketing shell to an unauthenticated prober, and the application renders almost no anchors —
 * so the declared list is the application's own bundle-declared router table and nothing can widen it by
 * crawling. `web-denominator-is-harvested` is therefore opened by every successful walk.
 *
 * ## The integration kind's browser channel stays EMPTY, and says why
 *
 * Deriving an integration from a route segment was tried and produced four invented disagreements —
 * `jamIntegrationBrowserLimit` carries the measurement. The channel now writes a `deferred` cell naming the
 * limit instead, which is a different claim from "this workspace has installed none" and the only one the
 * transport seam can support.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { assembleWalkKind, refuseUndeclaredWalk, verifyArtifactsOnDisk, walkTally } from "../kit/walkPublish.js";

import { pageKindFile } from "./browserPageKind.js";
import { JAM_BROWSER_PAGES } from "./browserPages.js";
import { type JamBrowserWalkResult, type JamObservedCall, type JamPageObservation } from "./browserWalk.js";
import { failedJamCoverageCell, succeededJamCoverageCell, withJamCoverageCell } from "./coverage.js";
import { JamAtlasErrors, jamAtlasErrorLines } from "./errors.js";
import { mergeJamChannel } from "./merge.js";
import {
  emptyJamKindFile,
  initialJamManifest,
  JAM_INTEGRATION_KIND,
  JAM_OPERATION_KIND,
  JAM_PAGE_KIND,
  type JamAtlasKindFile,
  type JamAtlasManifest,
  type JamCoverageCell,
} from "./model.js";
import { projectJamObservedCall } from "./projection.js";
import { type JamAtlasPaths, publishJamAtlas, readJamAtlas, withJamPublishLock } from "./store.js";
import { JAM_MCP_UNBLOCKED_BY, JAM_WEB_APP_SURFACE, JAM_WEB_CLIENT_SURFACE } from "./surfaces.js";

/** What a walk publication did, which is what `--json` prints. */
export interface JamWebOutcome {
  /** Distinct first-party endpoint shapes the app called while being walked. */
  readonly callCount: number;
  /** Declared pages in total — the denominator a coverage fraction is built from. */
  readonly declaredCount: number;
  /** Declared pages that actually rendered. */
  readonly reachedCount: number;
  /** Reached pages carrying a verified screenshot. */
  readonly photographedCount: number;
  readonly written: readonly string[];
}

/**
 * Why the browser channel names no integration, stated as a function rather than left as an empty file.
 *
 * ## The over-claim this replaced, measured on this atlas's own third walk
 *
 * The first cut derived an integration slug from the next segment of a landed `/settings/integrations/…`
 * route, the way a sibling atlas legitimately does. MEASURED: the four segments it found were
 * `ai-agents`, `helpdesk`, `issue-trackers` and `webhooks` — Jam's integration CATEGORIES, not integrations
 * — and the disagreement report duly announced four integrations the application names that Jam publishes
 * no page for. Every one of them was invented by the comparison.
 *
 * That is exactly the question `docs/atlas-intent/04-corroboration.md` says any two-surface comparison owes itself: is the
 * thing being matched the provider's own key, or an artefact of how one surface phrased its question? Here
 * it was the second. The individual integrations are rendered as CONTROLS on the category page, and the
 * transport exposes a page's calls and a screenshot and nothing else — deliberately, because a walk that
 * could read a page's content would be reading team members' names out of whatever else it rendered.
 *
 * @returns the sentence the integration kind's browser coverage cell carries
 *
 * @internal
 */
export function jamIntegrationBrowserLimit(): string {
  return (
    "no integration is named by the browser channel, and that is a limit of what a page walk can see rather " +
    "than a fact about this workspace. Jam's settings routes name integration CATEGORIES — `ai-agents`, " +
    "`helpdesk`, `issue-trackers`, `webhooks` — and the integrations themselves are controls on those " +
    "pages, which the transport does not expose. Deriving a slug from the route segment was tried and " +
    "reported those four categories as integrations the application names and Jam publishes no page for, " +
    "which was four invented disagreements. What would fill this channel is the MCP resource, not a walk"
  );
}

/** The `operation` kind's browser coverage cell, which is never a completeness claim. */
function operationCoverageCell({
  calls,
  reached,
  at,
}: {
  calls: readonly JamObservedCall[];
  reached: number;
  at: string;
}): JamCoverageCell {
  return succeededJamCoverageCell({
    artifacts: [],
    at,
    channel: "browser",
    reason:
      `${String(calls.length)} distinct first-party endpoint shape(s) observed while walking ` +
      `${String(reached)} reached page(s). This surface is \`discovery\`: seeing the client call something ` +
      "establishes that the operation EXISTS and nothing about what an ordinary token may ask for",
    role: "discovery",
    scope: "web-application",
    state: "synced",
    surface: JAM_WEB_CLIENT_SURFACE,
  });
}

/**
 * The `integration` kind's file after a walk: its browser cell replaced by the stated limit, nothing else.
 *
 * It keeps the STORED clock, which is the point rather than an omission. A walk reaches no integration — the
 * cell below says exactly that — so {@link walkManifest} stamps no success for the kind, while the stored
 * manifest's own `lastAttempt` is still the last sync's `ok`. That is precisely the pair
 * `kit/manifestClock.ts` compares, so stamping this run's instant here publishes a file newer than the
 * success recorded beside it. MEASURED: a walk that landed every declared page was refused
 * outright with "integration carries two clocks: its file says a later instant than the status
 * published beside it says it last succeeded at", and nothing it had just seen was
 * written. `notion/sync.ts`'s `contentCoverageOnto` carries the same fix for the same reason.
 */
function integrationKindFile({ stored }: { stored: JamAtlasKindFile }): JamAtlasKindFile {
  return {
    ...stored,
    coverage: [
      ...withJamCoverageCell({
        cells: stored.coverage,
        replacement: failedJamCoverageCell({
          channel: "browser",
          previous: null,
          reason: jamIntegrationBrowserLimit(),
          role: "discovery",
          scope: "web-application",
          state: "deferred",
          surface: JAM_WEB_APP_SURFACE,
          unblockedBy: JAM_MCP_UNBLOCKED_BY,
        }),
      }),
    ],
    updatedAt: stored.updatedAt,
  };
}

/** Every distinct call the walk saw across all its pages. */
function observedCalls({ pages }: { pages: readonly JamPageObservation[] }): readonly JamObservedCall[] {
  const byKey = new Map<string, JamObservedCall>();
  for (const page of pages) {
    for (const call of page.calls) {
      byKey.set(`${call.method} ${call.origin}${call.pathShape}`, call);
    }
  }
  return [...byKey.entries()].toSorted(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

/** The manifest a walk publishes: the two kinds it touched stamped, every other kind left as it was. */
function walkManifest({
  manifest,
  pageCount,
  operationCount,
  at,
}: {
  manifest: JamAtlasManifest | null;
  pageCount: number;
  operationCount: number;
  at: string;
}): JamAtlasManifest {
  const base = manifest ?? initialJamManifest({ updatedAt: at });
  const attempt = { at, outcome: "ok" as const, reasons: [] };
  return {
    ...base,
    kinds: {
      ...base.kinds,
      operation: { digest: null, entityCount: operationCount, lastAttempt: attempt, lastSuccessAt: at },
      page: { digest: null, entityCount: pageCount, lastAttempt: attempt, lastSuccessAt: at },
    },
    updatedAt: at,
  };
}

/**
 * Publish one walk onto the browser channel of `page`, `operation` and `integration`.
 *
 * @param paths the resolved atlas paths
 * @param walk what the walk saw
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishJamWebWalk({
  paths,
  walk,
  at,
}: {
  paths: JamAtlasPaths;
  walk: JamBrowserWalkResult;
  at: string;
}): Result<JamWebOutcome> {
  if (walk.controlFailure !== null) {
    return err(jamAtlasErrorLines({ error: JamAtlasErrors.uncorroborated(walk.controlFailure) }));
  }
  const declared = refuseUndeclaredWalk({
    declaredSurfaces: JAM_BROWSER_PAGES.map((page) => page.surface),
    pages: walk.pages,
  });
  if (declared.isErr()) {
    return err(declared.error);
  }
  const pages = verifyArtifactsOnDisk({ directory: paths.directory, pages: walk.pages });
  const calls = observedCalls({ pages });
  return withJamPublishLock({
    nowIso: at,
    paths,
    publish: () => publishVerified({ at, calls, pages, paths }),
  });
}

/**
 * The `operation` kind's next file, with only the BROWSER channel refreshed.
 *
 * The walk writes into the same kind the sync does, and that is deliberate rather than a collision: a call
 * the application made and an operation the description declares are the same THING seen two ways, so they
 * belong on one entity with two channels. Its GAPS are the sync's and are carried forward untouched.
 */
function operationKindFile({
  stored,
  calls,
  reached,
  at,
}: {
  stored: JamAtlasKindFile;
  calls: readonly JamObservedCall[];
  reached: number;
  at: string;
}): Result<JamAtlasKindFile> {
  const fields = assembleWalkKind({
    at,
    cell: operationCoverageCell({ at, calls, reached }),
    merge: () =>
      mergeJamChannel({
        at,
        channel: "browser",
        observed: calls.map((call) => projectJamObservedCall({ at, call })),
        stored: stored.entities,
      }),
    reconcile: () => ok(stored.gaps),
    stored,
    surface: JAM_WEB_CLIENT_SURFACE,
  });
  return fields.isErr() ? err(fields.error) : ok({ ...stored, ...fields.value });
}

/** The read-and-publish half, taken under the lock so a concurrent sync cannot lose either writer's rows. */
function publishVerified({
  paths,
  pages,
  calls,
  at,
}: {
  paths: JamAtlasPaths;
  pages: readonly JamPageObservation[];
  calls: readonly JamObservedCall[];
  at: string;
}): Result<JamWebOutcome> {
  const snapshot = readJamAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const held = snapshot.value.files;
  const tally = walkTally({ pages });
  const pageFile = pageKindFile({
    at,
    pages,
    stored: held[JAM_PAGE_KIND] ?? emptyJamKindFile({ kind: JAM_PAGE_KIND, updatedAt: at }),
  });
  if (pageFile.isErr()) {
    return err(pageFile.error);
  }
  const operationFile = operationKindFile({
    at,
    calls,
    reached: tally.reached,
    stored: held[JAM_OPERATION_KIND] ?? emptyJamKindFile({ kind: JAM_OPERATION_KIND, updatedAt: at }),
  });
  if (operationFile.isErr()) {
    return err(operationFile.error);
  }
  const written = writeGeneration({
    at,
    integrations: integrationKindFile({
      stored: held[JAM_INTEGRATION_KIND] ?? emptyJamKindFile({ kind: JAM_INTEGRATION_KIND, updatedAt: at }),
    }),
    manifest: snapshot.value.manifest,
    operations: operationFile.value,
    pages: pageFile.value,
    paths,
  });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({
    callCount: calls.length,
    declaredCount: pages.length,
    photographedCount: tally.photographed,
    reachedCount: tally.reached,
    written: written.value,
  });
}

/**
 * Write the three kind files and the manifest a walk stamps.
 *
 * `manifest` is the generation this walk READ and is stamping onto, so it is also the compare-and-swap
 * basis `publishJamAtlas` refuses against — the same value in both roles rather than two that could drift.
 */
function writeGeneration({
  paths,
  pages,
  operations,
  integrations,
  manifest,
  at,
}: {
  paths: JamAtlasPaths;
  pages: JamAtlasKindFile;
  operations: JamAtlasKindFile;
  integrations: JamAtlasKindFile;
  manifest: JamAtlasManifest | null;
  at: string;
}): Result<readonly string[]> {
  return publishJamAtlas({
    derivedFrom: manifest,
    files: {
      [JAM_INTEGRATION_KIND]: integrations,
      [JAM_OPERATION_KIND]: operations,
      [JAM_PAGE_KIND]: pages,
    },
    manifest: walkManifest({
      at,
      manifest,
      operationCount: operations.entities.length,
      pageCount: pages.entities.length,
    }),
    paths,
  });
}
