/**
 * The one publish path both channels take: merge onto the stored generation, admit it, write it.
 *
 * ## Why it is shared rather than written twice
 *
 * The `web-data` sync and the browser walk differ in what they OBSERVE and in nothing else about how a
 * generation is written: both merge per kind against the channel they refreshed, both reconcile gaps, both
 * pass the whole document through the sensitivity gate, both take the publish lock, and both refuse when
 * another writer has moved the generation underneath them. Writing that twice is how two publishers drift
 * into two subtly different guarantees — which is the failure mode this atlas is most exposed to, since
 * both of its writers touch the `endpoint` kind.
 *
 * A kind absent from `entities` AND `coverage` is left untouched, which is what lets each channel publish
 * only what it actually looked at.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasGapRecheck } from "../kit/gaps.js";
import { reconcileGaps } from "../kit/gaps.js";

import { mergeNxCloudChannel } from "./merge.js";
import {
  emptyNxCloudKindFile,
  initialNxCloudManifest,
  NX_CLOUD_ATLAS_KINDS,
  type NxCloudAtlasChannel,
  type NxCloudAtlasEntity,
  type NxCloudAtlasGap,
  type NxCloudAtlasKind,
  type NxCloudAtlasKindFile,
  type NxCloudAtlasManifest,
  type NxCloudCoverageCell,
} from "./model.js";
import { admitNxCloudDocument } from "./sensitivity.js";
import { type NxCloudAtlasPaths, type NxCloudAtlasSnapshot, publishNxCloudAtlas, readNxCloudAtlas } from "./store.js";

/**
 * What one channel's pass concluded, in the shape the publisher takes.
 *
 * @internal
 */
export interface NxCloudChannelObservation {
  readonly entities: Readonly<Record<NxCloudAtlasKind, readonly NxCloudAtlasEntity[]>>;
  readonly coverage: Readonly<Record<NxCloudAtlasKind, readonly NxCloudCoverageCell[]>>;
  readonly gaps: readonly NxCloudAtlasGap[];
  readonly rechecks: readonly AtlasGapRecheck[];
}

/** What one publish did. */
export interface NxCloudPublishOutcome {
  /** How many entities each kind this pass wrote holds after the merge; a kind it did not write reads 0. */
  readonly entityCounts: Readonly<Record<NxCloudAtlasKind, number>>;
  /** Every gap open after this run, across the kinds this pass wrote. */
  readonly openGapCount: number;
  /** The files written, in publish order. */
  readonly written: readonly string[];
}

/**
 * Merge one channel's observation onto the stored generation and write it.
 *
 * The caller holds the publish lock: this is the read-and-write half, and taking the lock inside it would
 * put the read outside the critical section, which is exactly the interleaving the lock exists to stop.
 *
 * @param paths the resolved paths
 * @param observation what this pass concluded
 * @param channel which channel this pass refreshed
 * @param surface the surface name whose coverage cells this pass replaces
 * @param at this run's ISO timestamp
 * @param denylist the private organisation words
 * @returns what was written, or every reason nothing was
 */
