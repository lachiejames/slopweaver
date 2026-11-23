/**
 * The machine's one lap lock: `<home>/laps/lock.json`, taken by an exclusive hard link of a file already holding
 * its body (so the lock never stands empty) and released only by the lap
 * whose nonce it carries. One lap at a time, because two would each starve the other into timeouts.
 *
 * A lap takes it FIRST, in its `preflight` phase, and advances it to `running` once it has a head. Taken only at
 * the lanes, it leaves the reads, the fetch and the landing check's fresh tree unguarded: a second session once
 * read no lock and no lap seat about two minutes before the first lap's lock appeared, and two laps ran at once
 * on a machine that holds one.
 *
 * A STALE lock — its process gone — is taken over by RENAMING it aside first: a rename succeeds for exactly one
 * contender, so two laps that both saw the same corpse cannot both run. Whether a lock is stale is
 * `lapLockState`'s judgement (`./lapLockShape.ts`); this file holds only the file edges.
 */

import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { createFileExclusive, renameStagedFile } from "../../../lib/writeAtomic.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { LapLockHandle, LapResource } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import { decodeLapLock, type LapLock, lapLockPhaseWords, lapLockState } from "./lapLockShape.js";

/** How many exclusive creates one acquisition tries: the first, and one more after setting a stale lock aside. */
const ACQUIRE_ATTEMPTS = 2;

/** Whether a process id names a live process this user may signal. */
function pidAlive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isRecord(error) && error["code"] === "EPERM";
  }
}

/** Read a standing lock file, or `undefined` when it is unreadable or not a lock. */
function readLock({ path }: { path: string }): LapLock | undefined {
  try {
    return decodeLapLock({ value: JSON.parse(readFileSync(path, "utf8")) });
  } catch {
    return undefined;
  }
}

/**
 * The lap holding this home's machine right now, in whichever phase: a missing, unreadable or stale lock is no
 * holder. Read-only — `github lap-seat show` names the holder with it, and never takes or clears anything.
 *
 * @param home the state home whose `laps/lock.json` is read
 * @returns the live holder's lock, or `undefined` when no live lap holds the machine
 */
export function readStandingLapLock({ home }: { home: string }): LapLock | undefined {
  const standing = standingLock({ path: stateHomePaths({ home }).lapLockJson });
  if (standing.kind === "held") {
    return standing.lock;
  }
  return undefined;
}

/**
 * Rewrite the held lock as `running` under its full subject: the body is staged beside the lock, flushed, and
 * renamed over it with its directory flushed, so a reader sees the whole preflight lock or the whole running one,
 * never an empty or partial file, even after a crash, and a contender reading either sees the same live pid and
 * refuses. Only while the lock still carries this nonce.
 *
 * RESIDUE, stated: the nonce check and the rename are two acts, not one compare-and-swap. Within the protocol
 * nothing else replaces a LIVE holder's lock, since only a lock whose process is gone is ever set aside; a process
 * writing `lock.json` outside the protocol in that instant would be overwritten.
 */
function advanceLock({
  path,
  held,
  subject,
  startedIso,
}: {
  path: string;
  held: LapLock;
  subject: string;
  startedIso: string;
}): Result<void, LapError> {
  const staged = `${path}.advance-${held.nonce}`;
  try {
    createFileExclusive({ contents: JSON.stringify({ ...held, phase: "running", startedIso, subject }), path: staged });
    if (readLock({ path })?.nonce !== held.nonce) {
      return err(LapErrors.lockUnavailable({ cause: "the lock this lap took is no longer the one standing", path }));
    }
    renameStagedFile({ flushDirectory: true, from: staged, to: path });
    return ok(undefined);
  } catch (error: unknown) {
    return err(LapErrors.lockUnavailable({ cause: error instanceof Error ? error.message : String(error), path }));
  } finally {
    rmSync(staged, { force: true });
  }
}

/** Remove the lock only while it is still the one this nonce took. */
async function releaseLock({ path, nonce }: { path: string; nonce: string }): Promise<void> {
  if (readLock({ path })?.nonce === nonce) {
    rmSync(path, { force: true });
  }
}

/**
 * Create the lock file exclusively, WITH its body: `true` when this call created it, `false` when one already
 * stands. The body is written to a file only this call names, then hard-linked into place, and a link fails when
 * the target exists, so the lock never stands EMPTY. Opening `lock.json` with `wx` and writing after left a window
 * in which a contender read an empty lock, judged it stale and set it aside, so two laps both held the machine.
 */
