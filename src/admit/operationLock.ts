/**
 * A simple, local, repo-scoped operation lock. Not a distributed lock, not a queue — it exists so two
 * concurrent invocations of `github stack push`/`sync`/`adopt` against the SAME repository cannot interleave
 * their local git rewrites and pushes, which is the actual root cause behind an otherwise hard-to-diagnose
 * class of local/remote drift (found by an adversarial review pass, reproduced against a real local repo:
 * a slower writer that started from stale remote state can still force-push its own divergent result under
 * a lease read late enough to have already caught up to a faster writer's push).
 *
 * Deliberately minimal, per explicit direction: it only protects processes sharing one `$SLOPWEAVER_HOME` on
 * one machine — correctness against another machine still rests on Git/GitHub's own mechanics (the same
 * boundary force-with-lease already has), and a genuinely distributed lock, a queue, or anything more
 * elaborate than a plain mutex with stale-lock recovery would be solving a problem nobody has yet at the
 * cost of new fragility, which is the exact overcorrection this feature is trying to avoid.
 *
 * ## The lock is a DIRECTORY renamed into place, so a stale one is removed by name and never overwritten
 *
 * Stale recovery used to read the holder, judge it dead or aged, and then write this process's lock over it
 * with a plain `writeFileSync` — so two contenders that both read the same leftover lock both overwrote it
 * and both entered the guarded body. MEASURED: eight `tsx` processes racing at one lock seeded
 * with a dead pid produced two holders over the identical 150ms interval, both reporting the same
 * `stoleFromPid`. Codex had built the same interleaving against `turn/dispatchBudget.ts`'s budget-warn
 * writes, and every one of this lock's callers — `github stack push`/`sync`/
 * `adopt`, the recipe slot writers, the atlas syncs — was exposed the same way.
 *
 * POSIX has no "delete this file only if it is still the one I read", so no file-based takeover becomes
 * exclusive by adding a check before the write — a rename-then-verify-identity shape was prototyped and
 * displaced a fresh holder's live lock on three runs of three. What POSIX does have is `rename(2)` of a
 * DIRECTORY: it succeeds when the target is absent or an EMPTY directory and fails `ENOTEMPTY` when the
 * target holds anything, an atomic create-or-replace-empty. So the lock at `<key>.lock` is a directory
 * holding exactly one file, named by the holder's own token (`<pid>-<nonce>`) and carrying the pid and
 * instant as JSON. A contender stages that file in a private directory and renames the directory into
 * place, and that rename is the ONLY way in — first attempt or takeover alike. A stale holder is taken over
 * by unlinking ITS token file, a name no other holder shares, and then `rmdir` of the lock directory, which
 * the kernel refuses unless it is empty. Two contenders at one stale lock both unlink the same token (one
 * `ENOENT`), both `rmdir` (one `ENOENT`), and both rename in — exactly one succeeds, and the other reads
 * that winner as a live holder. A fresh holder that renames onto the transiently empty directory is simply
 * the winner, and the takeover's own `rmdir` then fails `ENOTEMPTY` against it. No branch ever removes a
 * file it did not name, and no branch ever writes over a directory another process filled. Release unlinks
 * only its own token, so a late release by an aged-out holder, a same-process re-acquisition after a
 * takeover, or a second call of an old release callback removes nothing of a later holder's. Re-run the
 * race: `yarn vitest run --config config/vitest/subprocess.ts operationLockRace`.
 *
 * The claim is bounded, and the bound is the policy that was already here: stale recovery creates no
 * additional concurrent owner. A LIVE holder older than `staleAfterMs` is still taken over, its lease
 * revoked without fencing while its guarded body may be running, exactly as before this change.
 *
 * ## The one exception is the previous shape, and it is stated rather than closed
 *
 * A lock left behind as a plain FILE by the previous shape is judged the old way and, when stale, removed
 * by a plain `unlink` — after a `link` of it into this attempt's candidate directory has re-read the record
 * and found it the one judged. `link` refuses a directory outright, so a directory-shaped lock seated in
 * the meantime is never touched (a `rename` aside was tried first and moved a fresh holder's whole
 * directory into a loser's candidate, where the loser's cleanup destroyed it). What the re-read cannot close
 * is a checkout still running the OLD code, which shares this home for as long as its worktree lives and
 * overwrites a stale file IN PLACE: a record it writes between the re-read and the `unlink` is removed with
 * the file, and that old checkout runs beside the next holder. That schedule needs an old checkout, a
 * leftover file and a write inside one syscall window, it is no worse than what two old checkouts already
 * do to each other, and it ends when the last old worktree is gone. An old checkout meeting a directory at
 * the path refuses ("could not be read to check its age") on its held path and throws `EISDIR` on its
 * stale path, so it never seats a file over a directory. Codex built the schedule; it is stated here rather than closed because closing it needs the old code to change.
 *
 * Reading that file is TWO syscalls — the `readdirSync` that discovers the path is not a directory, then a
 * `readFileSync` of it — so the path can change shape between them, and the second call's errno is the only
 * thing that says how. It is classified rather than collapsed: a file a peer has already unlinked reads as
 * ABSENT and one a peer has replaced with its own lock directory reads as IN-FLUX, both of which go round
 * again, while a genuine read fault still refuses. Collapsing all three into one refusal is what reddened
 * the subprocess lane — see `./operationLockState.ts`'s `readPlainFileLock` for the
 * measurement.
 *
 * ## A refusal is PERSISTED, so its liveness claim is anchored rather than present-tense
 *
 * The contention refusal (`./operationLockHeld.ts`) does not stay in a terminal: an atlas sync copies it into that platform's
 * `manifest.kinds[].lastAttempt.reasons`, where it is read days later. MEASURED — the Vanta
 * manifest asserted `pid 41038 ... is STILL RUNNING` while `ps -p 41038` returned nothing, so a durable
 * record claimed live contention over a process long gone. A present tense is only true at the instant it
 * is written, and AGENTS.md's rule is to anchor a claim rather than describe a state, so the line names the
 * instant the check ran. Reproduce the class:
 * `grep -rho 'it was ALIVE when checked at [^)]*' ~/.slopweaver/atlas --include=manifest.json | head`.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { ownProcessStart, unstampedLeaseRefusal } from "./lockHolder.js";
import {
  DEFAULT_STALE_AFTER_MS,
  type LockContents,
  type OperationLockAcquireError,
  OperationLockAcquireErrors,
} from "./operationLockHeld.js";
import { operationLockPath } from "./operationLockPath.js";
import { judgeOccupant } from "./operationLockTakeover.js";
import { guardianFromEnvironment, type ProcessGuardian } from "./processGuardian.js";

/** Who this process is, as a record it writes names it: its own start stamp, and the guardian its environment names. */
interface WriterIdentity {
  readonly start: string | undefined;
  readonly guardian: ProcessGuardian | undefined;
}

