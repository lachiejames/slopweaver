/**
 * One run of the Linear atlas: read what is on disk, fill whichever surfaces can be filled, merge, and
 * publish a whole generation — or publish nothing.
 *
 * ## Accumulate, never replace
 *
 * The merge is `kit/merge.ts`'s, and the fold seam is where this atlas's own ruling lives: a fresh reading
 * replaces only ITS OWN channel's slot on an entity, so an API-only run leaves every browser observation
 * exactly as the last walk left it. That is the owner's "one surface succeeding must never erase what the
 * other already knew", made structural rather than remembered.
 *
 * ## A surface that did not run stales nothing
 *
 * `mergeKind` marks a stored entity stale when a fresh run did not see it — which is right only after a
 * COMPLETE read of the thing that would have seen it. So the stale pass runs per channel and only when that
 * channel actually completed: an absent browser walk leaves every page exactly where it was, because a page
 * that was not looked for has not disappeared.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { absentAsEmpty } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { writeAtomicBytes } from "../atlasFile.js";
import { reconcileGaps } from "../kit/gaps.js";
import { mergeKind } from "../kit/merge.js";
import type { LinearApiSurfaceReading } from "./apiSurface.js";
import { LinearAtlasErrors, linearAtlasErrorLines } from "./errors.js";
import {
  emptyLinearAtlasKindFile,
  initialLinearAtlasManifest,
  LINEAR_ATLAS_KINDS,
  type LinearAtlasEntity,
  type LinearAtlasKind,
  type LinearAtlasKindFile,
  type LinearAtlasManifest,
  type LinearChannelEntity,
  type LinearCoverageCell,
} from "./model.js";
import { projectLinearAtlas } from "./projection.js";
import type { LinearBrowserReading, LinearProjection } from "./projectionKit.js";
import { sensitivityHits } from "./sensitivity.js";
import { type LinearAtlasPaths, type LinearAtlasSnapshot, publishLinearAtlas, readLinearAtlas } from "./store.js";

/**
 * What one sync run came to, for a verb to render.
 * @internal
 */
export interface LinearSyncSummary {
  readonly entityCounts: Readonly<Record<LinearAtlasKind, number>>;
  readonly openGapCounts: Readonly<Record<LinearAtlasKind, number>>;
  readonly written: readonly string[];
  /** Which surfaces actually contributed a reading this run. */
  readonly surfacesRead: readonly string[];
}

/** Fold a fresh observation onto its stored predecessor, one CHANNEL at a time. */
function foldEntity({
  stored,
  observed,
  at,
}: {
  stored: LinearAtlasEntity | undefined;
  observed: LinearAtlasEntity;
  at: string;
}): Result<LinearAtlasEntity> {
  if (stored === undefined) {
    return ok(observed);
  }
  return ok({
    ...stored,
    channels: {
      api: foldLinearChannel({ at, fresh: observed.channels.api, previous: stored.channels.api }),
      browser: foldLinearChannel({ at, fresh: observed.channels.browser, previous: stored.channels.browser }),
    },
  });
}

/**
 * One channel's slot after this run: a slot is null exactly when that channel has not observed the entity.
 *
 * @param previous the slot the stored generation holds for this channel
 * @param fresh the slot this run's reading produced for this channel
 * @param at this run's ISO timestamp, stamped as `lastSeenAt` on a channel that saw the entity
 * @returns the folded slot, carrying the first sighting forward
 * @internal
 */
export function foldLinearChannel({
  previous,
  fresh,
  at,
}: {
  previous: LinearChannelEntity | null;
  fresh: LinearChannelEntity | null;
  at: string;
}): LinearChannelEntity | null {
  if (fresh === null) {
    // This channel did not see the entity this run, so its stored slot stands exactly as it was.
    return previous;
  }
  if (previous === null) {
    // The first sighting on this channel: it was first seen now.
    return { ...fresh, lastSeenAt: at };
  }
  return { ...fresh, firstSeenAt: previous.firstSeenAt, lastSeenAt: at };
}

/** Mark the channels of an entity this run did not see stale — but only the channels that actually looked. */
function staleEntity({
  stored,
  completedChannels,
}: {
  stored: LinearAtlasEntity;
  completedChannels: ReadonlySet<"api" | "browser">;
}): LinearAtlasEntity | null {
  const api = stored.channels.api;
  const browser = stored.channels.browser;
  const staleApi = api !== null && completedChannels.has("api") && api.state === "observed";
  const staleBrowser = browser !== null && completedChannels.has("browser") && browser.state === "observed";
  if (!staleApi && !staleBrowser) {
    return null;
  }
  return {
    ...stored,
    channels: {
      api: api !== null && staleApi ? { ...api, state: "stale" } : api,
      browser: browser !== null && staleBrowser ? { ...browser, state: "stale" } : browser,
    },
  };
}

