/**
 * The one mutual exclusion every atlas mutation takes, and the lease that lets a multi-step one keep it.
 *
 * ## Why this is not `./publishGuard.ts`
 *
 * `publishGuard.ts`'s {@link ../kit/publishGuard.js#withAtlasPublishLock} is OPT-IN and stays that way: an
 * atlas whose two channels do an expensive read-then-publish wraps the WHOLE pass in it so the second
 * channel does not do its provider work only to lose a race at the end. That is a cost control, and a
 * platform is right to choose it or not.
 *
 * This lock is the correctness boundary, so nothing chooses it. `store.ts`'s `publishAtlas` takes it on
 * every publish with no way to opt out, which is what makes a NEW atlas safe on the day it is written
 * rather than on the day somebody remembers to call a helper. MEASURED, which is why it moved:
 * thirteen platform stores took the opt-in lock and eight more atlas modules reached for
 * `admit/operationLock.ts` directly, so the coverage was real but partial and nothing said which atlas was
 * in which half.
 *
 * ## Its own KEY, and the other module's refusal
 *
 * `acquireOperationLock` is not reentrant — it is an atomic directory create, and a second acquisition in
 * the same process blocks on the first exactly as another process would. So this lock uses
 * `atlas:<platform>:mutate` while the opt-in one keeps `atlas:<platform>:publish`, and a pass holding the
 * opt-in lock across its read-and-publish does not deadlock the instant `publishAtlas` takes this one.
 * The two compose: the opt-in lock serialises the expensive half, this one plus the compare-and-swap in
 * `store.ts` makes the cheap half correct whether or not anybody took the expensive one.
 *
 * The acquisition itself goes THROUGH `withAtlasPublishLock` all the same, for its busy refusal rather than
 * for the lock: an operator should read one wording whichever of an atlas's two locks was held, and a
 * second copy of those lines here is exactly the kind of pair that drifts.
 *
 * ## The lease, and why it is not just a boolean
 *
 * `reset` and `restore` are multi-step directory transactions — archive the live generation, then install
 * another one — and both must be atomic against a concurrent publish, not merely atomic in their last
 * step. They therefore hold this lock across the whole transaction, and `reset` calls `publishAtlas` from
 * inside it. {@link withAtlasMutationLock} hands its body an {@link AtlasMutationLease} that `publishAtlas`
 * accepts INSTEAD of acquiring, so the nested call proceeds under the caller's lock rather than waiting on
 * it forever.
 *
 * A lease is branded with a module-private symbol, so a caller can receive one and hand it on but cannot
 * mint one: "I already hold the lock" has to be true rather than merely asserted. It also carries the home
 * and platform it was taken for, and {@link refuseForeignLease} refuses it anywhere else — otherwise one
 * atlas's transaction would silently wave a different atlas's publish straight past the mutex.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type AtlasPublishError, AtlasPublishErrors } from "./publishErrors.js";
import { withAtlasPublishLock } from "./publishGuard.js";

/**
 * The brand. Module-private, so {@link AtlasMutationLease} cannot be satisfied structurally from outside
 * this file — which is the whole point: the lease is evidence, and evidence a caller can write itself is
 * not evidence.
 */
declare const ATLAS_MUTATION_LEASE: unique symbol;

/** Proof that the caller already holds one atlas's mutation lock. Only {@link withAtlasMutationLock} mints one. */
export interface AtlasMutationLease {
  readonly [ATLAS_MUTATION_LEASE]: true;
  /** The state home the held lock lives under. */
  readonly home: string;
  /** The atlas the lock was taken for. */
  readonly platform: string;
}

/**
 * The lock key one atlas's mutations share.
 *
 * Distinct from `publishGuard.ts`'s `atlas:<platform>:publish` on purpose — see this module's header on why
 * sharing it would deadlock the opt-in wrapper the moment the publish it wraps took this lock too.
 *
 * @param platform the atlas's own platform name
 * @returns the key `admit/operationLock.ts` hashes
 */
export function atlasMutationLockKey({ platform }: { platform: string }): string {
  return `atlas:${platform}:mutate`;
}

/**
 * Refuse a lease taken for a different atlas, or under a different state home.
 *
 * A lease says "the mutation lock is held". It does not say WHICH lock unless this is checked, and a lease
 * that waves the wrong atlas's publish past the mutex is worse than no lease at all: it would look exactly
 * like exclusion while providing none.
 *
 * @param lease the lease a caller offered instead of acquiring
 * @param home the state home the publish is writing under
 * @param platform the atlas the publish is writing
 * @returns nothing when the lease is this atlas's, or why it cannot stand in for acquiring the lock
 */
export function refuseForeignLease({
  lease,
  home,
  platform,
}: {
  lease: AtlasMutationLease;
  home: string;
  platform: string;
}): Result<null, AtlasPublishError> {
  if (lease.platform === platform && lease.home === home) {
    return ok(null);
  }
  return err(AtlasPublishErrors.leaseForeign({ home, leaseHome: lease.home, leasePlatform: lease.platform, platform }));
}

/**
 * Hold one atlas's mutation lock across a whole directory transaction.
 *
 * @param home the state home the lock lives under
 * @param platform the atlas's own platform name, so a refusal says which atlas is busy
 * @param nowIso the instant of the attempt, which decides whether a held lock is stale enough to take over
 * @param mutate what to do while the lock is held, handed the lease that lets it publish without deadlocking
 * @returns whatever `mutate` returned, or the reason the lock could not be taken
 */
export function withAtlasMutationLock<T>({
  home,
  platform,
  nowIso,
  mutate,
}: {
  home: string;
  platform: string;
  nowIso: string;
  mutate: (input: { lease: AtlasMutationLease }) => Result<T>;
}): Result<T> {
  // Through `withAtlasPublishLock` rather than straight to `acquireOperationLock`, for the busy REFUSAL
  // rather than for the acquisition: the operator reads one wording whichever of this atlas's two locks was
  // held, and a second copy of those lines here is a shape that would drift from the first one.
  return withAtlasPublishLock({
    home,
    key: atlasMutationLockKey({ platform }),
    nowIso,
    platform,
    // The brand is a declared-only symbol, so there is no runtime value to put under it and no way to write
    // this object without an assertion. That is the design: the shape exists in the type system alone.
    // oxlint-disable-next-line no-unsafe-type-assertion
    publish: () => mutate({ lease: { home, platform } as AtlasMutationLease }),
  });
}
