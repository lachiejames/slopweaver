/**
 * The console voice's call transcripts on disk: `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl`, one per call,
 * appended as the call runs. What a line may say and how a file folds back into a call is `./callRecord.ts`.
 *
 * ## Why append-only JSONL, and why the page flushes rather than the verb polling
 *
 * The page is the only thing that hears the call, so it is the writer: it hands `slopweaver talk transcript` a
 * batch of lines through `/api/talk/transcript` as they land, one batch in flight at a time. Appending means a
 * batch can never rewrite what an earlier one kept, so the file only ever holds MORE of the call; a crash mid-write
 * tears at most the last line, which the read skips and counts rather than losing the call. A batch the page posts
 * again after no answer carries the same per-line `writeId`s, so a line the verb already appended goes in once
 * (`unwrittenEntries`).
 *
 * ## The owner's raw words
 *
 * The file holds what the owner said, transcribed, so the directory is `0700` and each file `0600`, under the home and
 * never under a checkout. Nothing here sends anything anywhere. The one thing changed on the way in is a secret —
 * a credential or a private-denylist word — masked by `talk transcript` before the append (`./callSanitise.ts`).
 */
import { chmodSync, type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { ensureDirectory } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { appendUnderLock } from "./callHeld.js";
import { isCallId } from "./callId.js";
import { type CallLinesRead, readCallLines } from "./callLines.js";
import { CALL_LOCK_WAIT_MS } from "./callLock.js";
import type { CallOrigin } from "./callOrigin.js";
import { type CallsKeep, chosenFiles, spokenEnough, writtenSinceListed } from "./callReadWindow.js";
import { type CallEntry, type CallRecord, callActivity, foldCall } from "./callRecord.js";
import { holdAnnouncedLock } from "./callWriteIntent.js";
import { type TalkError, TalkErrors } from "./errors.js";
import { processStartOf, type StartOf } from "./relayLease.js";

export { isCallId };

/** A call file's name: the id, then `.jsonl`. */
const CALL_FILE = /^([0-9a-f-]{36})\.jsonl$/u;

/**
 * `$home/talk/calls` (`0700`): one `<callId>.jsonl` (`0600`) per call. The owner's raw words, so it never leaves the home.
 * Derived from the state-home contract's own `talk/` directory — the one place a home path is built — beside the
 * turns and the pack it already names.
 *
 * @returns the directory
 */
export function callsDir({ home }: { home: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), "calls");
}

/**
 * `$home/talk/call-index.txt` (`0600`): one call id per line, appended BEFORE a call's first line is written — so a
 * call file deleted before any reader saw it is refused by `talk unread` rather than read as a call that never was
 *. A call whose file predates the index is covered only once a reader's cursor has read it.
 *
 * @returns the index file
 */
export function callIndexPath({ home }: { home: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), "call-index.txt");
}

/**
 * Append a batch of lines to one call's file, making the directory `0700` and the file `0600` on first write.
 *
 * @param home the Slopweaver home
 * @param callId the call, a v4 UUID
 * @param entries the lines, already validated
 * @param origin the console writing them, when one is; a console that is not the owner's only appends under an open it wrote
 * @param lockWaitMs how long to wait for another writer of the same call, 10 s unless a test narrows it
 * @param pid the pid this writer's lock names, its own unless a test stands in another
 * @param startOf a pid's current start time, the real `ps` unless a test makes a holder dead or alive
 * @param nowIso the instant the append is stamped with on every segment line, the real clock unless a test fixes one
 * @param secretGuard the denylist `talk transcript` masked against, which the store judges the stamped batch by once
 * more before writing it; absent, nothing is judged
 * @returns the file written and how many lines went in
 */
