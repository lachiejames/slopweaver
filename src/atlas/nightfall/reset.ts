/**
 * `atlas nightfall reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per declared kind, so the freshly installed
 * generation is complete rather than partial.
 *
 * The detection gate is NOT run here, which is worth stating rather than assuming: `resetAtlas` publishes
 * through `NIGHTFALL_STORE_SPEC`, which carries no guard, while `refuseStoredDetections` runs only inside
 * `publishNightfallAtlas`. An empty generation holds no entity to judge, so nothing the gate refuses can pass
 * through a reset.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  byNightfallKind,
  emptyNightfallKindFile,
  initialNightfallManifest,
  type NightfallAtlasKind,
  type NightfallAtlasKindFile,
} from "./model.js";
import { NIGHTFALL_STORE_SPEC, type NightfallAtlasPaths } from "./store.js";

/**
 * What a reset did.
 * @internal
 */
export type NightfallResetOutcome = AtlasResetOutcome;

/**
 * An empty file for every kind, so the freshly installed generation is complete rather than partial.
 *
 * Built by mapping the kind constant rather than by listing twenty literals, so a kind added to
 * {@link NIGHTFALL_ATLAS_KINDS} cannot be forgotten here — the failure would be a fresh generation
 * silently missing that kind's file, its old one only in the archive.
 *
 * @param at this run's ISO timestamp
 * @returns one empty file per declared kind
 * @internal
 */
export function emptyNightfallFiles({
  at,
}: {
  at: string;
}): Readonly<Record<NightfallAtlasKind, NightfallAtlasKindFile>> {
  return byNightfallKind({ build: ({ kind }) => emptyNightfallKindFile({ kind, updatedAt: at }) });
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param at this run's ISO timestamp, which also names the archive directory
 * @param paths the resolved atlas paths
 * @returns where the prior generation was archived, or why the reset was refused
 */
export function resetNightfallAtlas({
  at,
  paths,
}: {
  at: string;
  paths: NightfallAtlasPaths;
}): Result<NightfallResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyNightfallFiles({ at }),
    emptyManifest: initialNightfallManifest({ updatedAt: at }),
    paths,
    spec: NIGHTFALL_STORE_SPEC,
  });
}
