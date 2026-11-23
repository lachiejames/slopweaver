/**
 * `atlas airtable reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is Airtable's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/airtable/`.
 *
 * Screenshots go with it. They live under the same root the archive moves, so the archived generation keeps
 * every artifact its own records reference, and the fresh generation starts with none.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyAirtableKindFiles, initialAirtableManifest } from "./model.js";
import { AIRTABLE_STORE_SPEC, type AirtableAtlasPaths } from "./store.js";

/**
 * What a reset did.
 * @internal
 */
export type AirtableResetOutcome = AtlasResetOutcome;

/**
 * Archive the current Airtable atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetAirtableAtlas({
  paths,
  at,
}: {
  paths: AirtableAtlasPaths;
  at: string;
}): Result<AirtableResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyAirtableKindFiles({ at }),
    emptyManifest: initialAirtableManifest({ updatedAt: at }),
    paths,
    spec: AIRTABLE_STORE_SPEC,
  });
}
