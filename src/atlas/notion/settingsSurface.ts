/**
 * Publish what the settings walk captured into the atlas's `page` kind, beside the declared routes.
 *
 * ## Two publishers share one kind, and neither may truncate the other
 *
 * `browserSurface.ts` publishes the declared ROUTES; this publishes the declared settings TABS. Both write
 * `page` entities on the `browser` channel, so each partitions the stored entities by provider id
 * ({@link isSettingsTabProviderId}) and merges — and stales — only its own half. The same holds for coverage:
 * both cells sit under the one `browser-walk` surface, told apart by scope, and each publisher replaces only
 * its own `(surface, scope)` cell. The shape is Vanta's control shot beside its declared walk
 * (`vanta/controlShotSurface.ts`), for the same reason.
 *
 * ## The route gaps survive as the measurement they are
 *
 * Every recheck here is scoped to a `settings/` surface, and the kit's gap lifecycle closes nothing it did
 * not recheck, so the route walk's `browser-page-*` gaps — the evidence that the settings surface has no
 * address — stay exactly as the route walk left them.
 *
 * ## The tabs' denominator is the declared list
 *
 * The cell is `synced` only when every tab in `settingsTabs.ts` was shown AND photographed, graded against
 * that constant rather than the rows a caller handed in, and after every screenshot has been re-read from
 * disk (`kit/walkPublish.ts` on why a reference is not evidence).
 */
import { err, ok, type Result } from "../../lib/result.js";
import { sortedById } from "../kit/channelProjection.js";
import { refuseUndeclaredWalk, stampedKindStatus, verifyArtifactsOnDisk } from "../kit/walkPublish.js";

import { NOTION_WALK_SURFACE } from "./browserSurface.js";
import { failedNotionCoverageCell, succeededNotionCoverageCell } from "./coverage.js";
import { reconcileNotionGaps } from "./gaps.js";
import { mergeNotionChannel } from "./merge.js";
import {
  emptyNotionKindFile,
  initialNotionManifest,
  type NotionAtlasKindFile,
  type NotionAtlasManifest,
  type NotionCoverageCell,
} from "./model.js";
import { projectNotionSettingsTabs } from "./projection.js";
import { accountTabGap, settingsTabGaps, settingsTabRechecks } from "./settingsGaps.js";
import { NOTION_SETTINGS_TABS } from "./settingsTabs.js";
import {
  isSettingsTabHeld,
  isSettingsTabProviderId,
  NOTION_SETTINGS_COVERAGE_SCOPE,
  type NotionSettingsTabObservation,
  type NotionSettingsWalkResult,
  settingsTabSurface,
} from "./settingsWalk.js";
import { type NotionAtlasPaths, publishNotionAtlas, readNotionAtlas, withNotionPublishLock } from "./store.js";

/**
 * What publishing a settings walk did.
 *
 * @internal
 */
export interface NotionSettingsSurfaceOutcome {
  readonly declaredCount: number;
  readonly heldCount: number;
  readonly written: readonly string[];
}

/**
 * Whether a stored coverage cell is the tabs' own — the one this publisher replaces.
 *
 * @param cell a stored coverage cell
 * @returns whether it is the `browser-walk` cell graded on the declared settings tabs
 */
function isSettingsCoverageCell({ cell }: { cell: NotionCoverageCell }): boolean {
  return cell.surface === NOTION_WALK_SURFACE && cell.scope === NOTION_SETTINGS_COVERAGE_SCOPE;
}

/** The one coverage cell a settings walk writes, graded against the DECLARED tab list. */
function settingsCoverageCell({
  tabs,
  at,
  stored,
}: {
  tabs: readonly NotionSettingsTabObservation[];
  at: string;
  stored: NotionAtlasKindFile;
}): NotionCoverageCell {
  const held = tabs.filter((tab) => isSettingsTabHeld({ tab })).length;
  // The DECLARED constant, never `tabs.length` — see `refuseUndeclaredWalk`.
  const declaredCount = NOTION_SETTINGS_TABS.length;
  const reason = `${String(held)} of ${String(declaredCount)} declared settings tab(s) shown and photographed`;
  if (held === declaredCount) {
    return succeededNotionCoverageCell({
      artifacts: [],
      at,
      channel: "browser",
      reason,
      role: "authoritative",
      scope: NOTION_SETTINGS_COVERAGE_SCOPE,
      state: "synced",
      surface: NOTION_WALK_SURFACE,
    });
  }
  // A first failed run has no earlier cell to carry forward, which is absence by design.
  const earlier = stored.coverage.find((cell) => isSettingsCoverageCell({ cell }));
  let previous: NotionCoverageCell | null = null;
  if (earlier !== undefined) {
    previous = earlier;
  }
  return failedNotionCoverageCell({
    channel: "browser",
    previous,
    reason,
    role: "authoritative",
    scope: NOTION_SETTINGS_COVERAGE_SCOPE,
    state: "deferred",
    surface: NOTION_WALK_SURFACE,
    unblockedBy: "each unheld tab carries its own gap naming what stopped it",
  });
}

