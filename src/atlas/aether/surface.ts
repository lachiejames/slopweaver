/**
 * Publish one Aether portal walk into the atlas's three kinds — project, finding and page.
 *
 * ## A walk is a COMPLETE read, so entities are replaced, not merged
 *
 * Every walk re-reads the whole portal — its project and every finding across the open, closed and ignored
 * tabs — so a finding this walk did not see is one the portal no longer lists, and the store holds this set
 * rather than folding it onto the last. That is simpler than the sibling atlases' stale-and-merge machinery
 * and correct for the same reason a full API read is: there is no per-family paging here that could make an
 * absence mean "not read this time" rather than "gone". A LOST SESSION is the one exception, and it is
 * caught before publish: a walk that hit the sign-in wall reads nothing, so it must not empty the store.
 *
 * ## Two gaps are STANDING, not conditional
 *
 * `report-print-only` and `no-shot-adapter` are always open, because they are true of every walk: the Risk
 * Report is a print-to-PDF this atlas cannot fetch, and `browser shot` carries no adapter for this host, so
 * the only picture of a portal page is the walk's own raw screenshot. Recording them as open gaps on every
 * generation is how the atlas keeps saying what it structurally cannot do rather than letting it read as an
 * omission (`descriptor.ts` carries the same two facts for a reader who reads the descriptor instead).
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import { stableEntityId } from "../kit/identity.js";
import { type AtlasKindStatus, failedKindStatus, succeededKindStatus } from "../kit/kindStatus.js";

import { AETHER_VISIBILITY_SCOPE } from "./descriptor.js";
import {
  type AetherCoverageCell,
  type AetherEntity,
  type AetherGap,
  type AetherKindFile,
  type AetherManifest,
  type AetherPage,
  assembleAetherKindFile,
  initialAetherManifest,
} from "./entities.js";
import { AETHER_KINDS, AETHER_PLATFORM, type AetherKind } from "./model.js";
import { type AetherReduction, reduceAetherPortal } from "./reduction.js";
import { type AetherAtlasPaths, publishAetherAtlas, readAetherAtlas } from "./store.js";
import type { AetherPageObservation, AetherWalkResult } from "./walk.js";
import { loginWallGaps, walkGaps } from "./walkGaps.js";

/** What a walk publish established, for the verb to report. */
export interface AetherWalkOutcome {
  readonly landedCount: number;
  readonly pageCount: number;
  readonly findingCount: number;
  readonly projectCount: number;
  readonly openGapCount: number;
  readonly loggedOut: boolean;
}

/** One page observation, projected into a stored `page` entity. */
function pageEntity({ obs, at }: { obs: AetherPageObservation; at: string }): AetherPage {
  // `if` rather than `??` because a new nullish-coalesce is what `no-silent-fallback` forbids.
  let finalUrl = `${AETHER_PLATFORM}:${obs.href}`;
  let title = "";
  if (obs.finalUrl !== null) {
    finalUrl = obs.finalUrl;
  }
  if (obs.title !== null) {
    title = obs.title;
  }
  const deepLinkStatus = obs.finalUrl === null ? "unavailable" : "browser-discovered";
  return {
    finalUrl,
    firstSeenAt: at,
    id: stableEntityId({ components: { kind: "page", route: obs.href }, namespace: AETHER_PLATFORM }),
    providerId: obs.href,
    rendered: obs.rendered,
    responseCount: obs.responseCount,
    route: obs.href,
    source: {
      artifacts: [...obs.artifacts],
      deepLink: obs.finalUrl,
      deepLinkStatus,
      endpoint: obs.href,
      observedAt: at,
      surface: "aether-portal",
    },
    state: "observed",
    title,
  };
}

/** Every screenshot artifact the walk kept, so the page kind's coverage cell can carry them as proof. */
function pageArtifacts({ walk }: { walk: AetherWalkResult }): readonly AtlasArtifactRef[] {
  return walk.pages.flatMap((page) => page.artifacts);
}

/** The entities each kind holds after this walk, keyed by kind. */
function entitiesByKind({
  walk,
  reduction,
  at,
}: {
  walk: AetherWalkResult;
  reduction: AetherReduction;
  at: string;
}): Readonly<Record<AetherKind, readonly AetherEntity[]>> {
  return {
    finding: reduction.findings,
    page: walk.pages.map((obs) => pageEntity({ at, obs })),
    project: reduction.projects,
  };
}

/** Build one kind's file for a walk that read the portal. */
function foldKind({
  kind,
  entities,
  gaps,
  artifacts,
  at,
}: {
  kind: AetherKind;
  entities: readonly AetherEntity[];
  gaps: readonly AetherGap[];
  artifacts: readonly AtlasArtifactRef[];
  at: string;
}): Result<{ file: AetherKindFile; status: AtlasKindStatus }> {
  const kitCell = succeededCoverageCell({
    artifacts: kind === "page" ? artifacts : [],
    at,
    reason: `the Aether portal walk read ${String(entities.length)} ${kind} record(s) from the owner's signed-in session`,
    role: "authoritative",
    scope: kind,
    state: "synced",
    surface: "aether-portal",
    visibilityScope: AETHER_VISIBILITY_SCOPE,
  });
  const cell: AetherCoverageCell = { ...kitCell, artifacts: [...kitCell.artifacts], surface: "aether-portal" };
  const file = assembleAetherKindFile({
    at,
    coverage: [cell],
    entities,
    gaps: gaps.filter((gap) => gap.kind === kind),
    kind,
  });
  if (file.isErr()) {
    return err(file.error);
  }
  return ok({ file: file.value, status: succeededKindStatus({ at, entityCount: entities.length, reasons: [] }) });
}

