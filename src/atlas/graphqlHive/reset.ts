/**
 * `atlas graphql-hive reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under
 * `$SLOPWEAVER_HOME/atlas/_superseded/graphql-hive/`.
 *
 * Both artifact directories go with it, screenshots and composed schemas alike. They live under the same
 * root the archive moves, so the archived generation keeps every artifact its own records reference, and
 * the fresh generation starts with none.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyHiveKindFile, type HiveAtlasKind, type HiveAtlasKindFile, initialHiveManifest } from "./model.js";
import { HIVE_STORE_SPEC, type HiveAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type HiveResetOutcome = AtlasResetOutcome;

/**
 * An empty file for every kind, so the freshly installed generation is complete rather than partial.
 *
 * Six literal keys rather than a loop with an assertion: the record must be TOTAL, and spelling it out is
 * what makes the compiler — rather than a cast — the thing that proves it. A seventh kind added to the
 * model fails to compile here, which is the intended way to find out.
 */
function emptyHiveFiles({ at }: { at: string }): Readonly<Record<HiveAtlasKind, HiveAtlasKindFile>> {
  return {
    operation: emptyHiveKindFile({ kind: "operation", updatedAt: at }),
    organization: emptyHiveKindFile({ kind: "organization", updatedAt: at }),
    page: emptyHiveKindFile({ kind: "page", updatedAt: at }),
    project: emptyHiveKindFile({ kind: "project", updatedAt: at }),
    target: emptyHiveKindFile({ kind: "target", updatedAt: at }),
    type: emptyHiveKindFile({ kind: "type", updatedAt: at }),
  };
}

/**
 * Archive the current GraphQL Hive atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetHiveAtlas({ paths, at }: { paths: HiveAtlasPaths; at: string }): Result<HiveResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyHiveFiles({ at }),
    emptyManifest: initialHiveManifest({ updatedAt: at }),
    paths,
    spec: HIVE_STORE_SPEC,
  });
}