export function appendCallEntries({
  home,
  callId,
  entries,
  origin,
  lockWaitMs = CALL_LOCK_WAIT_MS,
  pid = process.pid,
  startOf = (candidate) => processStartOf({ pid: candidate }),
  nowIso = () => new Date().toISOString(),
  secretGuard,
}: {
  home: string;
  callId: string;
  entries: readonly CallEntry[];
  origin?: CallOrigin;
  lockWaitMs?: number;
  pid?: number;
  startOf?: StartOf;
  nowIso?: () => string;
  secretGuard?: { readonly denylist: readonly string[] };
}): Result<{ readonly path: string; readonly appended: number }, TalkError> {
  if (!isCallId({ callId })) {
    return err(TalkErrors.callInvalid({ callId }));
  }
  const dir = callsDir({ home });
  const path = join(dir, `${callId}.jsonl`);
  // Every other judgement is made under the call's lock (`appendUnderLock`), so no `talk quarantine` lands between
  // one and the next and a closed call always answers that it is closed.
  try {
    ensureDirectory({ directory: dir });
    chmodSync(dir, 0o700);
    // Announced before the wait, withdrawn while still holding the lock, so a fence over the owner's words gives way to
    // this batch rather than overtaking it (`./callWriteIntent.ts`).
    const release = holdAnnouncedLock({ path, pid, startOf, waitMs: lockWaitMs });
    try {
      const indexPath = callIndexPath({ home });
      return appendUnderLock({ callId, entries, home, indexPath, nowIso, origin, path, secretGuard }).map(
        (appended) => ({ appended, path }),
      );
    } finally {
      release();
    }
  } catch (cause) {
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
}

/** What a read of the call directory found. */
export interface CallsRead {
  /** Newest first, by when each call was last heard from. */
  readonly calls: readonly CallRecord[];
  /** Call files that could not be read, each with why. */
  readonly unreadable: readonly string[];
  /** How many call files the read never opened, each older-written than every one it did: what `keep` left out. */
  readonly passedOver: number;
}

/**
 * Read one call file whole, folded into its call.
 *
 * @param callId the call the file is named for
 * @returns the call, `undefined` for a file with no call activity at all, or why the file could not be read — a file
 *   whose every activity line failed to parse is unread, never no call, since the lines it could not read may be the
 *   whole call; a reconnect line is not activity (`callActivity`), so it never turns that unread file into no call
 */
function readCallFile({ callId, path }: { callId: string; path: string }): Result<CallRecord | undefined> {
  return readCallLines({ path })
    .mapErr((cause) => [`${callId}: ${String(cause)}`])
    .andThen(({ entries, skipped }) => {
      if (callActivity({ entries }).length === 0 && skipped > 0) {
        if (entries.length === 0) {
          return err([`${callId}: none of its ${String(skipped)} line(s) parsed`]);
        }
        return err([`${callId}: only reconnect lines parsed, beside ${String(skipped)} line(s) that did not`]);
      }
      return ok(foldCall({ callId, entries, skipped }));
    });
}

/**
 * Read one call's lines as written — what `./cardUtterance.ts` cuts the owner's utterances out of. A call with no file
 * yet reads as no lines.
 *
 * @param home the Slopweaver home
 * @param callId the call, a v4 UUID
 * @returns the lines that parsed, in file order, or why the file could not be read
 */
export function readCallEntries({
  home,
  callId,
}: {
  home: string;
  callId: string;
}): Result<readonly CallEntry[], TalkError> {
  return readCallEntriesCounted({ callId, home }).map(({ entries }) => entries);
}

/**
 * Read one call's lines as written, and how many did not parse — what finding ONE segment needs, since a segment
 * missing from a file with a torn line may be in that line (`../handover/hisWordsResolve.ts`). A call with no file
 * reads as no lines, `present: false`, which a reader binding words the file once held must not read as no cut.
 *
 * @param home the Slopweaver home
 * @param callId the call, a v4 UUID
 * @returns the lines that parsed, in file order, the count that did not and the count that lost a placing stamp, or
 *   why the file could not be read
 */
export function readCallEntriesCounted({
  home,
  callId,
}: {
  home: string;
  callId: string;
}): Result<CallLinesRead, TalkError> {
  if (!isCallId({ callId })) {
    return err(TalkErrors.callInvalid({ callId }));
  }
  const path = join(callsDir({ home }), `${callId}.jsonl`);
  if (!existsSync(path)) {
    return ok({ entries: [], present: false, skipped: 0, stampsDropped: 0 });
  }
  return readCallLines({ path }).mapErr((cause) => TalkErrors.pathUnreadable({ cause, path }));
}

/**
 * Every call file in the home with when it was last written — a missing directory is no calls, not a failure.
 *
 * @returns the files, and any whose `stat` failed, or why the directory could not be listed
 */
function listCallFiles({
  home,
}: {
  home: string;
}): Result<{ touched: { callId: string; path: string; mtimeMs: number }[]; unreadable: string[] }, TalkError> {
  const dir = callsDir({ home });
  let names: readonly Dirent[];
  try {
    names = readdirSync(dir, { withFileTypes: true });
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") {
      return ok({ touched: [], unreadable: [] });
    }
    return err(TalkErrors.pathUnreadable({ cause, path: dir }));
  }
  const unreadable: string[] = [];
  const touched: { callId: string; path: string; mtimeMs: number }[] = [];
  for (const entry of names) {
    const match = CALL_FILE.exec(entry.name);
    if (match === null) {
      continue;
    }
    // A call's name on something that is not a file may still be where that call was meant to be written.
    if (!entry.isFile()) {
      unreadable.push(`${entry.name}: named for a call but not a regular file`);
      continue;
    }
    const path = join(dir, entry.name);
    try {
      touched.push({ callId: match[1]!, mtimeMs: statSync(path).mtimeMs, path });
    } catch (cause) {
      unreadable.push(`${entry.name}: ${String(cause)}`);
    }
  }
  return ok({ touched, unreadable });
}