/** The coverage the stored generation holds, so a failed look keeps its prior success. */
function storedCoverage({
  files,
}: {
  files: Readonly<Record<LinearAtlasKind, LinearAtlasKindFile | null>>;
}): Record<LinearAtlasKind, readonly LinearCoverageCell[]> {
  return {
    operation: absentAsEmpty({ value: files.operation?.coverage }),
    page: absentAsEmpty({ value: files.page?.coverage }),
    setting: absentAsEmpty({ value: files.setting?.coverage }),
    type: absentAsEmpty({ value: files.type?.coverage }),
  };
}

/**
 * Write one screenshot into the generation's own artifact directory.
 *
 * @param directory the atlas's own directory, which every `relativePath` is relative to
 * @returns a writer the walk can call once per page
 */
export function artifactWriterFor({
  directory,
}: {
  directory: string;
}): (input: { relativePath: string; bytes: Uint8Array }) => Result<null> {
  return ({ relativePath, bytes }) => {
    const path = join(directory, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    return writeAtomicBytes({ bytes, path });
  };
}

/**
 * Run one sync: merge both channels' readings into the stored generation and publish it.
 *
 * @param paths the resolved atlas paths
 * @param api what the API channel read, or `null` when it was not run
 * @param browser what the browser channel read, including the reason it read nothing
 * @param plannedCount how many settings pages were planned, so partial coverage is a fraction
 * @param workspaceUrlBase the workspace's own settings root, for a `setting`'s deep link
 * @param at this run's ISO timestamp
 * @returns what the run came to, or every reason nothing was published
 */
export function syncLinearAtlas({
  paths,
  api,
  browser,
  plannedCount,
  workspaceUrlBase,
  at,
}: {
  paths: LinearAtlasPaths;
  api: LinearApiSurfaceReading | null;
  browser: LinearBrowserReading;
  plannedCount: number;
  workspaceUrlBase: string | null;
  at: string;
}): Result<LinearSyncSummary> {
  if (api === null && browser.unavailableBecause !== null) {
    return err(
      linearAtlasErrorLines({ error: LinearAtlasErrors.nothingRead({ because: browser.unavailableBecause }) }),
    );
  }
  const snapshot = readLinearAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const previousCoverage = storedCoverage({ files: snapshot.value.files });
  const projected = projectLinearAtlas({ api, at, browser, plannedCount, previousCoverage, workspaceUrlBase });

  const completedChannels = completedChannelsOf({ api, browser });
  const merged = mergeEveryKind({ at, completedChannels, projected, snapshot: snapshot.value });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const { entityCounts, files, openGapCounts } = merged.value;

  const refusal = refuseOnSensitivity({ files });
  if (refusal.isErr()) {
    return err(refusal.error);
  }

  const prior = snapshot.value.manifest;
  const manifest = manifestFor({ api, at, entityCounts, prior });
  const published = publishLinearAtlas({ derivedFrom: prior, files, manifest, paths });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    entityCounts,
    openGapCounts,
    surfacesRead: [...completedChannels].toSorted(),
    written: published.value,
  });
}

/**
 * Merge this run's projection into the stored generation, one kind at a time.
 *
 * Split from {@link syncLinearAtlas} because it is the half that must never be read casually: `mergeKind`
 * stales what a run did not see, and `completedChannels` is what decides which channel is allowed to do
 * that. Everything above this is orchestration; this is the accumulate-never-replace rule itself.
 *
 * @param at this run's ISO timestamp
 * @param completedChannels which channels genuinely completed, so only they may stale an absent entity
 * @param projected what this run's two channels produced
 * @param snapshot the generation on disk
 * @returns the merged files and their counts, or the reason the merge was refused
 */
function mergeEveryKind({
  at,
  completedChannels,
  projected,
  snapshot,
}: {
  at: string;
  completedChannels: ReadonlySet<"api" | "browser">;
  projected: LinearProjection;
  snapshot: LinearAtlasSnapshot;
}): Result<{
  files: Partial<Record<LinearAtlasKind, LinearAtlasKindFile>>;
  entityCounts: Record<LinearAtlasKind, number>;
  openGapCounts: Record<LinearAtlasKind, number>;
}> {
  const files: Partial<Record<LinearAtlasKind, LinearAtlasKindFile>> = {};
  const entityCounts: Record<LinearAtlasKind, number> = { operation: 0, page: 0, setting: 0, type: 0 };
  const openGapCounts: Record<LinearAtlasKind, number> = { operation: 0, page: 0, setting: 0, type: 0 };
  for (const kind of LINEAR_ATLAS_KINDS) {
    const stored = snapshot.files[kind];
    const merged = mergeKind<LinearAtlasEntity>({
      at,
      foldEntity,
      observed: projected.entities[kind],
      staleEntity: ({ stored: entity }) => staleEntity({ completedChannels, stored: entity }),
      stored: absentAsEmpty({ value: stored?.entities }),
    });
    if (merged.isErr()) {
      return err(merged.error);
    }
    const gaps = reconcileGaps({
      at,
      observed: projected.gaps[kind],
      rechecks: projected.rechecks,
      runFailed: false,
      stored: absentAsEmpty({ value: stored?.gaps }),
    });
    if (gaps.isErr()) {
      return err(gaps.error);
    }
    files[kind] = {
      ...emptyLinearAtlasKindFile({ kind, updatedAt: at }),
      coverage: [...projected.coverage[kind]],
      entities: [...merged.value],
      gaps: [...gaps.value],
    };
    entityCounts[kind] = merged.value.length;
    openGapCounts[kind] = gaps.value.filter((held) => held.status === "open").length;
  }
  return ok({ entityCounts, files, openGapCounts });
}

