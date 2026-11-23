/**
 * Publishing what a dashboard walk saw: the `page` kind's BROWSER channel, and the whole
 * `graphql-operation` kind.
 *
 * ## Two writers, disjoint by channel, and the guard that keeps them so
 *
 * `sync.ts` publishes `page`'s COMPILED channel from the application's own route table and never touches
 * `graphql-operation`'s entities; this publishes `page`'s browser channel and the GraphQL rows, and never
 * touches the compiled half. `mergeInngestChannel` is what keeps each writer out of the other's half, and `publishAtlas`'s
 * compare-and-swap against the manifest a candidate was derived from is what stops one of them discarding
 * the other's whole file — under the mutation lock, inside the publish, where no caller can skip it.
 *
 * ## Screenshots are graded against the BYTES on disk
 *
 * `verifyArtifactsOnDisk` re-reads every artifact a walk claims to have written and drops the ones that are
 * not there. Grading against the references handed in would let a failed write publish as a photographed
 * page, which is the failure the owner found by opening the artifacts on disk.
 */

import { absentAs } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { isPageHeld } from "../kit/pageWalk.js";
import { assembleWalkKind, stampedKindStatus, verifyArtifactsOnDisk, walkTally } from "../kit/walkPublish.js";
import type { InngestBrowserPage } from "./browserPages.js";
import type { InngestBrowserWalkResult, InngestPageObservation } from "./browserWalk.js";
import { failedInngestCoverageCell, succeededInngestCoverageCell } from "./coverage.js";
import { INNGEST_DASHBOARD_SURFACE, INNGEST_GRAPHQL_SURFACE } from "./descriptor.js";
import { type InngestGapRecheck, openInngestGap, reconcileInngestGaps } from "./gaps.js";
import { mergeInngestChannel } from "./merge.js";
import {
  emptyInngestKindFile,
  INNGEST_GRAPHQL_OPERATION_KIND,
  INNGEST_PAGE_KIND,
  type InngestAtlasEntity,
  type InngestAtlasGap,
  type InngestAtlasKindFile,
  type InngestAtlasManifest,
  type InngestCoverageCell,
  type InngestKind,
  initialInngestManifest,
} from "./model.js";
import { projectInngestGraphqlOperations, projectInngestWalkedPage } from "./projection.js";
import { type InngestAtlasPaths, inngestAtlasPaths, publishInngestAtlas, readInngestAtlas } from "./store.js";

/** What publishing a walk did. */
export interface InngestBrowserSurfaceOutcome {
  readonly declaredCount: number;
  readonly graphqlOperationCount: number;
  readonly openGaps: number;
  readonly photographedCount: number;
  readonly reachedCount: number;
  readonly written: readonly string[];
}

/** The section the compiled channel recorded for one route, so a browser row can carry it too. */
function sectionsOf({ pages }: { pages: readonly InngestBrowserPage[] }): ReadonlyMap<string, string> {
  return new Map(pages.map((page) => [page.surface, page.section]));
}

/** The coverage cell this walk earned for the page surface. */
function pageCoverageCell({ walk, at }: { walk: InngestBrowserWalkResult; at: string }): InngestCoverageCell {
  const tally = walkTally({ pages: walk.pages });
  if (walk.sessionLost) {
    return failedInngestCoverageCell({
      channel: "browser",
      previous: null,
      reason:
        `the walk stopped after the dashboard sent this browser to its sign-in page; ` +
        `${String(tally.reached)} of ${String(walk.pages.length)} declared route(s) were reached first`,
      role: "authoritative",
      scope: "app.inngest.com, signed in",
      state: "unreadable",
      surface: INNGEST_DASHBOARD_SURFACE,
      unblockedBy: "sign in to Inngest in your own Chrome and run: slopweaver atlas inngest walk",
    });
  }
  return succeededInngestCoverageCell({
    artifacts: [],
    at,
    channel: "browser",
    reason:
      `${String(tally.reached)} of ${String(walk.pages.length)} declared route(s) reached, ` +
      `${String(tally.photographed)} photographed`,
    role: "authoritative",
    scope: "app.inngest.com, signed in",
    state: "synced",
    surface: INNGEST_DASHBOARD_SURFACE,
  });
}