/** What acquiring the lock actually did — released, and if a stale lock was taken over, from which pid. */
export interface OperationLockHandle {
  /**
   * Release the lock. A release that genuinely fails warns rather than throws; `warn` is where that line goes,
   * standard error when absent. A caller whose writer filters what it prints passes it (the warning quotes the lock
   * path, which comes from the home the caller named): `github stack push` passes its credential-withholding `out`.
   */
  readonly release: (args?: { readonly warn?: ReleaseWarn }) => void;
  readonly stoleFromPid: number | undefined;
  /**
   * Whether this handle's own token still stands in the lock — false once released, or once a later holder took an
   * aged-out lease over. A holder whose body may outlive its lease checks it before each write it must not duplicate:
   * a takeover is unfenced, so this one `stat` is the fence (`../monitor/firedPassLock.ts`).
   */
  readonly stillHeld: () => boolean;
}

/**
 * Where a failed release's warning line is written.
 *
 * @internal
 */
export type ReleaseWarn = (args: { readonly line: string }) => void;

export type OperationLockResult = Result<OperationLockHandle, string>;

/** {@link OperationLockResult} with the refusal still typed. */
export type DetailedOperationLockResult = Result<OperationLockHandle, OperationLockAcquireError>;

/** A per-process counter, so two acquisitions in ONE process can never share a token whatever the random
 * half does. The random half is what separates two PROCESSES; this is what separates two calls, and it is
 * exact rather than probabilistic — ownership resting on 128 bits of
 * randomness alone is an assumption rather than a guarantee. */
let acquisitionsThisProcess = 0;

/** How many times one attempt may go round after another process moved the lock under it. Every extra round
 * is caused by another process acting between two of this one's syscalls, so a bound this size is only
 * reached under contention no caller here has a use for; exhausting it refuses rather than spins. */
const MAX_ACQUIRE_ROUNDS = 8;