/**
 * The id of every call on disk — a missing directory is none.
 *
 * @returns the call ids, in no promised order, or why the directory could not be listed
 */
export function allCallIds({ home }: { home: string }): Result<readonly string[], TalkError> {
  return listCallFiles({ home }).map(({ touched }) => touched.map((file) => file.callId));
}

/**
 * Read the recent calls: every call file touched at or after `sinceIso`, the newest `limit` of them, or every call
 * that could be among the `speaking` newest-OPENED that hold a word said (`spokenEnough`) — a call nobody spoke on is
 * read but never counted, so no run of silent calls can hide the last thing that was said.
 *
 * @param home the Slopweaver home
 * @param keep which calls: those touched since an instant, the newest few, or the newest few anyone spoke on
 * @returns the calls, newest first, and any file that could not be read
 */
export function readCalls({ home, keep }: { home: string; keep: CallsKeep }): Result<CallsRead, TalkError> {
  const listed = listCallFiles({ home });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const { touched, unreadable } = listed.value;
  const calls: CallRecord[] = [];
  // When each call anyone spoke on OPENED, newest first: the `speaking` newest are the ones a thread draws.
  let spokenOpened: number[] = [];
  let opened = 0;
  const chosen = chosenFiles({ keep, touched });
  for (const [index, file] of chosen.entries()) {
    if ("speaking" in keep && spokenEnough({ file, speaking: keep.speaking, spokenOpened })) {
      const late = writtenSinceListed({ rest: chosen.slice(index), speaking: keep.speaking, spokenOpened });
      opened += late.length;
      readInto({ calls, files: late, unreadable });
      break;
    }
    opened += 1;
    const read = readCallFile({ callId: file.callId, path: file.path });
    if (read.isErr()) {
      read.error.forEach((why) => unreadable.push(why));
      continue;
    }
    if (read.value === undefined) {
      continue;
    }
    calls.push(read.value);
    if (read.value.segments.some((segment) => segment.text.trim() !== "")) {
      spokenOpened = [...spokenOpened, Date.parse(read.value.openedIso)].toSorted((a, b) => b - a);
    }
  }
  return ok({
    calls: calls.toSorted((a, b) => Date.parse(b.lastIso) - Date.parse(a.lastIso)),
    passedOver: touched.length - opened,
    unreadable,
  });
}

