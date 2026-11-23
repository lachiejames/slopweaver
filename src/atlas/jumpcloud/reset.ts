/**
 * `atlas jumpcloud reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per declared kind, so the freshly installed
 * generation is complete rather than partial.
 *
 * The empty generation passes this atlas's own publish guard trivially, which is worth stating rather than
 * assuming: `resetAtlas` publishes through the same guarded spec as a real sync, so a reset cannot become a
 * way to write past the guard.
 *
 * The resume journal goes with it: it lives in the directory the archive moves, so the fresh generation starts
 * with none. A journal that outlived its generation would resume a sync into a store that has just been
 * emptied, so the fresh generation would be built out of calls made against the one that was archived. Nothing
 * is deleted afterwards either: once the reset returns its lock is released, and a sync started in that gap
 * owns the only journal at the live path.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyJumpcloudKindFile, initialJumpcloudManifest, type JumpcloudKindFile } from "./entities.js";
import { JUMPCLOUD_KINDS, type JumpcloudKind } from "./model.js";
import { JUMPCLOUD_STORE_SPEC, type JumpcloudAtlasPaths } from "./store.js";

/**
 * What a reset did.
 * @internal
 */
export type JumpcloudResetOutcome = AtlasResetOutcome;

/**
 * An empty file for every kind, so the freshly installed generation is complete rather than partial.
 *
 * Built by mapping the kind constant rather than by listing seventy-four literals, so a kind added to
 * {@link JUMPCLOUD_KINDS} cannot be forgotten here — the failure would be a fresh
 * generation silently missing that kind's file, its old one only in the archive.
 *
 * @param at this run's ISO timestamp
 * @returns one empty file per declared kind
 * @internal
 */
export function emptyJumpcloudFiles({ at }: { at: string }): Readonly<Record<JumpcloudKind, JumpcloudKindFile>> {
  const entries = JUMPCLOUD_KINDS.map((kind) => [kind, emptyJumpcloudKindFile({ kind, updatedAt: at })] as const);
  // `as`: built from the platform's own exhaustive kind list, which `Object.fromEntries` widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<JumpcloudKind, JumpcloudKindFile>;
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetJumpcloudAtlas({
  paths,
  at,
}: {
  paths: JumpcloudAtlasPaths;
  at: string;
}): Result<JumpcloudResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyJumpcloudFiles({ at }),
    emptyManifest: initialJumpcloudManifest({ updatedAt: at }),
    paths,
    spec: JUMPCLOUD_STORE_SPEC,
  });
}
