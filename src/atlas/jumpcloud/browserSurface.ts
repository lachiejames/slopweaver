/**
 * Publish what a console walk saw into the console generation's `page` and `method` kinds.
 *
 * ## The sync cannot truncate the walk, nor the walk the sync, by construction
 *
 * The console generation is its own manifest and its own two files under `atlas/jumpcloud/console/`
 * (`consoleModel.ts`). `sync.ts` never opens them and this never opens the API generation's, so a walk that
 * runs beside a sync touches disjoint files — no lock, and no omitted-kind convention to keep.
 *
 * ## Coverage is graded against the DECLARED denominator, and photographing counts
 *
 * `page`'s coverage cell says how many declared pages the walk landed on AND photographed. A run that reached
 * only some of the declared pages is `deferred` with the fraction in its reason, never `synced` because it
 * wrote some rows — the Slack atlas's "reported N, reached M" is the failure this refuses to repeat.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { reconcileGaps } from "../kit/gaps.js";
import { withKindStatus } from "../kit/manifestClock.js";
import { mergeKind } from "../kit/merge.js";
import {
  assembleWalkKind,
  type PageWalkPublished,
  publishPageWalk,
  refuseUndeclaredWalk,
  stampedWalkKinds,
} from "../kit/walkPublish.js";

import { methodCoverageCell, pageCoverageCell } from "./browserCoverage.js";
import { consolePageGaps, consoleRechecks, openJumpcloudConsoleGap, standingConsoleGaps } from "./browserGaps.js";
import { JUMPCLOUD_CONSOLE_PAGES } from "./browserPages.js";
import {
  JUMPCLOUD_CONSOLE_CHANNEL as CHANNEL,
  JUMPCLOUD_CONSOLE_SURFACE,
  projectJumpcloudConsoleMethods,
  projectJumpcloudConsolePages,
} from "./browserProjection.js";
import type { JumpcloudConsoleWalkResult } from "./browserWalk.js";
import {
  emptyJumpcloudConsoleKindFile,
  initialJumpcloudConsoleManifest,
  type JumpcloudConsoleChannelEntity,
  type JumpcloudConsoleEntity,
  type JumpcloudConsoleGap,
  type JumpcloudConsoleKind,
  type JumpcloudConsoleKindFile,
  type JumpcloudConsoleManifest,
} from "./consoleModel.js";
import { type JumpcloudConsolePaths, publishJumpcloudConsole, readJumpcloudConsole } from "./consoleStore.js";

/** Fold one observed entity onto its stored predecessor, carrying `firstSeenAt` forward. */
function foldConsoleChannel({
  stored,
  observed,
}: {
  stored: JumpcloudConsoleEntity | undefined;
  observed: JumpcloudConsoleEntity;
}): JumpcloudConsoleEntity {
  const fresh = observed.channels[CHANNEL];
  if (stored === undefined) {
    return observed;
  }
  const previous = stored.channels[CHANNEL];
  let merged: JumpcloudConsoleChannelEntity | null = fresh;
  if (fresh === null) {
    merged = previous;
  } else if (previous !== null) {
    merged = { ...fresh, firstSeenAt: previous.firstSeenAt };
  }
  return { ...observed, channels: { ...stored.channels, [CHANNEL]: merged } };
}

/** Mark a stored entity's console view stale when this walk did not see it; `null` leaves it as it is. */
function staleConsoleChannel({ stored }: { stored: JumpcloudConsoleEntity }): JumpcloudConsoleEntity | null {
  const held = stored.channels[CHANNEL];
  if (held === null || held.state === "stale") {
    return null;
  }
  return { ...stored, channels: { ...stored.channels, [CHANNEL]: { ...held, state: "stale" } } };
}

/** Merge this walk's projections for one kind into what the store already holds. */
function mergeConsoleKind({
  stored,
  observed,
  at,
}: {
  stored: readonly JumpcloudConsoleEntity[];
  observed: readonly JumpcloudConsoleEntity[];
  at: string;
}): Result<readonly JumpcloudConsoleEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: held, observed: fresh }) => ok(foldConsoleChannel({ observed: fresh, stored: held })),
    observed,
    staleEntity: ({ stored: held }) => staleConsoleChannel({ stored: held }),
    stored,
  });
}

/** Every gap this walk observed, the standing ones included. */
function observedGaps({ walk, at }: { walk: JumpcloudConsoleWalkResult; at: string }): readonly JumpcloudConsoleGap[] {
  const gaps = [...consolePageGaps({ at, pages: walk.pages }), ...standingConsoleGaps({ at })];
  if (!walk.sessionLost) {
    return gaps;
  }
  return [
    ...gaps,
    openJumpcloudConsoleGap({
      at,
      condition: "browser-surface-unreadable",
      kind: null,
      reason: "the administrator session was lost part-way through the walk, so the pages after it were not attempted",
      scope: JUMPCLOUD_CONSOLE_SURFACE,
    }),
  ];
}

