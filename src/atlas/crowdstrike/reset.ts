/**
 * `crowdstrike reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial.
 *
 * The empty generation passes this atlas's own publish guard trivially, which is worth stating rather than
 * assuming: `resetAtlas` publishes through the same guarded spec as a real sync, so a reset cannot become a
 * way to write past the guard.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import type { CrowdstrikeKindFile } from "./entities.js";
import { emptyCrowdstrikeKindFile, initialCrowdstrikeManifest } from "./kindFiles.js";
import { CROWDSTRIKE_KINDS, type CrowdstrikeKind } from "./model.js";
import { CROWDSTRIKE_STORE_SPEC, type CrowdstrikeAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type CrowdstrikeResetOutcome = AtlasResetOutcome;

/**
 * An empty file for every kind, so the freshly installed generation is complete rather than partial.
 *
 * Built by mapping the kind constant rather than by listing ten literals, so a kind added to
 * {@link CROWDSTRIKE_KINDS} cannot be forgotten here — the failure would be a fresh
 * generation silently missing that kind's file, its old one only in the archive.
 *
 * @param at this run's ISO timestamp
 * @returns one empty file per declared kind
 *
 * @internal
 */
export function emptyCrowdstrikeFiles({ at }: { at: string }): Readonly<Record<CrowdstrikeKind, CrowdstrikeKindFile>> {
  const entries = CROWDSTRIKE_KINDS.map((kind) => [kind, emptyCrowdstrikeKindFile({ kind, updatedAt: at })] as const);
  // `as`: built from the platform's own exhaustive kind list, which Object.fromEntries widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<CrowdstrikeKind, CrowdstrikeKindFile>;
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetCrowdstrikeAtlas({
  paths,
  at,
}: {
  paths: CrowdstrikeAtlasPaths;
  at: string;
}): Result<CrowdstrikeResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyCrowdstrikeFiles({ at }),
    emptyManifest: initialCrowdstrikeManifest({ updatedAt: at }),
    paths,
    spec: CROWDSTRIKE_STORE_SPEC,
  });
}