/**
 * The `(condition, scope)` pairs this walk genuinely rechecked, and what each recheck found.
 *
 * A gap closes only when its own pair is rechecked, so a condition absent from this list stays open for
 * ever, however many clean walks follow it. `dashboard-screenshot-missing` must be listed here, because
 * leaving it out costs exactly that: after the capture defect was fixed and a walk photographed every page this
 * atlas's policy permits, the generation still carried an open screenshot gap for each one the earlier
 * failing runs had opened. A reader would have concluded nothing was fixed. The sibling Jam walk had it
 * right already — `atlas/jam/browserPageKind.ts`'s `walkRechecks`.
 *
 * `isPageHeld` rather than "has a picture", because a page whose photograph this atlas RULED it may not
 * hold is legitimately and permanently gapped, and closing that would be a lie in the other direction.
 *
 * @param pages every declared page's observation from this walk
 * @returns one recheck per page per condition this walk actually settled
 *
 * @internal exported for the test that proves a healed screenshot gap CLOSES — the publish path needs a
 * generation on disk, and what is wrong when this regresses is this list, not the write.
 */
export function pageRechecks({ pages }: { pages: readonly InngestPageObservation[] }): readonly InngestGapRecheck[] {
  return pages.flatMap((page) => [
    {
      condition: "dashboard-route-unprobeable" as const,
      resolved: page.attempted && page.unreachableBecause === null,
      scope: page.surface,
    },
    { condition: "dashboard-screenshot-missing" as const, resolved: isPageHeld({ page }), scope: page.surface },
  ]);
}

/** Every gap this walk's page observations produced. */
function pageGaps({ walk, at }: { walk: InngestBrowserWalkResult; at: string }): readonly InngestAtlasGap[] {
  const gaps: InngestAtlasGap[] = [];
  for (const page of walk.pages) {
    if (!page.attempted) {
      gaps.push(
        openInngestGap({
          at,
          condition: "dashboard-page-not-attempted",
          fields: [],
          kind: INNGEST_PAGE_KIND,
          reason: `${page.surface} was never asked for: the walk stopped before reaching it`,
          scope: page.surface,
          surfaces: ["browser"],
        }),
      );
      continue;
    }
    if (page.unreachableBecause !== null) {
      gaps.push(
        openInngestGap({
          at,
          condition: "dashboard-page-unreachable",
          fields: [],
          kind: INNGEST_PAGE_KIND,
          reason: `${page.surface}: ${page.unreachableBecause}`,
          scope: page.surface,
          surfaces: ["browser"],
        }),
      );
      continue;
    }
    if (page.screenshotMissingBecause !== null) {
      gaps.push(
        openInngestGap({
          at,
          condition: "dashboard-screenshot-missing",
          fields: [],
          kind: INNGEST_PAGE_KIND,
          reason: `${page.surface} was reached and has no proof screenshot: ${page.screenshotMissingBecause}`,
          scope: page.surface,
          surfaces: ["browser"],
        }),
      );
    }
  }
  return gaps;
}

/**
 * Merge this walk's page observations and gaps onto the stored `page` kind.
 *
 * @param walk what the walk saw, already graded against the bytes on disk
 * @param stored the kind file as the generation holds it
 * @param sections the compiled channel's section for each declared route
 * @param at this run's ISO timestamp
 * @returns the fields to spread onto the stored file, or the first reason it cannot be assembled
 */
function mergedPageFields({
  walk,
  stored,
  sections,
  at,
}: {
  walk: InngestBrowserWalkResult;
  stored: InngestAtlasKindFile;
  sections: ReadonlyMap<string, string>;
  at: string;
}): ReturnType<typeof assembleWalkKind<InngestCoverageCell, InngestAtlasEntity, InngestAtlasGap>> {
  const observed = walk.pages.map((page) =>
    projectInngestWalkedPage({
      at,
      page,
      section: absentAs({ value: sections.get(page.surface), whenAbsent: "root" }),
    }),
  );
  return assembleWalkKind({
    at,
    cell: pageCoverageCell({ at, walk }),
    merge: () => mergeInngestChannel({ at, channel: "browser", observed, stored: stored.entities }),
    reconcile: () =>
      reconcileInngestGaps({
        at,
        observed: pageGaps({ at, walk }),
        rechecks: pageRechecks({ pages: walk.pages }),
        runFailed: walk.sessionLost,
        stored: stored.gaps,
      }),
    stored,
    surface: INNGEST_DASHBOARD_SURFACE,
  });
}

/**
 * Merge this walk's GraphQL observations onto the stored `graphql-operation` kind.
 *
 * @param walk what the walk saw
 * @param stored the kind file as the generation holds it
 * @param at this run's ISO timestamp
 * @returns the fields to spread onto the stored file, and how many operations were observed
 */
