/**
 * The machine's one TypeScript compile lease, which a lap holds for its whole run.
 *
 * A whole-repo type pass peaks near 7.1 GB (`src/devLint/namedObjectParamsHeap.ts`), and on a 16 GB machine one
 * running beside a lap is what made Claude Code reap three seats' jobs for low memory. `scripts/tsc-owner.sh` takes
 * this lease before it starts a compiler, so at most one runs for this OS user; a lap takes it too, AFTER its own
 * lap lock (so a second lap still refuses at once rather than queueing) and keeps it until the lap ends, so no seat's
 * compile starts beside one. Both are taken before the lap's preflight, so the lease spans the reads, a batch's
 * preflight and the landing check too; a seat's compile waits that much longer, its 20-minute wait unchanged. The lap's own compiles are its descendants, and the owner inherits an ancestor's lease
 * rather than waiting on it — the lap's steps run one at a time (`./lapShell.ts`), so that inheritance is still one
 * compiler.
 *
 * The lease IS an operation lock (`../../../admit/operationLock.ts`) under this user's machine-wide lock directory
 * (`../../../stateRuntime.ts` `userRuntimeLockDir`), never stale while its holder lives: a lap's lease must not be
 * aged out under a lap that runs long. Bash cannot import it, so the owner speaks the same on-disk protocol —
 * a directory renamed into place, holding one token file of `{acquiredAtIso, pid, start}` — and names the lease
 * directory by {@link COMPILE_LEASE_KEY}'s hash, which a unit test holds equal to {@link compileLeasePath}.
 *
 * Why it lives in the lap's own module family: a lap run from a CLI whose lap modules differ from the head's is
 * refused (`./lapPlanSources.ts`), so once this lands every lap that runs takes the lease, with no old lap left to
 * start beside a compile.
 */
import { acquireOperationLockDetailed, type DetailedOperationLockResult } from "../../../admit/operationLock.js";
import { operationLockPath } from "../../../admit/operationLockPath.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { sleepSync } from "../../../lib/sleepSync.js";
import { userRuntimeLockDir } from "../../../stateRuntime.js";
import type { LapLockHandle, LapResource } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import { acquireLapLock } from "./lapLock.js";
import type { LapLock } from "./lapLockShape.js";

/** The operation-lock key the lease is taken under; `scripts/tsc-owner.sh` spells its hash. */
export const COMPILE_LEASE_KEY = "typescript-compile";

/**
 * How long a lap waits for a seat's compile to finish before refusing: one whole root compile at its owner's
 * timeout (1,140 s, `package.json`'s `build`/`typecheck`) plus its worst reap after TERM (10 s), with room over.
 * The same budget as the owner's own default `--lock-timeout-seconds`.
 */
export const COMPILE_LEASE_WAIT_MS = 1_200_000;

/** How often a waiting lap asks again. */
const COMPILE_LEASE_POLL_MS = 1000;

/**
 * Where the lease lives on disk.
 *
 * @param directory this user's machine-wide lock directory
 * @returns the lease's own directory, which may not exist yet
 */
export function compileLeasePath({ directory }: { directory: string }): string {
  // `home` is unused once `directory` is named; the lease is one per user, across every home.
  return operationLockPath({ directory, home: directory, key: COMPILE_LEASE_KEY });
}

/**
 * Wait for the compile lease, asking once per poll, until it is taken, refused, or the wait runs out.
 *
 * @param attempt one try at the lease, at the instant given
 * @param now the clock the wait is measured on
 * @param sleep the pause between tries
 * @param out where the one waiting line goes, printed only on the first contended try
 * @param waitMs how long contention is waited out before refusing
 * @returns the held lease, or why the lap does not hold it
 */
export function waitForCompileLease({
  attempt,
  now,
  sleep,
  out,
  waitMs,
}: {
  attempt: (args: { nowIso: string }) => DetailedOperationLockResult;
  now: () => Date;
  sleep: (args: { ms: number }) => void;
  out: (args: { line: string }) => void;
  waitMs: number;
}): Result<LapResource<undefined>, LapError> {
  const started = now().getTime();
  let announced = false;
  for (;;) {
    const taken = attempt({ nowIso: now().toISOString() });
    if (taken.isOk()) {
      const handle = taken.value;
      return ok({
        dispose: () => {
          handle.release();
          return Promise.resolve();
        },
        value: undefined,
      });
    }
    if (taken.error.code !== "LOCK_CONTENDED") {
      return err(LapErrors.compileLeaseUnavailable({ cause: taken.error.message }));
    }
    const waitedMs = now().getTime() - started;
    if (waitedMs >= waitMs) {
      return err(
        LapErrors.compileLeaseHeld({ holder: taken.error.message, waitedSeconds: Math.round(waitedMs / 1000) }),
      );
    }
    if (!announced) {
      announced = true;
      out({
        line: `github lap: waiting for the machine's TypeScript compile lease, ${taken.error.message} — one compile at a time; giving up after ${String(Math.round(waitMs / 1000))}s`,
      });
    }
    sleep({ ms: COMPILE_LEASE_POLL_MS });
  }
}

/**
 * Take the machine's one lap lock, then the compile lease, and release them in the reverse order.
 *
 * @param home the state home whose `laps/lock.json` is the machine's one lap lock
 * @param lock who is taking it
 * @param out where a waiting lap says what it waits on
 * @returns both held, as one resource, or the first refusal with nothing left held
 */
export function acquireLapMachine({
  home,
  lock,
  out,
}: {
  home: string;
  lock: Omit<LapLock, "nonce">;
  out: (args: { line: string }) => void;
}): Result<LapResource<LapLockHandle>, LapError> {
  const lap = acquireLapLock({ home, lock });
  if (lap.isErr()) {
    return err(lap.error);
  }
  // Every way out but both held releases the lap lock: a refusal below, and a throw (from `out`, say) too. Its release
  // is synchronous inside its promise, so it is done before this returns.
  try {
    const lease = leaseUnderLapLock({ home, out });
    if (lease.isErr()) {
      void lap.value.dispose();
      return err(lease.error);
    }
    return ok({
      dispose: async () => {
        await lease.value.dispose();
        await lap.value.dispose();
      },
      value: lap.value.value,
    });
  } catch (error: unknown) {
    void lap.value.dispose();
    throw error;
  }
}

/**
 * Take the compile lease in this user's lock directory, waiting out a seat's compile.
 *
 * @param home the state home the operation lock is keyed under, which a directory-named lease does not read
 * @param out where a waiting lap says what it waits on
 * @returns the held lease, or why the lap does not hold it
 */
function leaseUnderLapLock({
  home,
  out,
}: {
  home: string;
  out: (args: { line: string }) => void;
}): Result<LapResource<undefined>, LapError> {
  const directory = userRuntimeLockDir();
  if (directory.isErr()) {
    return err(LapErrors.compileLeaseUnavailable({ cause: directory.error.message }));
  }
  return waitForCompileLease({
    attempt: ({ nowIso }) =>
      acquireOperationLockDetailed({
        directory: directory.value,
        home,
        key: COMPILE_LEASE_KEY,
        nowIso,
        staleAfterMs: Number.POSITIVE_INFINITY,
      }),
    now: () => new Date(),
    out,
    sleep: sleepSync,
    waitMs: COMPILE_LEASE_WAIT_MS,
  });
}