export function publishNxCloudChannel({
  paths,
  observation,
  channel,
  surface,
  at,
  denylist,
}: {
  paths: NxCloudAtlasPaths;
  observation: NxCloudChannelObservation;
  channel: NxCloudAtlasChannel;
  surface: string;
  at: string;
  denylist: readonly string[];
}): Result<NxCloudPublishOutcome> {
  const snapshot = readNxCloudAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const built = buildChannelFiles({ at, channel, observation, snapshot: snapshot.value, surface });
  if (built.isErr()) {
    return err(built.error);
  }
  const { files, entityCounts, openGapCount } = built.value;
  for (const [kind, file] of Object.entries(files)) {
    const admitted = admitNxCloudDocument({ denylist, document: file, label: `${kind} file` });
    if (admitted.isErr()) {
      return err(admitted.error);
    }
  }
  const published = publishNxCloudAtlas({
    derivedFrom: snapshot.value.manifest,
    files,
    manifest: stampManifest({ at, counts: entityCounts, manifest: snapshot.value.manifest, written: files }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({ entityCounts, openGapCount, written: published.value });
}

/** The kind file the store held, or an empty one stamped `at` when it held none. */
function heldKindFile({
  kind,
  stored,
  at,
}: {
  kind: NxCloudAtlasKind;
  stored: NxCloudAtlasKindFile | null | undefined;
  at: string;
}): NxCloudAtlasKindFile {
  if (stored == null) {
    return emptyNxCloudKindFile({ kind, updatedAt: at });
  }
  return stored;
}

/**
 * Merge one channel's observation onto the stored generation, kind by kind.
 *
 * A kind this pass neither observed nor graded is absent from the result, which is what makes the kit leave
 * the other channel's file untouched.
 *
 * @param observation what this pass concluded
 * @param snapshot the generation it is merging onto
 * @param channel which channel this pass refreshed
 * @param surface the surface name whose coverage cells this pass replaces
 * @param at this run's ISO timestamp
 * @returns the files to write and what they hold, or the reason this run cannot be merged
 */
function buildChannelFiles({
  observation,
  snapshot,
  channel,
  surface,
  at,
}: {
  observation: NxCloudChannelObservation;
  snapshot: NxCloudAtlasSnapshot;
  channel: NxCloudAtlasChannel;
  surface: string;
  at: string;
}): Result<{
  files: Partial<Record<NxCloudAtlasKind, NxCloudAtlasKindFile>>;
  entityCounts: Record<NxCloudAtlasKind, number>;
  openGapCount: number;
}> {
  const files: Partial<Record<NxCloudAtlasKind, NxCloudAtlasKindFile>> = {};
  const entityCounts: Record<NxCloudAtlasKind, number> = {
    endpoint: 0,
    family: 0,
    organization: 0,
    route: 0,
    workspace: 0,
  };
  let openGapCount = 0;
  for (const kind of NX_CLOUD_ATLAS_KINDS) {
    const observed = observation.entities[kind];
    if (observed.length === 0 && observation.coverage[kind].length === 0) {
      continue;
    }
    const stored = heldKindFile({ at, kind, stored: snapshot.files[kind] });
    const merged = mergeNxCloudChannel({ at, channel, observed, stored: stored.entities });
    if (merged.isErr()) {
      return err(merged.error);
    }
    const gaps = reconcileGaps<NxCloudAtlasGap>({
      at,
      observed: observation.gaps.filter((gap) => gap.kind === kind),
      rechecks: observation.rechecks,
      runFailed: false,
      stored: stored.gaps,
    });
    if (gaps.isErr()) {
      return err(gaps.error);
    }
    entityCounts[kind] = merged.value.length;
    openGapCount += gaps.value.filter((gap) => gap.status === "open").length;
    files[kind] = {
      ...stored,
      coverage: [...stored.coverage.filter((cell) => cell.surface !== surface), ...observation.coverage[kind]],
      entities: [...merged.value],
      gaps: [...gaps.value],
      updatedAt: at,
    };
  }
  return ok({ entityCounts, files, openGapCount });
}

/** The manifest the store held, or a fresh one stamped `at` when it held none. */
function heldManifest({ manifest, at }: { manifest: NxCloudAtlasManifest | null; at: string }): NxCloudAtlasManifest {
  if (manifest == null) {
    return initialNxCloudManifest({ updatedAt: at });
  }
  return manifest;
}

/**
 * Stamp the kinds this pass wrote, leaving every other kind's status exactly as the other channel left it.
 *
 * @param manifest the manifest the store held, or `null` when nothing has been published
 * @param counts how many entities each kind holds after the merge
 * @param written which kinds this pass actually wrote
 * @param at this run's ISO timestamp
 * @returns the manifest to publish
 */
function stampManifest({
  manifest,
  counts,
  written,
  at,
}: {
  manifest: NxCloudAtlasManifest | null;
  counts: Readonly<Record<NxCloudAtlasKind, number>>;
  written: Readonly<Partial<Record<NxCloudAtlasKind, NxCloudAtlasKindFile>>>;
  at: string;
}): NxCloudAtlasManifest {
  const base = heldManifest({ at, manifest });
  const kinds = { ...base.kinds };
  for (const kind of NX_CLOUD_ATLAS_KINDS) {
    if (written[kind] === undefined) {
      continue;
    }
    kinds[kind] = {
      digest: null,
      entityCount: counts[kind],
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  }
  return { ...base, kinds, updatedAt: at };
}
