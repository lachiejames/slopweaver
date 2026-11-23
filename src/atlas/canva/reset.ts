/**
 * `atlas canva reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per declared kind, so the freshly installed generation
 * is complete rather than partial.
 *
 * The live-channel gate is NOT run here, which is worth stating rather than assuming: `resetAtlas` publishes
 * through `CANVA_STORE_SPEC`, which carries no guard, while `refuseUnearnedLiveChannels` runs only inside
 * `publishCanvaAtlas`. An empty generation holds no channel to earn, so nothing the gate refuses can pass
 * through a reset.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  byCanvaKind,
  type CanvaAtlasKind,
  type CanvaAtlasKindFile,
  emptyCanvaKindFile,
  initialCanvaManifest,
} from "./model.js";
import { CANVA_STORE_SPEC, type CanvaAtlasPaths } from "./store.js";

/**
 * What a reset did.
 * @internal
 */
export type CanvaResetOutcome = AtlasResetOutcome;

/**
 * An empty file for every kind, so the freshly installed generation is complete rather than partial.
 *
 * Built by mapping the kind constant rather than by listing seventeen literals, so a kind added to
 * {@link CANVA_ATLAS_KINDS} cannot be forgotten here — the failure would be a fresh
 * generation silently missing that kind's file, its old one only in the archive.
 *
 * @param at this run's ISO timestamp
 * @returns one empty file per declared kind
 * @internal
 */
export function emptyCanvaFiles({ at }: { at: string }): Readonly<Record<CanvaAtlasKind, CanvaAtlasKindFile>> {
  return byCanvaKind({ build: ({ kind }) => emptyCanvaKindFile({ kind, updatedAt: at }) });
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param at this run's ISO timestamp, which also names the archive directory
 * @param paths the resolved atlas paths
 * @returns where the prior generation was archived, or why the reset was refused
 */
export function resetCanvaAtlas({ at, paths }: { at: string; paths: CanvaAtlasPaths }): Result<CanvaResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyCanvaFiles({ at }),
    emptyManifest: initialCanvaManifest({ updatedAt: at }),
    paths,
    spec: CANVA_STORE_SPEC,
  });
}
