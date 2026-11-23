/**
 * `atlas twilio reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is Twilio's own is
 * only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/twilio/`.
 *
 * Screenshots are NOT archived with it. They are content-addressed by their own digest, so a later
 * generation referencing the same bytes finds them exactly where they were, and moving them would break
 * every artifact reference the archive itself carries.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyTwilioKindFile, initialTwilioManifest, type TwilioAtlasKind, type TwilioAtlasKindFile } from "./model.js";
import { TWILIO_STORE_SPEC, type TwilioAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type TwilioResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyTwilioFiles({ at }: { at: string }): Readonly<Record<TwilioAtlasKind, TwilioAtlasKindFile>> {
  return {
    account: emptyTwilioKindFile({ kind: "account", updatedAt: at }),
    api: emptyTwilioKindFile({ kind: "api", updatedAt: at }),
    method: emptyTwilioKindFile({ kind: "method", updatedAt: at }),
    page: emptyTwilioKindFile({ kind: "page", updatedAt: at }),
    resource: emptyTwilioKindFile({ kind: "resource", updatedAt: at }),
  };
}

/**
 * Archive the current Twilio atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetTwilioAtlas({ paths, at }: { paths: TwilioAtlasPaths; at: string }): Result<TwilioResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyTwilioFiles({ at }),
    emptyManifest: initialTwilioManifest({ updatedAt: at }),
    paths,
    spec: TWILIO_STORE_SPEC,
  });
}
