/**
 * Assemble one Slack atlas generation from an API read and a driven-browser walk. Pure.
 *
 * Everything effectful — reading the installed typings, driving the browser, writing the files — happens
 * either side of this module. What lives here is the accumulate-never-replace fold; the coverage arithmetic
 * lives in `./atlasCoverage.ts` and the gap reconciliation in `./atlasGaps.ts`, so all three are testable with
 * three literals and no browser.
 *
 * ## A channel folds onto its own slot and nowhere else
 *
 * `kit/merge.ts` takes the fold as a callback precisely so an atlas with independent surfaces can keep them
 * independent. `entityFold.ts`'s `foldSlackEntity` writes only the channels this run actually observed: a run that
 * drove the browser and did not re-read the SDK leaves the `api` channel exactly as it was, with its own
 * `firstSeenAt` intact. One surface succeeding must never erase what the other already knew.
 *
 * ## An incomplete run publishes nothing it would have to lie about
 *
 * `mergeKind`'s stale-the-absent pass is only safe on a COMPLETE read, so this module runs it only when the
 * surface it concerns actually succeeded. A browser walk that ended at the sign-in wall never reaches here
 * at all; a walk that reached some destinations and not others staled nothing, because a method absent from
 * a half-finished walk has not disappeared — it has not been looked for.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";

import { browserCoverage, contentsHeldElsewhere, coverageCell, syncedStatus } from "./atlasCoverage.js";
import { reconcileMethodGaps, reconcilePageGaps } from "./atlasGaps.js";
import {
  emptySlackAtlasKindFile,
  SLACK_ATLAS_PLATFORM,
  SLACK_ATLAS_SCHEMA_VERSION,
  type SlackArtifactRef,
  type SlackAtlasEntity,
  type SlackAtlasGap,
  type SlackAtlasKind,
  type SlackAtlasKindFile,
  type SlackAtlasManifest,
} from "./atlasModel.js";
import {
  type DrivenPage,
  matchMethodSurfaces,
  projectApiMethods,
  projectBrowserMethods,
  projectDeclaredPages,
  projectPages,
} from "./atlasProjection.js";
import {
  compareSurfaces,
  type DisagreementSummary,
  type SurfaceComparison,
  summariseDisagreements,
} from "./disagreement.js";
import type { DrivenSession, DrivenWalkedPage } from "./drivenSession.js";
import { foldSlackEntity, staleSlackEntity } from "./entityFold.js";
import type { SdkMethod } from "./model.js";
import { SLACK_SURFACE_PAGES, type SlackSurfacePage, type SlackSurfaceRoots, surfacePageKey } from "./surfacePages.js";

/**
 * The declared page each walked path belongs to, keyed by provider key.
 *
 * A walk that lands somewhere undeclared still produces an entity — `activity-inbox` was discovered exactly
 * that way, by asking for nine routes that do not exist on a grid workspace and reading where the client
 * went instead — so this answers `undefined` rather than refusing.
 */
const DECLARED_BY_KEY: ReadonlyMap<string, SlackSurfacePage> = new Map(
  SLACK_SURFACE_PAGES.map((page) => [surfacePageKey({ page }), page]),
);

/**
 * Whether a page's picture may be stored, and why not when it may not.
 *
 * The refusal is applied HERE, at the moment the reference would be attached, rather than by clearing one
 * afterwards — `kit/pageWalk.ts` records why: clearing a reference left the bytes on disk on another atlas
 * while every count read clean. An undeclared page is refused too, because no policy was ever stated for it
 * and defaulting to "photograph it" is the direction that publishes something nobody asked for.
 *
 * @param path the walked page's provider key
 * @returns the refusal, or `null` when the picture may be stored
 *
 * @internal
 */
export function screenshotRefusedBecause({ path }: { path: string }): string | null {
  const declared = DECLARED_BY_KEY.get(path);
  if (declared === undefined) {
    return `${path} is not in the declared surface map, so no screenshot policy was ever stated for it`;
  }
  return declared.screenshot === "refused" ? `the surface map refuses a picture of ${path}: ${declared.purpose}` : null;
}