/** Build one kind's file for a walk that hit the sign-in wall and read nothing. */
function foldLoggedOutKind({
  kind,
  prior,
  gaps,
  at,
}: {
  kind: AetherKind;
  prior: AetherKindFile | null;
  gaps: readonly AetherGap[];
  at: string;
}): Result<{ file: AetherKindFile; status: AtlasKindStatus }> {
  const entities: readonly AetherEntity[] = prior === null ? [] : prior.entities;
  const priorCell = prior === null ? undefined : prior.coverage[0];
  // `if` rather than `??`, per `no-silent-fallback`.
  let previous: AetherCoverageCell | null = null;
  if (priorCell !== undefined) {
    previous = priorCell;
  }
  const kitCell = failedCoverageCell({
    previous,
    reason:
      "the walk reached the portal but landed on the Aether sign-in form — the owner's Chrome holds no live session, so nothing was read this run and stored records are left as they were",
    role: "authoritative",
    scope: kind,
    state: "unavailable",
    surface: "aether-portal",
    unblockedBy: "sign in to app.tryaether.ai in the recorded work profile, then run slopweaver atlas aether walk",
    visibilityScope: AETHER_VISIBILITY_SCOPE,
  });
  const cell: AetherCoverageCell = { ...kitCell, artifacts: [...kitCell.artifacts], surface: "aether-portal" };
  const lastSuccessAt = previous === null ? null : previous.lastSuccessAt;
  const file = assembleAetherKindFile({
    at,
    coverage: [cell],
    entities,
    gaps: gaps.filter((gap) => gap.kind === kind || gap.kind === null),
    kind,
  });
  if (file.isErr()) {
    return err(file.error);
  }
  return ok({
    file: file.value,
    status: failedKindStatus({ at, entityCount: entities.length, lastSuccessAt, reasons: ["session-absent"] }),
  });
}

/** Widen a kit kind status into the manifest schema's own mutable shape. */
function manifestStatus({ status }: { status: AtlasKindStatus }): AetherManifest["kinds"][AetherKind] {
  const lastAttempt =
    status.lastAttempt === null
      ? null
      : { at: status.lastAttempt.at, outcome: status.lastAttempt.outcome, reasons: [...status.lastAttempt.reasons] };
  return {
    digest: status.digest,
    entityCount: status.entityCount,
    lastAttempt,
    lastSuccessAt: status.lastSuccessAt,
    permissionBlocked: status.permissionBlocked === undefined ? null : status.permissionBlocked,
  };
}

/**
 * Publish one portal walk into the whole atlas.
 *
 * @param paths the resolved atlas paths
 * @param walk what the walk produced
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason nothing was
 */
export function publishAetherWalk({
  paths,
  walk,
  at,
}: {
  paths: AetherAtlasPaths;
  walk: AetherWalkResult;
  at: string;
}): Result<AetherWalkOutcome> {
  const snapshot = readAetherAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const prior = snapshot.value.manifest;
  // `if` rather than `??`, per `no-silent-fallback`.
  let baseManifest: AetherManifest = initialAetherManifest({ updatedAt: at });
  if (prior !== null) {
    baseManifest = prior;
  }
  const loggedOut = walk.loginWallPages.length > 0 || !walk.pages.some((page) => page.outcome === "landed");
  const reduction = reduceAetherPortal({ at, responses: walk.responses });
  const gaps = loggedOut ? loginWallGaps({ at, walk }) : walkGaps({ at, reduction, walk });

  const folded = foldAllKinds({ at, gaps, loggedOut, reduction, snapshot: snapshot.value, walk });
  if (folded.isErr()) {
    return err(folded.error);
  }
  const published = publishAetherAtlas({
    derivedFrom: prior,
    files: folded.value.files,
    manifest: { ...baseManifest, kinds: folded.value.kinds, updatedAt: at },
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    findingCount: reduction.findings.length,
    landedCount: walk.pages.filter((page) => page.outcome === "landed").length,
    loggedOut,
    openGapCount: gaps.length,
    pageCount: walk.pages.length,
    projectCount: reduction.projects.length,
  });
}

/** Fold every declared kind into its file and manifest status — the read path, or the logged-out path. */
function foldAllKinds({
  snapshot,
  walk,
  reduction,
  gaps,
  loggedOut,
  at,
}: {
  snapshot: { readonly files: Readonly<Record<AetherKind, AetherKindFile | null>> };
  walk: AetherWalkResult;
  reduction: AetherReduction;
  gaps: readonly AetherGap[];
  loggedOut: boolean;
  at: string;
}): Result<{ files: Partial<Record<AetherKind, AetherKindFile>>; kinds: AetherManifest["kinds"] }> {
  const artifacts = pageArtifacts({ walk });
  const entities = entitiesByKind({ at, reduction, walk });
  const files: Partial<Record<AetherKind, AetherKindFile>> = {};
  const statusEntries: (readonly [AetherKind, AetherManifest["kinds"][AetherKind]])[] = [];
  for (const kind of AETHER_KINDS) {
    const folded = loggedOut
      ? foldLoggedOutKind({ at, gaps, kind, prior: snapshot.files[kind] })
      : foldKind({ artifacts, at, entities: entities[kind], gaps, kind });
    if (folded.isErr()) {
      return err(folded.error);
    }
    files[kind] = folded.value.file;
    statusEntries.push([kind, manifestStatus({ status: folded.value.status })]);
  }
  // `as`: built from the platform's own exhaustive kind list, which Object.fromEntries widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return ok({ files, kinds: Object.fromEntries(statusEntries) as AetherManifest["kinds"] });
}
