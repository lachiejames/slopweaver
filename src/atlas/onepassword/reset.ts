/**
 * `onepassword reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/onepassword/`.
 *
 * The empty generation passes the sensitivity gate trivially, which is worth stating rather than assuming:
 * `resetAtlas` publishes through the same guarded spec as a real sync, so a reset cannot become a way to
 * write past the gate.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  emptyOnepasswordKindFile,
  initialOnepasswordManifest,
  type OnepasswordKind,
  type OnepasswordKindFile,
} from "./model.js";
import { type OnepasswordAtlasPaths, onepasswordStoreSpec } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type OnepasswordResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyOnepasswordFiles({ at }: { at: string }): Readonly<Record<OnepasswordKind, OnepasswordKindFile>> {
  return {
    event: emptyOnepasswordKindFile({ kind: "event", updatedAt: at }),
    group: emptyOnepasswordKindFile({ kind: "group", updatedAt: at }),
    "group-member": emptyOnepasswordKindFile({ kind: "group-member", updatedAt: at }),
    integration: emptyOnepasswordKindFile({ kind: "integration", updatedAt: at }),
    user: emptyOnepasswordKindFile({ kind: "user", updatedAt: at }),
    vault: emptyOnepasswordKindFile({ kind: "vault", updatedAt: at }),
    "vault-grant": emptyOnepasswordKindFile({ kind: "vault-grant", updatedAt: at }),
  };
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetOnepasswordAtlas({
  paths,
  at,
}: {
  paths: OnepasswordAtlasPaths;
  at: string;
}): Result<OnepasswordResetOutcome> {
  const emptyFiles = emptyOnepasswordFiles({ at });
  return resetAtlas({
    at,
    emptyFiles,
    emptyManifest: initialOnepasswordManifest({ updatedAt: at }),
    paths,
    spec: onepasswordStoreSpec({ denylist: [], files: emptyFiles }),
  });
}