/**
 * Why a walked page carries no picture: nothing when one is attached, the declared policy's refusal when there
 * is one, else the walk's own reason — which is `null` for a page the walk did photograph.
 */
function missingShotBecause({
  page,
  refused,
  stored,
}: {
  page: DrivenWalkedPage;
  refused: string | null;
  stored: SlackArtifactRef | null;
}): string | null {
  if (stored !== null) {
    return null;
  }
  if (refused !== null) {
    return refused;
  }
  return page.screenshotMissingBecause;
}

/**
 * Attach each stored screenshot to the page it was taken of, applying the declared policy.
 *
 * @param session what the driven browser saw
 * @param screenshots the artifacts `sync` stored, keyed by the walked page's provider key
 * @returns the pages the projection consumes
 */
function withScreenshots({
  session,
  screenshots,
}: {
  session: DrivenSession;
  screenshots: ReadonlyMap<string, SlackArtifactRef>;
}): readonly DrivenPage[] {
  return session.pages.map((page) => {
    const refused = screenshotRefusedBecause({ path: page.path });
    const stored = refused === null ? (screenshots.get(page.path) ?? null) : null;
    return {
      calls: page.calls,
      observedAt: page.observedAt,
      path: page.path,
      screenshot: stored,
      screenshotMissingBecause: missingShotBecause({ page, refused, stored }),
      title: page.title,
      url: page.url,
    };
  });
}

/** What one generation assembly produced, beyond the files themselves. */
export interface SlackAtlasGeneration {
  readonly files: Readonly<Record<SlackAtlasKind, SlackAtlasKindFile>>;
  readonly manifest: SlackAtlasManifest;
  readonly comparisons: readonly SurfaceComparison[];
  readonly summary: DisagreementSummary;
}

/** Both surfaces projected and matched, merged onto what the store already holds. */
interface MergedEntities {
  readonly methods: readonly SlackAtlasEntity[];
  readonly pages: readonly SlackAtlasEntity[];
}

/**
 * Project both surfaces and merge them onto the stored generation.
 *
 * @param methods every method the installed SDK declares
 * @param session what the driven browser saw
 * @param stored the kind files already on disk, `null` for a kind never published
 * @param at this run's ISO timestamp
 * @returns the merged entity lists, or the reason they cannot be merged
 */
function mergeSurfaces({
  methods,
  walked,
  session,
  roots,
  stored,
  at,
}: {
  methods: readonly SdkMethod[];
  walked: readonly DrivenPage[];
  session: DrivenSession;
  roots: SlackSurfaceRoots;
  stored: Readonly<Record<SlackAtlasKind, SlackAtlasKindFile | null>>;
  at: string;
}): Result<MergedEntities> {
  const observedMethods = matchMethodSurfaces({
    api: projectApiMethods({ at, methods }),
    browser: projectBrowserMethods({
      pages: walked,
      sdkMethodNames: new Set(methods.map((method) => method.name)),
      sdkParamsByMethod: new Map(
        methods.map((method) => [method.name, new Set(method.params.map((param) => param.name))]),
      ),
    }),
  });
  const mergedMethods = mergeKind({
    at,
    foldEntity: foldSlackEntity,
    observed: observedMethods,
    staleEntity: staleSlackEntity,
    stored: stored.method?.entities ?? [],
  });
  if (mergedMethods.isErr()) {
    return err(mergedMethods.error);
  }
  // Pages are folded WITHOUT the stale pass: a page entity this run did not observe is a surface the
  // declared map no longer names or the walk did not reach, and neither is a page that disappeared.
  const mergedPages = mergeKind({
    at,
    foldEntity: foldSlackEntity,
    observed: matchMethodSurfaces({
      api: projectDeclaredPages({ at, pages: SLACK_SURFACE_PAGES, roots }),
      browser: projectPages({ pages: walked }),
    }),
    staleEntity: () => null,
    stored: stored.page?.entities ?? [],
  });
  if (mergedPages.isErr()) {
    return err(mergedPages.error);
  }
  void session;
  return ok({ methods: mergedMethods.value, pages: mergedPages.value });
}