/**
 * The manifest this generation publishes: every kind stamped with this run's success, and the workspace
 * this reading belongs to.
 *
 * The workspace falls back to the stored one when this run could not establish it, so an API-less run does
 * not blank the field the publish guard reads.
 *
 * @param api what the API channel read, or `null` when it did not run
 * @param at this run's ISO timestamp
 * @param entityCounts how many entities each kind now holds
 * @param prior the manifest currently on disk
 * @returns the manifest to publish
 */
function manifestFor({
  api,
  at,
  entityCounts,
  prior,
}: {
  api: LinearApiSurfaceReading | null;
  at: string;
  entityCounts: Record<LinearAtlasKind, number>;
  prior: LinearAtlasManifest | null;
}): LinearAtlasManifest {
  return {
    ...initialLinearAtlasManifest({ updatedAt: at, workspaceId: publishedWorkspaceId({ api, prior }) }),
    kinds: {
      ...initialLinearAtlasManifest({ updatedAt: at }).kinds,
      ...Object.fromEntries(
        LINEAR_ATLAS_KINDS.map((kind) => [
          kind,
          {
            digest: null,
            entityCount: entityCounts[kind],
            lastAttempt: { at, outcome: "ok" as const, reasons: [] },
            lastSuccessAt: at,
          },
        ]),
      ),
    },
  };
}

/**
 * The workspace this generation records: this run's when it established one, else the stored one, else none.
 *
 * An API-less run cannot establish the workspace, and keeping the stored one is what stops it blanking the
 * field the publish guard reads; a first publish with no API reading genuinely has no workspace to record.
 *
 * @param api what the API channel read, or `null` when it did not run
 * @param prior the manifest currently on disk, or `null` when nothing has been published
 * @returns the workspace id to publish, or `null` when neither this run nor the store knows it
 * @internal
 */
export function publishedWorkspaceId({
  api,
  prior,
}: {
  api: Pick<LinearApiSurfaceReading, "workspaceId"> | null;
  prior: LinearAtlasManifest | null;
}): string | null {
  if (api !== null && api.workspaceId !== null) {
    return api.workspaceId;
  }
  if (prior === null) {
    return null;
  }
  return prior.workspaceId;
}

/**
 * Refuse the whole generation when it carries a value this atlas may never hold.
 *
 * A refusal rather than a redaction, and its own function so that is visible: a redacting gate leaves a
 * generation silently different from what was read, which is the exact class of failure the data-integrity
 * ruling is about.
 *
 * @param files the kind files about to be written
 * @returns nothing when the generation may be published, or every reason it may not
 */
function refuseOnSensitivity({
  files,
}: {
  files: Partial<Record<LinearAtlasKind, LinearAtlasKindFile>>;
}): Result<null> {
  const hits = sensitivityHits({ generation: files });
  if (hits.length === 0) {
    return ok(null);
  }
  return err(linearAtlasErrorLines({ error: LinearAtlasErrors.sensitiveValuesHeld({ hits }) }));
}

/**
 * Which channels completed this run, and may therefore stale an entity they did not see.
 *
 * The browser's answer is the one that matters and it is the strict reading: a walk counts as complete only
 * when it ATTEMPTED every planned page. `kit/merge.ts` says the stale pass is safe only after a complete
 * read, and measured, a walk's relay dropped partway through its plan — staling on that would
 * have marked every real settings page past the drop as gone from Linear.
 *
 * @param api what the API channel read, or `null` when it did not run
 * @param browser what the browser channel read
 * @returns the channels whose absence-means-stale rule may be applied
 */
function completedChannelsOf({
  api,
  browser,
}: {
  api: LinearApiSurfaceReading | null;
  browser: LinearBrowserReading;
}): ReadonlySet<"api" | "browser"> {
  const completedChannels = new Set<"api" | "browser">();
  if (api !== null) {
    completedChannels.add("api");
  }
  // A walk that ATTEMPTED every planned page may stale what it did not see; one that stopped partway may
  // NOT. `kit/merge.ts` says the stale pass is only safe after a complete read, and a walk whose relay
  // dropped partway has not looked at the pages after the drop — measured, exactly that happened on the
  // first full run. Staling on it would have marked every one of those real settings pages as gone.
  const attemptedEveryPage = browser.pages.every((page) => page.outcome !== "not-attempted");
  if (browser.unavailableBecause === null && !browser.limited && attemptedEveryPage) {
    completedChannels.add("browser");
  }
  return completedChannels;
}