/** Whether a rename's failure means the path is occupied (judge it) rather than broken (refuse). Linux
 * answers a populated directory with either `ENOTEMPTY` or `EEXIST`; a plain-file lock answers `ENOTDIR`. */
function renameFoundOccupant({ error }: { error: unknown }): boolean {
  const code = isRecord(error) ? error["code"] : undefined;
  return code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOTDIR";
}

/** What one attempt to install the candidate directory did: took the lock, found it occupied, or failed. */
type InstallOutcome =
  { readonly kind: "installed" } | { readonly kind: "occupied" } | { readonly kind: "failed"; readonly reason: string };

/**
 * Try to install this attempt's candidate directory as the lock, and say which of the three things happened.
 *
 * The rename is the ONLY way in — see the module header. A failure that is not "something is already there"
 * is a real filesystem fault and is reported as one rather than judged as contention.
 *
 * @returns whether the lock was taken, is occupied, or the install failed outright
 */
function installCandidate({ candidate, path }: { candidate: string; path: string }): InstallOutcome {
  try {
    renameSync(candidate, path);
  } catch (error: unknown) {
    if (renameFoundOccupant({ error })) {
      return { kind: "occupied" };
    }
    return { kind: "failed", reason: `could not install the lock at ${path}: ${String(error)}` };
  }
  return { kind: "installed" };
}

/** Whether the candidate directory has become the lock — read by the cleanup, which must never touch a
 * pathname this attempt no longer owns. A holder rather than a return value because the cleanup runs from a
 * `finally` around the contest. */
interface CandidateState {
  installed: boolean;
}

/**
 * Mint this attempt's candidate: a private directory holding one file named by its token.
 *
 * `mkdtemp` rather than a name this module composes, so two acquisitions in one process, or one process
 * reusing a pid, can never stage under the same pathname.
 *
 * @returns the candidate directory's path
 */
function mintCandidate({
  identity,
  path,
  token,
  nowIso,
}: {
  identity: WriterIdentity;
  path: string;
  token: string;
  nowIso: string;
}): string {
  // Its rename is an INSTALL, not a durable write: the lock is process-lifetime state judged by pid and age,
  // so `writeFileAtomic`'s fsync discipline buys nothing here and cannot rename a directory anyway.
  const candidate = mkdtempSync(`${path}.candidate-`);
  const lock: LockContents = {
    acquiredAtIso: nowIso,
    guardian: identity.guardian,
    pid: process.pid,
    start: identity.start,
  };
  writeFileSync(join(candidate, token), JSON.stringify(lock), { flag: "wx" });
  return candidate;
}

/**
 * Hand back the lock this attempt's rename just installed, once its own token is confirmed standing in it.
 *
 * @param stoleFromPid the stale holder's pid an earlier round cleared, if any
 * @returns the release handle, or the refusal when the installed lock does not carry this attempt's token
 */
function claimInstalled({
  path,
  stoleFromPid,
  token,
}: {
  path: string;
  stoleFromPid: number | undefined;
  token: string;
}): DetailedOperationLockResult {
  // Owning the lock means this attempt's own token is what stands in it, not merely that a rename
  // succeeded. The check costs one `stat` and turns a claim about a syscall into one about the state.
  if (!existsSync(join(path, token))) {
    return err(
      OperationLockAcquireErrors.refused({
        message: `the lock at ${path} was installed without this attempt's own record in it — something removed it in the instant between, so this attempt does not hold it`,
      }),
    );
  }
  // Released at most ONCE per handle. A caller's `finally` that runs twice, or a handle kept past its
  // release, then cannot reach whatever holds the lock later — without this the guarantee would rest on
  // the token never repeating, which is a probability rather than a property.
  let released = false;
  return ok({
    release: (args) => {
      if (!released) {
        released = true;
        releaseLock({ path, token, warn: args?.warn });
      }
    },
    stillHeld: () => !released && existsSync(join(path, token)),
    stoleFromPid,
  });
}

/**
 * Install the candidate, or judge and clear what is in the way, until one of them settles the attempt.
 *
 * Every round is an install attempt: a stale holder cleared by this attempt or another simply means going
 * round again, and the bound is what stops that being unbounded.
 *
 * @returns the handle, or the reason this attempt does not hold the lock
 */