/** The manifest the store held, or a fresh one stamped `at` when it held none. */
function heldManifest({ manifest, at }: { manifest: NotionAtlasManifest | null; at: string }): NotionAtlasManifest {
  if (manifest == null) {
    return initialNotionManifest({ updatedAt: at });
  }
  return manifest;
}

/**
 * Publish one settings walk into the atlas's `page` kind.
 *
 * @param walk what the settings walk observed
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishNotionSettingsTabs({
  walk,
  paths,
  at,
}: {
  walk: NotionSettingsWalkResult;
  paths: NotionAtlasPaths;
  at: string;
}): Result<NotionSettingsSurfaceOutcome> {
  const covers = refuseUndeclaredWalk({
    declaredSurfaces: NOTION_SETTINGS_TABS.map((tab) => settingsTabSurface({ id: tab.id })),
    pages: walk.tabs,
  });
  if (covers.isErr()) {
    return err(covers.error);
  }
  return withNotionPublishLock({ nowIso: at, paths, publish: () => publishTabsUnderLock({ at, paths, walk }) });
}

/** The critical section: read the generation, fold the tabs onto its page kind, and publish. */
function publishTabsUnderLock({
  walk,
  paths,
  at,
}: {
  walk: NotionSettingsWalkResult;
  paths: NotionAtlasPaths;
  at: string;
}): Result<NotionSettingsSurfaceOutcome> {
  const tabs = verifyArtifactsOnDisk({ directory: paths.directory, pages: walk.tabs });
  const snapshot = readNotionAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const stored = storedPageFile({ at, stored: snapshot.value.files.page });
  const file = mergedSettingsFile({ at, sessionLost: walk.sessionLost, stored, tabs });
  if (file.isErr()) {
    return err(file.error);
  }
  const base = heldManifest({ at, manifest: snapshot.value.manifest });
  const manifest: NotionAtlasManifest = {
    ...base,
    kinds: { ...base.kinds, page: stampedKindStatus({ at, count: file.value.entities.length }) },
    updatedAt: at,
  };
  const published = publishNotionAtlas({
    derivedFrom: snapshot.value.manifest,
    files: { page: file.value },
    manifest,
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    declaredCount: NOTION_SETTINGS_TABS.length,
    heldCount: tabs.filter((tab) => isSettingsTabHeld({ tab })).length,
    written: published.value,
  });
}

/** The page kind the store holds, or the empty one a first run folds onto. */
function storedPageFile({ stored, at }: { stored: NotionAtlasKindFile | null; at: string }): NotionAtlasKindFile {
  if (stored === null) {
    return emptyNotionKindFile({ kind: "page", updatedAt: at });
  }
  return stored;
}

/**
 * Fold the tabs onto the stored page kind, touching only the settings half of it.
 *
 * @param stored the page kind as the store holds it
 * @param tabs this run's verified tab observations
 * @param sessionLost whether the walk stopped early — a failed run may not close a gap
 * @param at this run's ISO timestamp
 * @returns the page kind to publish, or the first reason it cannot be assembled
 */
function mergedSettingsFile({
  stored,
  tabs,
  sessionLost,
  at,
}: {
  stored: NotionAtlasKindFile;
  tabs: readonly NotionSettingsTabObservation[];
  sessionLost: boolean;
  at: string;
}): Result<NotionAtlasKindFile> {
  const routes = stored.entities.filter((entity) => !isSettingsTabProviderId({ providerId: entity.providerId }));
  const merged = mergeNotionChannel({
    at,
    channel: "browser",
    observed: projectNotionSettingsTabs({ at, tabs }),
    stored: stored.entities.filter((entity) => isSettingsTabProviderId({ providerId: entity.providerId })),
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const gaps = reconcileNotionGaps({
    at,
    observed: [...settingsTabGaps({ at, tabs }), accountTabGap({ at })],
    rechecks: settingsTabRechecks({ tabs }),
    runFailed: sessionLost,
    stored: stored.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    ...stored,
    coverage: [
      ...stored.coverage.filter((cell) => !isSettingsCoverageCell({ cell })),
      settingsCoverageCell({ at, stored, tabs }),
    ],
    entities: [...sortedById({ entities: [...routes, ...merged.value] })],
    gaps: [...gaps.value],
    kind: "page",
    updatedAt: at,
  });
}
