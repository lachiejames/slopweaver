/**
 * `atlas workos reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/workos/`.
 *
 * The artifact directory goes with it. It lives under the same root the archive moves, so the archived
 * generation keeps every artifact its own records reference, and the fresh generation starts with none.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyWorkosKindFile, initialWorkosManifest, type WorkosAtlasKind, type WorkosAtlasKindFile } from "./model.js";
import { WORKOS_STORE_SPEC, type WorkosAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type WorkosResetOutcome = AtlasResetOutcome;

/**
 * An empty file for every kind, so the freshly installed generation is complete rather than partial.
 *
 * Six literal keys rather than a loop with an assertion: the record must be TOTAL, and spelling it out is
 * what makes the compiler — rather than a cast — the thing that proves it. A seventh kind added to the
 * model fails to compile here, which is the intended way to find out.
 */
function emptyWorkosFiles({ at }: { at: string }): Readonly<Record<WorkosAtlasKind, WorkosAtlasKindFile>> {
  return {
    connection: emptyWorkosKindFile({ kind: "connection", updatedAt: at }),
    directory: emptyWorkosKindFile({ kind: "directory", updatedAt: at }),
    operation: emptyWorkosKindFile({ kind: "operation", updatedAt: at }),
    organization: emptyWorkosKindFile({ kind: "organization", updatedAt: at }),
    page: emptyWorkosKindFile({ kind: "page", updatedAt: at }),
    user: emptyWorkosKindFile({ kind: "user", updatedAt: at }),
  };
}

/**
 * Archive the current WorkOS atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetWorkosAtlas({ paths, at }: { paths: WorkosAtlasPaths; at: string }): Result<WorkosResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyWorkosFiles({ at }),
    emptyManifest: initialWorkosManifest({ updatedAt: at }),
    paths,
    spec: WORKOS_STORE_SPEC,
  });
}