function contestLock({
  candidate,
  nowIso,
  path,
  staleAfterMs,
  state,
  token,
}: {
  candidate: string;
  nowIso: string;
  path: string;
  staleAfterMs: number;
  state: CandidateState;
  token: string;
}): DetailedOperationLockResult {
  let stoleFromPid: number | undefined;
  for (let round = 0; round < MAX_ACQUIRE_ROUNDS; round += 1) {
    const install = installCandidate({ candidate, path });
    if (install.kind === "failed") {
      return err(OperationLockAcquireErrors.refused({ message: install.reason }));
    }
    if (install.kind === "installed") {
      state.installed = true;
      return claimInstalled({ path, stoleFromPid, token });
    }
    const outcome = judgeOccupant({ candidate, nowIso, path, staleAfterMs });
    if (outcome.kind === "refuse") {
      return err(outcome.reason);
    }
    stoleFromPid = outcome.clearedPid ?? stoleFromPid;
  }
  // REFUSED, not contended: from here churn cannot be told from a state that never changes (a dangling token, an
  // occupant nothing can remove), and deferring one of those hides it for good.
  return err(
    OperationLockAcquireErrors.refused({
      message: `the lock at ${path} was never free at the instant this attempt tried it, across ${String(MAX_ACQUIRE_ROUNDS)} rounds of other holders coming and going — refusing rather than spinning`,
    }),
  );
}

/**
 * Acquire the lock for one key, refusing while another live holder has it and taking over a stale one.
 *
 * @param home the state home the lock lives under, unless `directory` names another place
 * @param directory where a process-lifetime lock lives instead, the home's OS runtime directory
 * (`../stateRuntime.ts`), so the home holds nothing that only matters while one process lives
 * @param key the caller-chosen lock key (this module hashes it; the caller need not)
 * @param nowIso the instant of the attempt
 * @param staleAfterMs how old a held lock may be before this call may take it over
 * @returns a handle to release the lock, the reason it is still held, or why this process may not take a never-stale one
 */
export function acquireOperationLock({
  home,
  directory,
  key,
  nowIso,
  staleAfterMs,
}: {
  home: string;
  directory?: string | undefined;
  key: string;
  nowIso: string;
  staleAfterMs?: number | undefined;
}): OperationLockResult {
  const path = operationLockPath({ directory, home, key });
  const token = nextToken();
  // A staging fault THROWS here, as it always has: callers of this string form catch it as a filesystem fault
  // (`orgHealth/readLock.ts` answers READ_LOCK_UNAVAILABLE), and an error answer would read as a held lock.
  return stageCandidate({ nowIso, path, staleAfterMs, token })
    .andThen((candidate) => contestCandidate({ candidate, nowIso, path, staleAfterMs, token }))
    .mapErr((error) => error.message);
}

/**
 * {@link acquireOperationLock}, with the refusal typed: `LOCK_CONTENDED` only for a live holder within its
 * threshold, `LOCK_REFUSED` for everything else, every round exhausted included. A caller that answers
 * "not yet" on contention (`atlas vanta sync`'s exit 4) must never answer it on a refusal, which no rerun clears.
 *
 * @param home the state home the lock lives under, unless `directory` names another place
 * @param directory where the lock lives instead — a cache root whose own state it guards (`../codexPlugin/sync.ts`)
 * @param key the caller-chosen lock key (this module hashes it; the caller need not)
 * @param nowIso the instant of the attempt
 * @param staleAfterMs how old a held lock may be before this call may take it over
 * @returns a handle to release the lock, or why this attempt does not hold it, typed by whether a rerun can
 */
export function acquireOperationLockDetailed({
  home,
  directory,
  key,
  nowIso,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
}: {
  home: string;
  directory?: string | undefined;
  key: string;
  nowIso: string;
  staleAfterMs?: number;
}): DetailedOperationLockResult {
  const path = operationLockPath({ directory, home, key });
  const token = nextToken();
  // A filesystem fault while staging (an unwritable home, a file where the lock directory belongs) is a
  // refusal a rerun cannot be trusted to clear, so it is typed as one rather than thrown past the caller.
  let staged: Result<string, OperationLockAcquireError>;
  try {
    staged = stageCandidate({ nowIso, path, staleAfterMs, token });
  } catch (error: unknown) {
    return err(OperationLockAcquireErrors.stagingFailed({ error, path }));
  }
  return staged.andThen((candidate) => contestCandidate({ candidate, nowIso, path, staleAfterMs, token }));
}

/** This acquisition's token: the pid, a per-process counter and a random half (see `acquisitionsThisProcess`). */
function nextToken(): string {
  acquisitionsThisProcess += 1;
  return `${String(process.pid)}-${String(acquisitionsThisProcess)}-${randomBytes(16).toString("hex")}`;
}