/** Merge this walk's page observations and gaps onto the stored page kind. */
function mergedPageFile({
  walk,
  stored,
  at,
}: {
  walk: JumpcloudConsoleWalkResult;
  stored: JumpcloudConsoleKindFile;
  at: string;
}): Result<JumpcloudConsoleKindFile> {
  const fields = assembleWalkKind({
    at,
    cell: pageCoverageCell({ at, pages: walk.pages, stored }),
    merge: () =>
      mergeConsoleKind({
        at,
        observed: projectJumpcloudConsolePages({ at, pages: walk.pages }),
        stored: stored.entities,
      }),
    reconcile: () =>
      reconcileGaps({
        at,
        observed: observedGaps({ at, walk }),
        rechecks: consoleRechecks({ pages: walk.pages }),
        runFailed: walk.sessionLost,
        stored: stored.gaps,
      }),
    stored,
    surface: JUMPCLOUD_CONSOLE_SURFACE,
  });
  return fields.isErr() ? err(fields.error) : ok({ ...stored, ...fields.value, kind: "page" });
}

/** Merge this walk's observed operations onto the stored method kind. */
function mergedMethodFile({
  walk,
  observed,
  stored,
  at,
}: {
  walk: JumpcloudConsoleWalkResult;
  observed: readonly JumpcloudConsoleEntity[];
  stored: JumpcloudConsoleKindFile;
  at: string;
}): Result<JumpcloudConsoleKindFile> {
  const fields = assembleWalkKind({
    at,
    cell: methodCoverageCell({ at, operationCount: observed.length, stored, walk }),
    merge: () => mergeConsoleKind({ at, observed, stored: stored.entities }),
    // The walk raises no method-level gap of its own, so carrying the stored ones forward is the no-op.
    reconcile: () => ok(stored.gaps),
    stored,
    surface: JUMPCLOUD_CONSOLE_SURFACE,
  });
  return fields.isErr() ? err(fields.error) : ok({ ...stored, ...fields.value, kind: "method" });
}

/** Stamp both kinds this walk wrote. */
function walkManifest({
  manifest,
  pageCount,
  methodCount,
  at,
}: {
  manifest: JumpcloudConsoleManifest | null;
  pageCount: number;
  methodCount: number;
  at: string;
}): JumpcloudConsoleManifest {
  if (manifest === null) {
    return walkManifest({ at, manifest: initialJumpcloudConsoleManifest({ updatedAt: at }), methodCount, pageCount });
  }
  const stamps = stampedWalkKinds({ at, methodCount, pageCount });
  const paged = withKindStatus<JumpcloudConsoleKind, JumpcloudConsoleManifest>({
    kind: "page",
    manifest,
    status: stamps.page,
  });
  return withKindStatus<JumpcloudConsoleKind, JumpcloudConsoleManifest>({
    kind: "method",
    manifest: paged,
    status: stamps.method,
  });
}

/**
 * Publish one walk into the console generation.
 *
 * @param walk what the walk observed
 * @param paths the resolved console paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishJumpcloudConsoleWalk({
  walk,
  paths,
  at,
}: {
  walk: JumpcloudConsoleWalkResult;
  paths: JumpcloudConsolePaths;
  at: string;
}): Result<PageWalkPublished> {
  const covers = refuseUndeclaredWalk({
    declaredSurfaces: JUMPCLOUD_CONSOLE_PAGES.map((declared) => declared.surface),
    pages: walk.pages,
  });
  if (covers.isErr()) {
    return err(covers.error);
  }
  return publishPageWalk({
    declaredCount: JUMPCLOUD_CONSOLE_PAGES.length,
    directory: paths.directory,
    emptyFile: ({ kind }) => emptyJumpcloudConsoleKindFile({ kind, updatedAt: at }),
    manifestFor: ({ manifest, methodCount, pageCount }) => walkManifest({ at, manifest, methodCount, pageCount }),
    mergeMethodFile: ({ walk: checked, observed, stored }) => mergedMethodFile({ at, observed, stored, walk: checked }),
    mergePageFile: ({ walk: checked, stored }) => mergedPageFile({ at, stored, walk: checked }),
    projectMethods: ({ walk: checked }) => projectJumpcloudConsoleMethods({ at, pages: checked.pages }),
    publish: ({ derivedFrom, files, manifest }) => publishJumpcloudConsole({ derivedFrom, files, manifest, paths }),
    read: () => readJumpcloudConsole({ paths }),
    walk,
  });
}
