/**
 * `atlas google-admin reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's
 * own is only the shape of an EMPTY generation — one file per declared kind, so the freshly installed
 * generation is complete rather than partial.
 *
 * The observation gate is NOT run here, which is worth stating rather than assuming: `resetAtlas` publishes
 * through `GOOGLE_ADMIN_STORE_SPEC`, which carries no guard, while `refuseStoredObservations` runs only inside
 * `publishGoogleAdminAtlas`. An empty generation holds no entity to judge, so nothing the gate refuses can
 * pass through a reset.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  byGoogleAdminKind,
  emptyGoogleAdminKindFile,
  type GoogleAdminAtlasKind,
  type GoogleAdminAtlasKindFile,
  initialGoogleAdminManifest,
} from "./model.js";
import { GOOGLE_ADMIN_STORE_SPEC, type GoogleAdminAtlasPaths } from "./store.js";

/**
 * What a reset did.
 * @internal
 */
export type GoogleAdminResetOutcome = AtlasResetOutcome;

/**
 * An empty file for every kind, so the freshly installed generation is complete rather than partial.
 *
 * Built by mapping the kind constant rather than by listing eighty-three literals, so a kind added to
 * {@link GOOGLE_ADMIN_ATLAS_KINDS} cannot be forgotten here — the failure would be a fresh generation
 * silently missing that kind's file, its old one only in the archive.
 *
 * @param at this run's ISO timestamp
 * @returns one empty file per declared kind
 * @internal
 */
export function emptyGoogleAdminFiles({
  at,
}: {
  at: string;
}): Readonly<Record<GoogleAdminAtlasKind, GoogleAdminAtlasKindFile>> {
  return byGoogleAdminKind({ build: ({ kind }) => emptyGoogleAdminKindFile({ kind, updatedAt: at }) });
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param at this run's ISO timestamp, which also names the archive directory
 * @param paths the resolved atlas paths
 * @returns where the prior generation was archived, or why the reset was refused
 */
export function resetGoogleAdminAtlas({
  at,
  paths,
}: {
  at: string;
  paths: GoogleAdminAtlasPaths;
}): Result<GoogleAdminResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyGoogleAdminFiles({ at }),
    emptyManifest: initialGoogleAdminManifest({ updatedAt: at }),
    paths,
    spec: GOOGLE_ADMIN_STORE_SPEC,
  });
}
