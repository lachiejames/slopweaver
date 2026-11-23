/**
 * Who holds an operation lock: a pid AND that process's start, so a pid the OS has since handed to another process
 * is a dead holder rather than a live one, and so is a zombie — exited, unreaped, and still answering signal 0. Both
 * are `../talk/relayLease.ts`'s one probe, `processStartOf`, which every holder check in the tree reads. Split from
 * `./operationLock.ts`, which decides what a held lock means.
 */
import { holderRunning, processStartOf } from "../talk/relayLease.js";

/** This process's own start stamp once `ps` has given it: it cannot change while the process lives. A failed read is
 * not kept, so the next call asks again rather than leaving every later lock this process writes unstamped. */
let ownStart: string | undefined;

/**
 * This process's start stamp, as a holder record carries it.
 *
 * @returns the stamp `ps` prints for this process, or `undefined` when it printed none
 */
export function ownProcessStart(): string | undefined {
  if (ownStart !== undefined) {
    return ownStart;
  }
  ownStart = processStartOf({ pid: process.pid }).start;
  return ownStart;
}

/**
 * Whether the process that wrote a lock is still running.
 *
 * `process.kill(pid, 0)` sends no signal; it only asks the kernel whether the pid is addressable. ESRCH
 * means no such process. EPERM means it EXISTS but belongs to another user, which is the answer that
 * matters here, so it counts as alive.
 *
 * Two properties worth stating rather than leaving to be rediscovered. **A recycled pid reads as dead** when the
 * record carries its holder's start stamp and `ps` gives a different one now — the relay lease's rule
 * (`../talk/relayLease.ts` `holderRunning`), needed here once a lease may be declared never stale: a dead holder
 * whose pid an unrelated long-lived process inherited would otherwise wedge that lease for good. A stamp missing then or now leaves the pid alone to decide, which errs toward refusing, never toward two
 * holders — and `./operationLockHeld.ts`'s `heldReason` ages such a record out on the ordinary window even under a
 * never-stale lease, since its pid alone may since be another process's. And a lock file carries **no host**, so this is only meaningful because
 * `$SLOPWEAVER_HOME` is local — if it ever became shared storage, a pid from another machine would be
 * unreadable here and this check would have to carry a host alongside it.
 *
 * **The refusal has to SAY this ran.** A check nobody can see from the outside is indistinguishable from a
 * check nobody wrote, and the cost is measured rather than argued: over one week the fleet read this refusal
 * 184 distinct times behind 93 distinct holders, and EVERY holder released before the threshold — the
 * longest age any refusal ever reported was 878.4s against the 900s bound, so the stale path never fired
 * once. A session reading only the age half of the line concluded the door had no liveness check, checked
 * `ps` on two holders after they had finished, found them gone, and filed a fleet finding asking for the
 * check `holderIsAlive` was already running.
 *
 * The refusals are journalled nowhere, so the only record of them is the transcripts that read them.
 * Capture the lines once, then count each way:
 * `grep -rho "held by pid [0-9]* since 2026-09-0[1-7][^)]*)" ~/.claude/projects --include="*.jsonl" |
 * sort -u > /tmp/lw.txt`, then `wc -l < /tmp/lw.txt` for the refusals,
 * `awk '{print $4, $6}' /tmp/lw.txt | sort -u | wc -l` for the holders, and
 * `grep -o "[0-9]*ms old" /tmp/lw.txt | grep -o "[0-9]*" | sort -n | tail -1` for the longest age in ms.
 *
 * @param pid the pid recorded in the lock file
 * @param start the start stamp recorded beside it, when it was
 * @returns true when the holder is still addressable and is still the process that wrote the lock
 */
export function holderIsAlive({ pid, start }: { pid: number; start: string | undefined }): boolean {
  if (pid === process.pid) {
    const mine = ownProcessStart();
    return start === undefined || mine === undefined || start === mine;
  }
  return holderRunning({ holder: { pid, start }, startOf: (candidate) => processStartOf({ pid: candidate }) });
}

/**
 * Why this process may not take a lease, when it may not: a never-stale lease trusts its holder's identity, so a
 * process takes one only once `ps` has given its start stamp. A record without one is what `./operationLock.ts`'s
 * `heldReason` ages out on the ordinary window, and a live writer's must never be — two writers appending from stale
 * snapshots is exactly what a never-stale lease exists to prevent.
 *
 * @param path the lock the attempt is for, named in the refusal
 * @param staleAfterMs how old a held lock may be before another attempt may take it over
 * @param start this process's start stamp, when `ps` gave one
 * @returns the refusal, or `undefined` when the attempt may go ahead
 */
export function unstampedLeaseRefusal({
  path,
  staleAfterMs,
  start,
}: {
  path: string;
  staleAfterMs: number;
  start: string | undefined;
}): string | undefined {
  if (staleAfterMs !== Number.POSITIVE_INFINITY || start !== undefined) {
    return undefined;
  }
  return `the lock at ${path} is never stale, and /bin/ps did not give this process's own start stamp — refusing rather than writing a record another process would age out while this one still holds it; run the command again`;
}
