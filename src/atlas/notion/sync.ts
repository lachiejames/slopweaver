/**
 * Publish the API surface: every endpoint the installed `@notionhq/client` declares, onto the `method`
 * kind's `api` channel.
 *
 * ## It publishes ONE kind and ONE channel, which is what keeps the walk safe
 *
 * This writes `method` and omits `page`, and inside `method` it merges only the `api` channel
 * (`merge.ts`). The kit's `publishAtlas` leaves an omitted kind's file untouched, so a sync that runs while
 * a walk is stale cannot blank what the walk saw — and since the disjointness between the two surfaces is
 * this atlas's central finding, that is a mechanism rather than a nicety.
 *
 * ## The denominator is what the package declares, not what a token may call
 *
 * A synced cell here says the SDK's declared endpoint set was read in full. It says nothing about whether
 * this integration is authorised for any of them, which is a property of its page grants and of no file in
 * the package. `descriptor.ts` states that ceiling; a coverage cell must not imply a wider one.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { succeededNotionCoverageCell } from "./coverage.js";
import { mergeNotionChannel } from "./merge.js";
import {
  emptyNotionKindFile,
  initialNotionManifest,
  type NotionAtlasEntity,
  type NotionAtlasKind,
  type NotionAtlasKindFile,
  type NotionAtlasManifest,
} from "./model.js";
import { projectNotionApiMethods } from "./projection.js";
import { NOTION_SDK_PACKAGE, type NotionSdkSurface, readNotionSdkSurface } from "./sdkRead.js";
import { type NotionAtlasPaths, publishNotionAtlas, readNotionAtlas, withNotionPublishLock } from "./store.js";

/**
 * The surface name the API channel's coverage is reported under.
 *
 * @internal
 */
export const NOTION_SDK_SURFACE = "sdk-declared";

/**
 * The surface name under which this atlas says who DOES hold Notion's workspace content.
 *
 * @internal
 */
export const NOTION_CONTENT_SURFACE = "workspace-content";

/**
 * What publishing the API surface did.
 *
 * @internal
 */
export interface NotionSyncOutcome {
  readonly sdkVersion: string;
  readonly moduleCount: number;
  /** How many endpoint constants the package DECLARES. */
  readonly endpointCount: number;
  /**
   * How many `method` entities were published — one per distinct method-and-path ROUTE, which is fewer than
   * `endpointCount` whenever the SDK ships several handles for one route (see `projection.ts`'s
   * `endpointsByRoute`). Reported separately rather than folded into one number, because a summary saying
   * "76 endpoints" while the file holds 75 entities is the kind of small lie a reader cannot reconcile.
   */
  readonly routeCount: number;
  readonly written: readonly string[];
}

/**
 * Read the installed SDK and publish its declared endpoints onto the `method` kind's `api` channel.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function syncNotionApiSurface({
  paths,
  at,
}: {
  paths: NotionAtlasPaths;
  at: string;
}): Result<NotionSyncOutcome> {
  const surface = readNotionSdkSurface();
  if (surface.isErr()) {
    return err(surface.error);
  }
  // The read and the write are one critical section: another publisher landing between them would have its
  // rows replaced by files derived from the generation this one read. See `withNotionPublishLock`.
  return withNotionPublishLock({
    nowIso: at,
    paths,
    publish: () => publishDeclaredSurface({ at, paths, surface: surface.value }),
  });
}

/** The kind file the store held, or an empty one stamped `at` when it held none. */
function heldKindFile({
  kind,
  stored,
  at,
}: {
  kind: NotionAtlasKind;
  stored: NotionAtlasKindFile | null | undefined;
  at: string;
}): NotionAtlasKindFile {
  if (stored == null) {
    return emptyNotionKindFile({ kind, updatedAt: at });
  }
  return stored;
}

