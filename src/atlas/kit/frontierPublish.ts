/**
 * The PUBLISH half of a frontier walk: the manifest statuses one walk earns and the read-merge-publish
 * critical section around them.
 *
 * Split from `frontierWalk.ts`, which keeps the walk engine and the page projection. Neither function here
 * reads a page, a transport or a walk result — each is pure over its own inputs — so they share nothing with
 * the engine but the atlas that calls both.
 */
import type { Result } from "../../lib/result.js";

/**
 * The two manifest statuses one walk earns, on the kinds it writes.
 *
 * Kit-owned because it was copied, and the decision inside it is the one a copy loses: a signed-out walk
 * records an ATTEMPT and NO success. It ran, and it reached nothing, and those are different from each
 * other and from never having run — a walk that advanced `lastSuccessAt` anyway would let
 * `surfaceFill.ts`'s derived status flip on a walk that saw a login page forty times.
 *
 * @param methodCount how many method rows the merge produced
 * @param pageCount how many page rows the merge produced
 * @param signedOut whether this walk established that nobody is signed in
 * @param at this run's ISO timestamp
 * @param heldMethodSuccess the method kind's success instant before this walk
 * @param heldPageSuccess the page kind's success instant before this walk
 * @param signedOutReason what a reader of the manifest alone should do about a lost session
 * @returns the two statuses, ready to stamp onto the atlas's own manifest shape. The `reasons` arrays are
 *   MUTABLE on purpose: every atlas's stored manifest schema declares one, and returning readonly arrays
 *   would make each caller copy them back — which is a fifteen-line identical block in every atlas that
 *   uses this, and the clone ratchet is right to refuse it.
 */
export function walkedKindStatuses({
  methodCount,
  pageCount,
  signedOut,
  at,
  heldMethodSuccess,
  heldPageSuccess,
  signedOutReason,
}: {
  methodCount: number;
  pageCount: number;
  signedOut: boolean;
  at: string;
  heldMethodSuccess: string | null;
  heldPageSuccess: string | null;
  signedOutReason: string;
}): {
  method: {
    digest: null;
    entityCount: number;
    lastAttempt: { at: string; outcome: "ok"; reasons: string[] };
    lastSuccessAt: string | null;
  };
  page: {
    digest: null;
    entityCount: number;
    lastAttempt: { at: string; outcome: "failed" | "ok"; reasons: string[] };
    lastSuccessAt: string | null;
  };
} {
  return {
    method: {
      digest: null,
      entityCount: methodCount,
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: signedOut ? heldMethodSuccess : at,
    },
    page: {
      digest: null,
      entityCount: pageCount,
      lastAttempt: { at, outcome: signedOut ? "failed" : "ok", reasons: signedOut ? [signedOutReason] : [] },
      lastSuccessAt: signedOut ? heldPageSuccess : at,
    },
  };
}

/**
 * The read-merge-publish critical section every frontier walk's publisher runs.
 *
 * Kit-owned because it was copied whole. It used to carry a `refuseIfMoved` seam of its own, called between
 * the merge and the publish, and the ORDER of those two was the property a copy lost: a publisher that
 * guarded before merging still published files derived from a generation another writer had replaced. That
 * seam is gone because the compare-and-swap moved INSIDE `store.ts`'s `publishAtlas`, where it runs under
 * the same held lock as the write — a guard a caller runs before calling the publisher is a
 * time-of-check-to-time-of-use gap however carefully it is ordered, and one no walk can close from here.
 * What the walk still owes is an honest `derivedFrom`, which is the snapshot its own `merge` folded onto.
 *
 * Every step is a seam so this stays pure over its inputs and each atlas keeps its own store, schemas and
 * file shapes.
 *
 * @param merge fold this walk's browser-channel rows onto both kinds the walk writes
 * @param filesFor the kind files to publish, given the merged entities
 * @param manifestFor the manifest to publish, given the merged counts
 * @param publish write the files and then the manifest
 * @returns the paths written, or every reason nothing was
 */
export function publishWalkedGeneration<TEntity, TFiles, TManifest>({
  merge,
  filesFor,
  manifestFor,
  publish,
}: {
  merge: () => Result<{ methods: readonly TEntity[]; pages: readonly TEntity[] }>;
  filesFor: (input: { methods: readonly TEntity[]; pages: readonly TEntity[] }) => TFiles;
  manifestFor: (input: { methodCount: number; pageCount: number }) => TManifest;
  publish: (input: { files: TFiles; manifest: TManifest }) => Result<readonly string[]>;
}): Result<{ methodCount: number; pageCount: number; written: readonly string[] }> {
  return merge().andThen(({ methods, pages }) =>
    publish({
      files: filesFor({ methods, pages }),
      manifest: manifestFor({ methodCount: methods.length, pageCount: pages.length }),
    }).map((written) => ({ methodCount: methods.length, pageCount: pages.length, written })),
  );
}
