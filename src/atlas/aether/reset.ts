/**
 * `atlas aether reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The empty generation passes this atlas's own publish guard trivially, which
 * is the point rather than an assumption: a reset publishes through the same guarded spec as a real walk, so
 * it cannot become a way to write past the guard.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { type AetherKindFile, emptyAetherKindFile, initialAetherManifest } from "./entities.js";
import { AETHER_KINDS, type AetherKind } from "./model.js";
import { AETHER_STORE_SPEC, type AetherAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type AetherResetOutcome = AtlasResetOutcome;

/**
 * An empty file for every kind, so the freshly installed generation is complete rather than partial.
 *
 * Built by mapping the kind constant rather than by listing literals, so a kind added to {@link AETHER_KINDS}
 * cannot be forgotten here — the failure would be a fresh
 * generation silently missing that kind's file, its old one only in the archive.
 *
 * @param at this run's ISO timestamp
 * @returns one empty file per declared kind
 *
 * @internal
 */
export function emptyAetherFiles({ at }: { at: string }): Readonly<Record<AetherKind, AetherKindFile>> {
  const entries = AETHER_KINDS.map((kind) => [kind, emptyAetherKindFile({ kind, updatedAt: at })] as const);
  // `as`: built from the platform's own exhaustive kind list, which Object.fromEntries widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<AetherKind, AetherKindFile>;
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetAetherAtlas({ paths, at }: { paths: AetherAtlasPaths; at: string }): Result<AetherResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyAetherFiles({ at }),
    emptyManifest: initialAetherManifest({ updatedAt: at }),
    paths,
    spec: AETHER_STORE_SPEC,
  });
}