/**
 * Make the lock directory and mint this attempt's candidate in it, refusing a lease this process may not take.
 * A filesystem fault THROWS — each public form decides what a staging fault is to its own callers.
 *
 * @param path the lock path the candidate is minted beside, whose parent is the lock directory made here
 * @param token the name of the one file the candidate holds
 * @returns the candidate directory, or the refusal of an unstamped never-stale lease
 */
function stageCandidate({
  nowIso,
  path,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  token,
}: {
  nowIso: string;
  path: string;
  staleAfterMs?: number | undefined;
  token: string;
}): Result<string, OperationLockAcquireError> {
  mkdirSync(dirname(path), { recursive: true });
  // ONE identity, read once, decides the refusal and is what the record carries — never two reads that could differ.
  const identity: WriterIdentity = {
    guardian: guardianFromEnvironment({ env: process.env }),
    start: ownProcessStart(),
  };
  const unstamped = unstampedLeaseRefusal({ guardian: identity.guardian, path, staleAfterMs, start: identity.start });
  if (unstamped !== undefined) {
    return err(OperationLockAcquireErrors.refused({ message: unstamped }));
  }
  return ok(mintCandidate({ identity, nowIso, path, token }));
}

/**
 * Contest the lock with a staged candidate, and remove the candidate afterwards unless it became the lock.
 *
 * @param candidate the staged directory {@link stageCandidate} minted
 * @returns a handle to release the lock, or why this attempt does not hold it
 */
function contestCandidate({
  candidate,
  nowIso,
  path,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  token,
}: {
  candidate: string;
  nowIso: string;
  path: string;
  staleAfterMs?: number | undefined;
  token: string;
}): DetailedOperationLockResult {
  // Once the rename lands, the candidate PATHNAME is no longer this attempt's: the directory moved to the
  // lock path, and `mkdtemp` may hand the freed name straight to another process. Cleaning it up after a
  // success is therefore a write into whatever now stands there — an ABA interleaving: A installs, pauses, B mints the same freed name, A's cleanup
  // deletes B's token, and B goes on to install an EMPTY directory that a third contender renames over.
  const state: CandidateState = { installed: false };
  try {
    return contestLock({ candidate, nowIso, path, staleAfterMs, state, token });
  } finally {
    // ONLY while the candidate is still this attempt's. Never let a failure here replace a handle already
    // returned with an exception that leaves the lock held.
    if (!state.installed) {
      try {
        rmSync(candidate, { force: true, recursive: true });
      } catch {
        // Inert clutter in the lock directory, never at the lock path itself.
      }
    }
  }
}

/**
 * Release the lock only if this acquisition still owns it: the token file is a name only this acquisition
 * wrote, so unlinking it can never remove another holder's, and the directory goes only if that left it
 * empty — a fresh holder that has already renamed onto it makes the `rmdir` fail `ENOTEMPTY`, which is the
 * right answer. Deliberately never throws (it always runs from a caller's `finally`, where a thrown error
 * here would replace whatever result or error the guarded operation already produced) — but a failure that
 * ISN'T "already gone" or "someone else owns it now" is a genuine problem, not a no-op, so it is surfaced
 * rather than silently swallowed. The stale-takeover path, not a second removal attempt from here, is the
 * recovery for a lock a genuine failure leaves behind.
 */
function releaseLock({ path, token, warn }: { path: string; token: string; warn: ReleaseWarn | undefined }): void {
  try {
    unlinkSync(join(path, token));
  } catch (error: unknown) {
    if (isRecord(error) && (error["code"] === "ENOENT" || error["code"] === "ENOTDIR")) {
      return;
    }
    warnRelease({ error, path, warn });
    return;
  }
  try {
    rmdirSync(path);
  } catch (error: unknown) {
    if (isRecord(error) && (error["code"] === "ENOENT" || error["code"] === "ENOTEMPTY")) {
      return;
    }
    warnRelease({ error, path, warn });
  }
}

function warnRelease({ error, path, warn }: { error: unknown; path: string; warn: ReleaseWarn | undefined }): void {
  const line = `warning: could not release the stack operation lock at ${path}: ${String(error)}`;
  try {
    if (warn !== undefined) {
      warn({ line });
      return;
    }
    process.stderr.write(`${line}\n`);
  } catch {
    // Even the diagnostic write failed (e.g. stderr itself is gone) — nothing left to do but not throw.
  }
}
