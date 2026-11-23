/**
 * Which process a pid names right now: whether one runs at all, when it started, and whether it has already exited
 * unreaped. A pid alone outlives its process — the OS hands it to whatever starts next — so a record that wants to
 * know whether ITS writer still runs keeps that writer's start stamp and asks this for the pid's current one.
 *
 * One `/bin/ps -o stat=,lstart=` read gives both the start stamp and the state, the shape `../codex/snapshotLease.ts`
 * reads, so a zombie — exited, unreaped, still answering signal 0 and still printing its original start — is told
 * apart from a live process in the same call.
 */
import { execFileSync } from "node:child_process";

import { lstartMs } from "./lstart.js";

/** A pid's process as it stands now. */
export interface ProcessIdentity {
  /** Whether a signal-0 probe reaches the pid; a process of another user's counts. */
  readonly running: boolean;
  /** Its start stamp as `ps -o lstart=` prints it in UTC under the C locale; `undefined` when `ps` gave none it can read. */
  readonly start: string | undefined;
  /** Whether `ps` reports it as `Z`: exited, and its parent has not reaped it. */
  readonly zombie: boolean;
}

/** A pid's process as it stands now — injected so a dead, reused or zombie holder is a fixture, not a process. */
export type IdentityOf = (candidate: number) => ProcessIdentity;

/** One `ps -o stat=,lstart=` row: the state, then the start stamp, e.g. `Ss   Fri Oct  9 11:36:11 2026`. */
const PS_ROW = /^(\S+)\s+(\S.*)$/u;

/**
 * The process a pid names right now.
 *
 * @returns `running` from a signal-0 probe, and the `ps` start stamp and zombie state — a stamp of `undefined` and
 *   `zombie: false` when `ps` could not say, never a guess
 */
export function processIdentityOf({ pid }: { pid: number }): ProcessIdentity {
  if (!signalReaches({ pid })) {
    return { running: false, start: undefined, zombie: false };
  }
  const row = psRow({ pid });
  const match = row === undefined ? null : PS_ROW.exec(row);
  if (match === null) {
    // `ps` printing nothing is most often the process having exited since the signal probe: ask the kernel again, so
    // a holder that died in that window reads dead rather than running-without-a-stamp.
    return { running: signalReaches({ pid }), start: undefined, zombie: false };
  }
  return { running: true, start: usableStamp({ text: match[2]! }), zombie: match[1]!.startsWith("Z") };
}

/**
 * A start stamp only when it names a real instant, so a caller comparing stamps never reads a garbled `ps` column as
 * a different process.
 *
 * @param text the `lstart` column as `ps` printed it
 * @returns the text unchanged when `lstartMs` reads it, else `undefined` — no stamp, never a wrong one
 */
export function usableStamp({ text }: { text: string }): string | undefined {
  return lstartMs({ text }) === undefined ? undefined : text;
}

/** Whether a signal-0 probe finds this pid — `EPERM` means it exists and belongs to someone else. */
function signalReaches({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "EPERM";
  }
}

/**
 * The `stat` and `lstart` columns `/bin/ps` prints for a pid, or `undefined` when it printed none.
 *
 * Asked of `/bin/ps` by its path, in UTC and the C locale and inheriting nothing else: `lstart` renders in the
 * caller's zone and locale, so two callers would otherwise stamp one live process differently and the second would
 * read it as reused (the relay lease's case).
 */
function psRow({ pid }: { pid: number }): string | undefined {
  try {
    const text = execFileSync("/bin/ps", ["-o", "stat=,lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      // SIGKILL, which a stopped or signal-handling `ps` cannot outlast; one in uninterruptible kernel sleep outlasts any.
      killSignal: "SIGKILL",
    }).trim();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}