/** One call file's lines as written, for a reader that cuts utterances out of them rather than folding a call. */
interface RecentCallEntryFile {
  readonly callId: string;
  /** The lines that parsed, in file order. */
  readonly entries: readonly CallEntry[];
  /** How many lines did not parse: a torn or malformed line may hold exactly the words a reader is after. */
  readonly skipped: number;
}

/** What {@link readRecentCallEntries} found. */
export interface RecentCallEntriesRead {
  /** Every call file written at or after the floor, newest-written first. */
  readonly calls: readonly RecentCallEntryFile[];
  /** Call files that could not be listed or read, each with why. */
  readonly unreadable: readonly string[];
}

/**
 * Every call file written at or after an instant, read as raw lines — the window `readCalls` takes for `sinceIso`, without
 * folding each into a call, since what `./cardUtterance.ts` reads is the lines. A call file is append-only, so one not
 * written since the floor holds no line from inside it, and it is never opened.
 *
 * @param home the Slopweaver home
 * @param sinceIso the floor; a file last written before it is passed over
 * @returns the files read, and any that could not be, or why the directory could not be listed
 */
export function readRecentCallEntries({
  home,
  sinceIso,
}: {
  home: string;
  sinceIso: string;
}): Result<RecentCallEntriesRead, TalkError> {
  const listed = listCallFiles({ home });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const unreadable = [...listed.value.unreadable];
  const calls: RecentCallEntryFile[] = [];
  for (const file of chosenFiles({ keep: { sinceIso }, touched: listed.value.touched })) {
    const read = readCallLines({ path: file.path });
    if (read.isErr()) {
      unreadable.push(`${file.callId}: ${String(read.error)}`);
      continue;
    }
    calls.push({ callId: file.callId, entries: read.value.entries, skipped: read.value.skipped });
  }
  return ok({ calls, unreadable });
}

/**
 * Read each file into the calls, or name why it could not be read.
 *
 * @param files the call files to read
 * @param calls the calls read so far, extended in place
 * @param unreadable the files not read so far, each with why, extended in place
 */
function readInto({
  files,
  calls,
  unreadable,
}: {
  files: readonly { callId: string; path: string }[];
  calls: CallRecord[];
  unreadable: string[];
}): void {
  for (const file of files) {
    const read = readCallFile({ callId: file.callId, path: file.path });
    if (read.isErr()) {
      read.error.forEach((why) => unreadable.push(why));
    } else if (read.value !== undefined) {
      calls.push(read.value);
    }
  }
}

/**
 * Whether a call's file was last written at or after an instant — a cheap test that passes every call that could
 * have OPENED after it, because a call's file is written no earlier than its open line was stamped, on this machine's
 * one clock; `slackMs` covers the sink stamping a burst of lines a millisecond apart ahead of that clock.
 *
 * @param sinceMs the instant, epoch milliseconds
 * @param slackMs how far before it a write still passes
 * @returns false for a call with no file yet, which has no open line either
 */
export function callWrittenSince({
  callId,
  home,
  sinceMs,
  slackMs,
}: {
  callId: string;
  home: string;
  sinceMs: number;
  slackMs: number;
}): boolean {
  const path = join(callsDir({ home }), `${callId}.jsonl`);
  if (!isCallId({ callId }) || !existsSync(path)) {
    return false;
  }
  try {
    return statSync(path).mtimeMs >= sinceMs - slackMs;
  } catch {
    // Unreadable now: kept, so the read that follows says why rather than this test hiding the call.
    return true;
  }
}
