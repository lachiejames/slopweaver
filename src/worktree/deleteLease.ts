/**
 * The one lease every bulk delete on this machine shares, so two cleanups never act on one quiet fseventsd read.
 *
 * A governed delete holds it from its fseventsd read through its `rm` (`./governedDelete.ts`), and every `git worktree
 * remove` holds it for its whole in-place delete (`./reclaimTrash.ts`, `./inventory.ts`), so a prune, a `session
 * close-done`, a mirror prune and `worktree remove` — under any state home — take turns rather than stacking their
 * deletes. `worktree remove` still deletes its tree's `node_modules` in place,
 * under the lease and ungauged: it is the one operator-typed removal, and it predates the move-aside.
 *
 * It lives at one FIXED path per user, never under `os.tmpdir()`: `TMPDIR` is whatever a process inherited, so two
 * processes could each hold "the" lease in a different directory. The one override is
 * {@link DELETE_LEASE_ROOT_VAR}, which every test lane's setup points at its own sandbox, so a test never waits on
 * the operator's real prune.
 *
 * `busy` means one thing: a LIVE holder answered. Every other way the lock can refuse — a full disk, a permission
 * error, a corrupt lock record — is `unavailable`, so it never reads as a wait that ends. What
 * each delete does without the lease follows from what it can bound. A governed delete proceeds, gauged and
 * RATE-capped: each quantum is at most 1,000 counted entries, waits on its own fseventsd read, and is preceded by a
 * whole 2 s pause — the first one too — so each unleased cleanup averages at most 500 counted entries a second however late
 * fseventsd's CPU shows the load. It bounds each cleanup, not several together: N at once may each release one
 * quantum in the same instant. `git worktree remove` has no such
 * bound, so it does not run: its moved-aside `node_modules` goes to the trash for the governed emptier, and the
 * tracked tree waits for a lease.
 *
 * The lease is never stale while its holder lives, so a long delete is never overtaken; a dead holder's is recovered
 * at once by pid and start time (`../admit/operationLock.ts`).
 */
import { userInfo } from "node:os";
import { join } from "node:path";

import { acquireOperationLock } from "../admit/operationLock.js";

/** The environment variable a test lane sets to keep its leases inside its own sandbox. */
export const DELETE_LEASE_ROOT_VAR = "SLOPWEAVER_DELETE_LEASE_ROOT";

/** The operation-lock key of the lease. */
const DELETE_LEASE_KEY = "fseventsd-governed-delete";

/** How often a wait for the lease tries again. */
const LEASE_POLL_MS = 250;

/**
 * How long `git worktree remove` waits for the lease before keeping the tree for the next run. A governed delete
 * holds it for one quantum at a time, seconds, so a longer wait means fseventsd is holding a delete hot — exactly
 * when git should not start one.
 */
export const GIT_LEASE_WAIT_MS = 30_000;

/**
 * The opening of every refusal `acquireOperationLock` gives for a LIVE holder (`heldReason`), and the phrase of the
 * one it gives after rounds of holders coming and going. Anything else it refuses with is not contention.
 * `deleteLease.test.ts` holds a real lock and a corrupt one, so a reworded refusal reddens there.
 */
const CONTENTION = [/^held by pid /, /was never free at the instant/] as const;

/** One attempt at the lease: held, with its release; held by another process; or impossible to take at all. */
export type DeleteLease =
  | { readonly kind: "held"; readonly release: () => void }
  | { readonly kind: "busy" }
  | { readonly kind: "unavailable"; readonly why: string };

/**
 * Where the lease lives: {@link DELETE_LEASE_ROOT_VAR} when a test lane set it, else one fixed directory per user.
 *
 * @returns the lease's root directory
 */
export function deleteLeaseRoot(): string {
  const override = process.env[DELETE_LEASE_ROOT_VAR];
  if (override !== undefined && override !== "") {
    return override;
  }
  return join("/tmp", `slopweaver-delete-lease-${String(userInfo().uid)}`);
}

/**
 * Try once for the lease under `root`.
 *
 * @param root the lease's root directory
 * @returns the lease, `busy` while a live process holds it, or `unavailable` when it cannot be taken for any other reason
 */
export function claimDeleteLease({ root }: { root: string }): DeleteLease {
  try {
    // Never stale while its holder lives: a mirror prune may hold a delete an hour, and the default fifteen minutes
    // would hand a live holder's lease to a second delete. A dead holder is recovered at once.
    const lock = acquireOperationLock({
      home: root,
      key: DELETE_LEASE_KEY,
      nowIso: new Date().toISOString(),
      staleAfterMs: Number.POSITIVE_INFINITY,
    });
    if (lock.isErr()) {
      const reason = lock.error;
      return CONTENTION.some((pattern) => pattern.test(reason))
        ? { kind: "busy" }
        : { kind: "unavailable", why: reason };
    }
    return {
      kind: "held",
      release: () => {
        lock.value.release();
      },
    };
  } catch (error) {
    return { kind: "unavailable", why: error instanceof Error ? error.message : "the lease could not be created" };
  }
}

/**
 * Run an UNBOUNDED delete holding the lease, waiting up to `waitMs` for another holder to let it go. It never runs
 * without the lease — the caller decides what an `unavailable` one means, for the reason this module's header gives.
 *
 * @param root the lease's root directory
 * @param waitMs how long to wait for another holder
 * @param sleep blocks for the poll interval
 * @param act the delete to run under the lease
 * @returns `act`'s answer, `busy` when another holder kept the lease past `waitMs`, or `unavailable` with its reason
 */
export function withDeleteLease<T>({
  root,
  waitMs,
  sleep,
  act,
}: {
  root: string;
  waitMs: number;
  sleep: (input: { ms: number }) => void;
  act: () => T;
}): { kind: "ran"; value: T } | { kind: "busy" } | { kind: "unavailable"; why: string } {
  let waited = 0;
  for (;;) {
    const lease = claimDeleteLease({ root });
    if (lease.kind === "unavailable") {
      return lease;
    }
    if (lease.kind === "held") {
      try {
        return { kind: "ran", value: act() };
      } finally {
        lease.release();
      }
    }
    if (waited >= waitMs) {
      return { kind: "busy" };
    }
    sleep({ ms: LEASE_POLL_MS });
    waited += LEASE_POLL_MS;
  }
}