/**
 * Build both kind files from the merged entities, their gaps and this run's coverage.
 *
 * @param merged the merged entity lists
 * @param gaps the reconciled gaps, per kind
 * @param session what the driven browser saw, for the shared browser coverage cell
 * @param methodCount how many methods the installed SDK declared, which the API cell reports
 * @param sdkVersion the installed `@slack/web-api` version
 * @param at this run's ISO timestamp
 * @returns both kind files, ready to publish
 */
function kindFiles({
  merged,
  gaps,
  walked,
  methodCount,
  sdkVersion,
  at,
}: {
  merged: MergedEntities;
  gaps: Readonly<Record<SlackAtlasKind, readonly SlackAtlasGap[]>>;
  walked: readonly DrivenPage[];
  methodCount: number;
  sdkVersion: string;
  at: string;
}): Record<SlackAtlasKind, SlackAtlasKindFile> {
  const browserCell = browserCoverage({ at, walked });
  return {
    method: {
      ...emptySlackAtlasKindFile({ kind: "method", updatedAt: at }),
      coverage: [
        coverageCell({
          at,
          channel: "api",
          failed: false,
          reason: `${String(methodCount)} method(s) declared by @slack/web-api ${sdkVersion}`,
          scope: "installed-sdk",
          state: "synced",
        }),
        browserCell,
      ],
      entities: [...merged.methods],
      gaps: [...gaps.method],
    },
    page: {
      ...emptySlackAtlasKindFile({ kind: "page", updatedAt: at }),
      coverage: [
        coverageCell({
          at,
          channel: "api",
          failed: false,
          reason: `${String(SLACK_SURFACE_PAGES.length)} page(s) declared by the Slack surface map`,
          scope: "declared-surface-map",
          state: "synced",
        }),
        browserCell,
        contentsHeldElsewhere({ at }),
      ],
      entities: [...merged.pages],
      gaps: [...gaps.page],
    },
  };
}

/**
 * Assemble one generation: both surfaces projected, matched, merged onto what is stored, and compared.
 *
 * @param methods every method the installed SDK declares
 * @param session what the driven browser saw
 * @param stored the kind files already on disk, `null` for a kind never published
 * @param sdkVersion the installed `@slack/web-api` version the API channel was read from
 * @param at this run's ISO timestamp
 * @returns the generation, or every reason it cannot be assembled
 */
export function assembleSlackGeneration({
  methods,
  session,
  screenshots,
  roots,
  stored,
  sdkVersion,
  at,
}: {
  methods: readonly SdkMethod[];
  session: DrivenSession;
  screenshots: ReadonlyMap<string, SlackArtifactRef>;
  roots: SlackSurfaceRoots;
  stored: Readonly<Record<SlackAtlasKind, SlackAtlasKindFile | null>>;
  sdkVersion: string;
  at: string;
}): Result<SlackAtlasGeneration> {
  const walked = withScreenshots({ screenshots, session });
  const merged = mergeSurfaces({ at, methods, roots, session, stored, walked });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const comparisons = compareSurfaces({ entities: merged.value.methods });
  const methodGaps = reconcileMethodGaps({ at, comparisons, stored: stored.method?.gaps ?? [] });
  if (methodGaps.isErr()) {
    return err(methodGaps.error);
  }
  const pageGaps = reconcilePageGaps({ at, session, stored: stored.page?.gaps ?? [], walked });
  if (pageGaps.isErr()) {
    return err(pageGaps.error);
  }
  return ok({
    comparisons,
    files: kindFiles({
      at,
      gaps: { method: methodGaps.value, page: pageGaps.value },
      merged: merged.value,
      methodCount: methods.length,
      sdkVersion,
      walked,
    }),
    manifest: {
      kinds: { method: syncedStatus({ at }), page: syncedStatus({ at }) },
      platform: SLACK_ATLAS_PLATFORM,
      schemaVersion: SLACK_ATLAS_SCHEMA_VERSION,
      sdkVersion,
      updatedAt: at,
    },
    summary: summariseDisagreements({ comparisons }),
  });
}
