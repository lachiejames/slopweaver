/**
 * `cloudflare reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is Cloudflare's own
 * is only the shape of an EMPTY generation. The archive lands under
 * `$SLOPWEAVER_HOME/atlas/_superseded/cloudflare/`.
 */
import type { Result } from "../../lib/result.js";
import { recordPerKind } from "../kit/kindRecord.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  CLOUDFLARE_KINDS,
  type CloudflareKind,
  type CloudflareKindFile,
  type CloudflareKindStatus,
  type CloudflareManifest,
  emptyCloudflareKindFile,
  initialCloudflareManifest,
} from "./model.js";
import { CLOUDFLARE_STORE_SPEC, type CloudflareAtlasPaths } from "./store.js";

/** What a reset did. */
export type CloudflareResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyCloudflareFiles({ at }: { at: string }): Readonly<Record<CloudflareKind, CloudflareKindFile>> {
  return recordPerKind({
    kinds: CLOUDFLARE_KINDS,
    valueFor: ({ kind }) => emptyCloudflareKindFile({ kind, updatedAt: at }),
  });
}

/**
 * The freshly installed generation's manifest — every kind marked as a genuine, complete success at being
 * deliberately empty, never as `lastAttempt: null`. A reset writes the file and the manifest together in
 * the same call, so there is nothing tentative about it — treating it as "never attempted" would make
 * `readCloudflareAtlas` report every kind as unpublished immediately after the one operation whose entire
 * point is to leave the atlas in a clean, known, complete state.
 */
function resetCloudflareManifest({ at }: { at: string }): CloudflareManifest {
  const initial = initialCloudflareManifest({ updatedAt: at });
  const stamped: CloudflareKindStatus = {
    digest: null,
    entityCount: 0,
    lastAttempt: { at, outcome: "ok", reasons: [] },
    lastSuccessAt: at,
  };
  return { ...initial, kinds: recordPerKind({ kinds: CLOUDFLARE_KINDS, valueFor: () => stamped }) };
}

/**
 * Archive the current Cloudflare atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetCloudflareAtlas({
  paths,
  at,
}: {
  paths: CloudflareAtlasPaths;
  at: string;
}): Result<CloudflareResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyCloudflareFiles({ at }),
    emptyManifest: resetCloudflareManifest({ at }),
    paths,
    spec: CLOUDFLARE_STORE_SPEC,
  });
}