function createExclusive({
  path,
  body,
  nonce,
}: {
  path: string;
  body: string;
  nonce: string;
}): Result<boolean, LapError> {
  const staged = `${path}.new-${nonce}`;
  try {
    writeFileSync(staged, body, { flag: "wx" });
    linkSync(staged, path);
    return ok(true);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "EEXIST") {
      return ok(false);
    }
    return err(LapErrors.lockUnavailable({ cause: error instanceof Error ? error.message : String(error), path }));
  } finally {
    rmSync(staged, { force: true });
  }
}

/** The standing lock, whether its process is still alive, or `stale` with the nonce it carried (none if unreadable). */
function standingLock({
  path,
}: {
  path: string;
}): { readonly kind: "held"; readonly lock: LapLock } | { readonly kind: "stale"; readonly nonce: string | undefined } {
  const standing = readLock({ path });
  if (standing === undefined) {
    return { kind: "stale", nonce: undefined };
  }
  if (lapLockState({ lock: standing, pidAlive: pidAlive({ pid: standing.pid }) }) === "held") {
    return { kind: "held", lock: standing };
  }
  return { kind: "stale", nonce: standing.nonce };
}

/**
 * Rename a lock judged stale aside and remove it, but only when what was renamed is the lock that was judged: two
 * contenders can both judge the same corpse, and the slower one would otherwise rename away the FRESH lock the
 * faster one has since created. A lock moved by mistake is linked straight back.
 *
 * RESIDUE, stated: between that rename and the link back the path stands empty, so a THIRD contender creating its
 * own lock in that instant makes the link back fail and leaves two holders. That needs a crashed lap's lock and
 * three laps starting within one rename on one machine.
 *
 * @param path the lock file
 * @param nonce this contender's nonce, which names the aside file
 * @param judged the nonce of the lock judged stale, `undefined` when it was unreadable
 * @returns `set-aside` when the judged lock was removed, `restored` when a different lock was moved and put back,
 *   `lost` when another contender moved it first or the link back failed
 */
export function setAsideStale({
  path,
  nonce,
  judged,
}: {
  path: string;
  nonce: string;
  judged: string | undefined;
}): "set-aside" | "restored" | "lost" {
  const aside = `${path}.stale-${nonce}`;
  try {
    renameSync(path, aside);
  } catch {
    // Another contender renamed it first; the next exclusive create decides which of us holds the machine.
    return "lost";
  }
  const moved = readLock({ path: aside });
  if (moved?.nonce === judged) {
    rmSync(aside, { force: true });
    return "set-aside";
  }
  try {
    linkSync(aside, path);
    return "restored";
  } catch {
    return "lost";
  } finally {
    rmSync(aside, { force: true });
  }
}

/**
 * Take the machine's one lap lock. A lap takes it before its preflight, as `preflight`, so a second lap refuses
 * through the reads, the fetch and the landing check's tree build too, not only through the lanes.
 *
 * @param home the state home whose `laps/lock.json` is the machine's one lock
 * @param lock who is taking it, and in which phase; a fresh nonce is added here
 * @returns the held lock, whose disposal removes it only while it is still this one and whose handle advances it to
 *   `running`, or who holds it
 */
export function acquireLapLock({
  home,
  lock,
}: {
  home: string;
  lock: Omit<LapLock, "nonce">;
}): Result<LapResource<LapLockHandle>, LapError> {
  const { laps, lapLockJson: path } = stateHomePaths({ home });
  mkdirSync(laps, { recursive: true });
  const nonce = randomUUID();
  const held: LapLock = { ...lock, nonce };
  for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt += 1) {
    const created = createExclusive({ body: JSON.stringify(held), nonce, path });
    if (created.isErr()) {
      return err(created.error);
    }
    if (created.value) {
      return ok({
        dispose: () => releaseLock({ nonce, path }),
        value: { advance: ({ subject, startedIso }) => advanceLock({ held, path, startedIso, subject }) },
      });
    }
    const standing = standingLock({ path });
    if (standing.kind === "held") {
      const holder = standing.lock;
      return err(
        LapErrors.lockHeld({
          phase: lapLockPhaseWords({ phase: holder.phase }),
          pid: holder.pid,
          startedIso: holder.startedIso,
          subject: holder.subject,
        }),
      );
    }
    if (setAsideStale({ judged: standing.nonce, nonce, path }) === "restored") {
      return err(LapErrors.lockUnavailable({ cause: "another lap took it over as this one did", path }));
    }
  }
  return err(LapErrors.lockUnavailable({ cause: "another lap took it over as this one did", path }));
}