function mergedGraphqlFields({
  walk,
  stored,
  at,
}: {
  walk: InngestBrowserWalkResult;
  stored: InngestAtlasKindFile;
  at: string;
}): {
  fields: ReturnType<typeof assembleWalkKind<InngestCoverageCell, InngestAtlasEntity, InngestAtlasGap>>;
  count: number;
} {
  const observed = projectInngestGraphqlOperations({ at, pages: walk.pages });
  return {
    count: observed.length,
    fields: assembleWalkKind({
      at,
      cell: succeededInngestCoverageCell({
        artifacts: [],
        at,
        channel: "browser",
        reason:
          `${String(observed.length)} GraphQL operation(s) observed being sent by the dashboard's own ` +
          "client. Introspection is disabled on this endpoint, so this is a FLOOR rather than a census",
        role: "discovery",
        scope: "api.inngest.com/gql",
        state: "synced",
        surface: INNGEST_GRAPHQL_SURFACE,
      }),
      merge: () => mergeInngestChannel({ at, channel: "browser", observed, stored: stored.entities }),
      reconcile: () => ok(stored.gaps),
      stored,
      surface: INNGEST_GRAPHQL_SURFACE,
    }),
  };
}

/**
 * The manifest a walk publishes, stamping the two kinds it wrote and leaving the other nine alone.
 *
 * @param manifest the manifest the generation holds, or `null` when nothing has been published
 * @param pageFile the page kind's next file
 * @param graphqlFile the GraphQL kind's next file
 * @param at this run's ISO timestamp
 * @returns the manifest to publish
 */
function walkManifest({
  manifest,
  pageFile,
  graphqlFile,
  at,
}: {
  manifest: InngestAtlasManifest | null;
  pageFile: InngestAtlasKindFile;
  graphqlFile: InngestAtlasKindFile;
  at: string;
}): InngestAtlasManifest {
  const base = manifest ?? initialInngestManifest({ updatedAt: at });
  return {
    ...base,
    kinds: {
      ...base.kinds,
      "graphql-operation": stampedKindStatus({ at, count: graphqlFile.entities.length }),
      page: stampedKindStatus({ at, count: pageFile.entities.length }),
    },
    updatedAt: at,
  };
}

/**
 * Publish a walk's browser channel over the generation the sync published.
 *
 * @param walk what the walk saw
 * @param pages the declared pages the walk was given, so a browser row can carry its section
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishInngestBrowserWalk({
  walk: raw,
  pages,
  home,
  at,
}: {
  walk: InngestBrowserWalkResult;
  pages: readonly InngestBrowserPage[];
  home: string;
  at: string;
}): Result<InngestBrowserSurfaceOutcome> {
  const paths: InngestAtlasPaths = inngestAtlasPaths({ home });
  // Grade against the bytes on disk, never against the references the walk supplied.
  const walk: InngestBrowserWalkResult = {
    ...raw,
    pages: verifyArtifactsOnDisk({ directory: paths.directory, pages: raw.pages }),
  };
  const snapshot = readInngestAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const storedFor = ({ kind }: { kind: InngestKind }): InngestAtlasKindFile =>
    snapshot.value.files[kind] ?? emptyInngestKindFile({ kind, updatedAt: at });
  const storedPages = storedFor({ kind: INNGEST_PAGE_KIND });
  const storedGraphql = storedFor({ kind: INNGEST_GRAPHQL_OPERATION_KIND });
  const pageFields = mergedPageFields({ at, sections: sectionsOf({ pages }), stored: storedPages, walk });
  if (pageFields.isErr()) {
    return err(pageFields.error);
  }
  const graphql = mergedGraphqlFields({ at, stored: storedGraphql, walk });
  if (graphql.fields.isErr()) {
    return err(graphql.fields.error);
  }
  const pageFile: InngestAtlasKindFile = { ...storedPages, ...pageFields.value };
  const graphqlFile: InngestAtlasKindFile = { ...storedGraphql, ...graphql.fields.value };
  const published = publishInngestAtlas({
    derivedFrom: snapshot.value.manifest,
    files: { "graphql-operation": graphqlFile, page: pageFile },
    manifest: walkManifest({ at, graphqlFile, manifest: snapshot.value.manifest, pageFile }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  const tally = walkTally({ pages: walk.pages });
  return ok({
    declaredCount: pages.length,
    graphqlOperationCount: graphql.count,
    openGaps: pageFile.gaps.filter((gap) => gap.status === "open").length,
    photographedCount: tally.photographed,
    reachedCount: tally.reached,
    written: published.value,
  });
}
