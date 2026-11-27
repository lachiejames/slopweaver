/**
 * Reading and writing the supervisor-pin record — the effectful half of {@link ./supervisorPin}.
 *
 * Both sides are SYNCHRONOUS and swallow their own I/O failures, because the reader is a `PreToolUse` hook:
 * an unreadable file must make the depth guard inert, never make it throw in front of every tool call. Same
 * owner-only treatment as the session ledger beside it — this file names a live workspace.
 */
import { mkdirSync, rmSync } from "node:fs";

import { isAbsentError, nonBlockingFileBytes } from "../lib/presentFile.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import type { VisibleSupervisorSession } from "../supervisor/session.js";
import { parseSupervisorPin, type SupervisorPinRecord, sessionsNamedByPinText } from "./supervisorPin.js";

/** Owner-only permissions, matching `./sessionStore.ts`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The supervisor-pin record's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `sessions/supervisor-pin.json`
 */
export function supervisorPinPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).supervisorPinJson;
}

/**
 * The recorded supervisor pin, or `undefined` when there is none this reader can trust.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the record, or `undefined` for an absent, unreadable, not-UTF-8 or malformed file — or one that is not a regular
 *   file, since a FIFO would block the hook and `talk offer`'s mint forever
 */
export function readSupervisorPin({ home }: { home?: string } = {}): SupervisorPinRecord | undefined {
  try {
    const path = supervisorPinPath(home === undefined ? {} : { home });
    // Opened once, non-blocking, and judged on that descriptor: a stat then a second open would let the path become a
    // FIFO in between. Strict: a byte that is not UTF-8 is a record nobody wrote, never one repaired
    // into a pin.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nonBlockingFileBytes({ path }));
    return parseSupervisorPin({ text });
  } catch {
    return undefined;
  }
}

/**
 * What the pin file holds, for a judgement that must tell "nothing recorded" from "a record it cannot trust". An
 * untrusted record still says which sessions it `named`, none of them chosen as the holder, so a refusal can name
 * the chairs whose turns it could not read; a file that would not read at all names none.
 */
export type SupervisorPinDisposition =
  | { readonly kind: "absent" }
  | { readonly kind: "pin"; readonly record: SupervisorPinRecord }
  | { readonly kind: "unreadable"; readonly named: readonly VisibleSupervisorSession[]; readonly why: string };

/**
 * The pin file, read STRICTLY: {@link readSupervisorPin} folds absent, unreadable and malformed into one `undefined`,
 * which is right for the fail-open hook and wrong for a chair judgement, where a mixed-shape pin read as absence
 * let an older Claude chain link decide the chair.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns absent only for a missing file; a record; or why the file is there and not trusted
 */
export function readSupervisorPinDisposition({ home }: { home?: string } = {}): SupervisorPinDisposition {
  const path = supervisorPinPath(home === undefined ? {} : { home });
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nonBlockingFileBytes({ path }));
  } catch (cause) {
    if (isAbsentError({ error: cause, path })) {
      return { kind: "absent" };
    }
    return { kind: "unreadable", named: [], why: `the supervisor pin would not read: ${String(cause)}` };
  }
  const record = parseSupervisorPin({ text });
  if (record === undefined) {
    return {
      kind: "unreadable",
      named: sessionsNamedByPinText({ text }),
      why: "the supervisor pin does not parse as one record shape",
    };
  }
  return { kind: "pin", record };
}

/**
 * Record which session now holds the supervisor pin, replacing whatever was there.
 *
 * Replacing rather than appending is the point: there is one pin, so there is one holder, and a successor's
 * `cmux takeover` must leave no trace of its predecessor for a hook to match against.
 *
 * The predecessors are not LOST by that, they are simply not here: `../supervisor/chainStore.ts` appends the
 * same move to the supervisor-chain journal, which is what a week-long audit reads. Adding history to this
 * file instead was the wrong shape — the depth guard asks "is this session the supervisor", and a file that
 * answers "it was, once" would make the guard match a predecessor.
 *
 * @param record what to write
 * @param home the state home (defaults to the resolved home)
 */
export function writeSupervisorPin({ record, home }: { record: SupervisorPinRecord; home?: string }): void {
  const path = supervisorPinPath(home === undefined ? {} : { home });
  mkdirSync(stateHomePaths(home === undefined ? {} : { home }).sessions, { mode: DIR_MODE, recursive: true });
  writeFileAtomic({ contents: `${JSON.stringify(record, null, 2)}\n`, dirMode: DIR_MODE, fileMode: FILE_MODE, path });
}

/**
 * Remove the supervisor-pin record when a verb has just moved the pin off the workspace it names.
 *
 * A record left naming a session the pin has left would keep answering "yes, the supervisor" for it — to the
 * depth guard, and to the chair gate's caller check while cmux is silent (`../supervisor/chairGate.ts`), where
 * that yes lets a former chair stand in for the real one. No record is the honest state
 * when the new holder's session id is one this process does not have.
 *
 * @param home the state home (defaults to the resolved home)
 * @param when whether the current record is the one the pin just left
 * @returns true when a record was removed
 */
export function forgetSupervisorPin({
  home,
  when,
}: {
  home?: string;
  when: (record: SupervisorPinRecord) => boolean;
}): boolean {
  const record = readSupervisorPin(home === undefined ? {} : { home });
  if (record === undefined || !when(record)) {
    return false;
  }
  rmSync(supervisorPinPath(home === undefined ? {} : { home }), { force: true });
  return true;
}