/** The critical section: read the generation, merge the API channel onto it, and publish. */
function publishDeclaredSurface({
  paths,
  at,
  surface,
}: {
  paths: NotionAtlasPaths;
  at: string;
  surface: NotionSdkSurface;
}): Result<NotionSyncOutcome> {
  const snapshot = readNotionAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const stored = heldKindFile({ at, kind: "method", stored: snapshot.value.files.method });
  const merged = mergeNotionChannel({
    at,
    channel: "api",
    observed: projectNotionApiMethods({ at, surface }),
    stored: stored.entities,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const file = declaredMethodFile({ at, entities: merged.value, stored, surface });
  const storedPages = heldKindFile({ at, kind: "page", stored: snapshot.value.files.page });
  const published = publishNotionAtlas({
    derivedFrom: snapshot.value.manifest,
    files: { method: file, page: contentCoverageOnto({ at, stored: storedPages }) },
    manifest: syncManifest({ at, count: file.entities.length, manifest: snapshot.value.manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    endpointCount: surface.endpoints.length,
    moduleCount: surface.modules.length,
    routeCount: file.entities.length,
    sdkVersion: surface.version,
    written: published.value,
  });
}

/**
 * The method kind with the API channel's own coverage cell replaced and nothing else touched.
 *
 * @param stored the method kind as the store already holds it
 * @param entities this run's merged entities
 * @param surface what the installed client declares
 * @param at this run's ISO timestamp
 * @returns the file to publish
 */
function declaredMethodFile({
  stored,
  entities,
  surface,
  at,
}: {
  stored: NotionAtlasKindFile;
  entities: readonly NotionAtlasEntity[];
  surface: NotionSdkSurface;
  at: string;
}): NotionAtlasKindFile {
  const reason =
    `${String(surface.endpoints.length)} endpoint(s) across ` +
    `${String(surface.modules.length)} generated module(s) in ${NOTION_SDK_PACKAGE} ${surface.version}`;
  return {
    ...stored,
    coverage: [
      ...stored.coverage.filter((cell) => cell.surface !== NOTION_SDK_SURFACE),
      succeededNotionCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason,
        role: "authoritative",
        scope: "declared-endpoints",
        state: "synced",
        surface: NOTION_SDK_SURFACE,
      }),
    ],
    entities: [...entities],
    updatedAt: at,
  };
}

/** The manifest the store held, or a fresh one stamped `at` when it held none. */
function heldManifest({ manifest, at }: { manifest: NotionAtlasManifest | null; at: string }): NotionAtlasManifest {
  if (manifest == null) {
    return initialNotionManifest({ updatedAt: at });
  }
  return manifest;
}

/** Stamp the `method` kind's status, leaving `page`'s exactly as the walk left it. */
function syncManifest({
  manifest,
  count,
  at,
}: {
  manifest: NotionAtlasManifest | null;
  count: number;
  at: string;
}): NotionAtlasManifest {
  const base = heldManifest({ at, manifest });
  return {
    ...base,
    kinds: {
      ...base.kinds,
      method: { digest: null, entityCount: count, lastAttempt: { at, outcome: "ok", reasons: [] }, lastSuccessAt: at },
    },
    updatedAt: at,
  };
}

/**
 * Add the cell that says who DOES hold Notion's workspace content, preserving everything else on the page
 * kind — its entities, its gaps and the walk's own coverage.
 *
 * ## Why this is a `held-elsewhere` cell rather than a line in `excludes`
 *
 * The descriptor's `excludes` already says this atlas holds no content page. What it cannot say is that the
 * content IS held — and the two claims are different: an exclusion invites a reader to treat the data as
 * unavailable, where the truth is that a named store has all of it. `kit/contract.ts` added the state for
 * exactly this case (the owner's rule) and requires the holder to be NAMED in the reason, because
 * a state that cannot say where is an unfalsifiable claim.
 *
 * The role is `discovery`, and deliberately not `authoritative`: this atlas can tell a reader that the
 * content exists and who has it, and nothing whatever about the content. `held-elsewhere` is not usable
 * coverage either way, so no sync exits 0 on the strength of one.
 *
 * @param stored the page kind as the store already holds it
 * @param at this run's ISO timestamp
 * @returns the page kind file with the content cell replaced
 */
function contentCoverageOnto({ stored, at }: { stored: NotionAtlasKindFile; at: string }): NotionAtlasKindFile {
  return {
    // The page file keeps the WALK's own clock: this sync rewrites one coverage cell and reaches no page, and
    // `manifestClockDefects` compares the file's clock with the status's `lastSuccessAt`, which stays the walk's.
    // Stamping `at` here refuses every sync with "page carries two clocks".
    ...stored,
    coverage: [
      ...stored.coverage.filter((cell) => cell.surface !== NOTION_CONTENT_SURFACE),
      succeededNotionCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason:
          "Notion's pages, databases and data-source rows are held in full by the corpus, not by this " +
          "atlas — `slopweaver refresh --source notion` writes them and `src/corpus/notion/reach.ts` " +
          "enumerates every id the integration can currently see on each run. Read them with " +
          "`slopweaver store read` or `slopweaver store cite`, never from here",
        role: "discovery",
        scope: "pages-databases-and-rows",
        state: "held-elsewhere",
        surface: NOTION_CONTENT_SURFACE,
      }),
    ],
    updatedAt: stored.updatedAt,
  };
}
