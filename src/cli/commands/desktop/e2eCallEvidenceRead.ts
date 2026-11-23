/**
 * The call leg's reads off disk, each turned into a typed answer: the bytes appended to a log since a scenario began,
 * the call leases live now, and how a transcript ended. The parsing is `src/desktop/e2eCallEvidence.ts`; this is the
 * I/O around it, and every read that fails says so rather than reading as "nothing happened".
 *
 * **A cursor, never a timestamp.** Each log is read from the byte it stood at when the scenario began, so a line the owner's
 * own app appends is still read, and then dropped by the judges because it names none of the test's calls. A log
 * SHORTER than its cursor was restarted — the console truncates its log when it starts — and is read from the top.
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { cachePaths, slopweaverCacheRoot, slopweaverCacheRootOf } from "../../../cacheHome.js";
import { consoleRecordKey } from "../../../checkouts/consoleBuild.js";
import { readCallLeaseCopies, readCallLeases } from "../../../desktop/callLeases.js";
import { cardReadProgress, type E2eCardReadProgress, furtherProgress } from "../../../desktop/e2eCallCardRead.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { liveLeaseIdsOf } from "../../../desktop/e2eCallEvidence.js";
import {
  openTypedConversationIds,
  queueSearchToolUsed,
  TYPED_ACTIVE_MS,
  tornCallIds,
  typedBesideSinceRead,
} from "../../../desktop/e2eCallQueueSearch.js";
import { type E2eCallOpening, firstVoiceFinal, greetingFaults } from "../../../desktop/e2eGreetingJudge.js";
import { accountDefaultHome } from "../../../homeDir.js";
import { callOpenedByTestInstance } from "../../../talk/callOrigin.js";
import { type CallRecord, foldCall } from "../../../talk/callRecord.js";
import { readCallEntries, readCallEntriesCounted, readCalls } from "../../../talk/callStore.js";

/** Where one log was when a scenario began. */
export interface LogCursor {
  readonly path: string;
  readonly offset: number;
}

/**
 * The serving console's log: `scripts/docs-site.sh`'s `<record>.log` beside its run record, where the plan-call lines
 * land, under the cache root's docs-site directory (`src/cacheHome.ts`).
 *
 * @param checkout the checkout whose console the instance reads, its absolute path
 * @param cacheRoot the cache root, this process's own when omitted
 * @returns the log's path
 */
export function planLogPath({ checkout, cacheRoot }: { checkout: string; cacheRoot?: string }): string {
  const { docsSite } = cachePaths(cacheRoot === undefined ? {} : { root: cacheRoot });
  return join(docsSite, `${consoleRecordKey({ root: checkout })}.log`);
}

/**
 * The desktop shell's event log, `app.getPath("logs")` for a bundle named Slopweaver — shared by the owner's app and every
 * test instance, which is why the judges correlate by call id.
 *
 * @param user the user's home directory
 * @returns the log's path
 */
export function desktopEventLogPath({ user }: { user: string }): string {
  return join(user, "Library", "Logs", "Slopweaver", "desktop-events.jsonl");
}

/**
 * The desktop event log on this machine.
 *
 * @returns its path
 */
export function thisDesktopEventLog(): string {
  return desktopEventLogPath({ user: homedir() });
}

/**
 * A log's size, zero when it does not exist yet.
 *
 * @param path the log
 * @returns its size, or why it could not be read
 */
function sizeOf({ path }: { path: string }): Result<number, E2eCallError> {
  try {
    return ok(statSync(path).size);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok(0);
    }
    return err(E2eCallErrors.evidenceUnreadable({ detail: String(cause), path }));
  }
}

/**
 * A cursor at a log's end now.
 *
 * @param path the log
 * @returns the cursor, or why the log could not be read
 */
export function cursorAtEnd({ path }: { path: string }): Result<LogCursor, E2eCallError> {
  return sizeOf({ path }).map((offset) => ({ offset, path }));
}

/**
 * The bytes appended to a log since a cursor, from the top when the log was restarted.
 *
 * @param cursor where the log was
 * @returns the text, or why it could not be read
 */
export function readAppended({ cursor }: { cursor: LogCursor }): Result<string, E2eCallError> {
  const size = sizeOf({ path: cursor.path });
  if (size.isErr()) {
    return err(size.error);
  }
  const from = size.value < cursor.offset ? 0 : cursor.offset;
  const length = size.value - from;
  if (length === 0) {
    return ok("");
  }
  try {
    const fd = openSync(cursor.path, "r");
    try {
      const buffer = Buffer.alloc(length);
      const read = readSync(fd, buffer, 0, length, from);
      return ok(buffer.subarray(0, read).toString("utf8"));
    } finally {
      closeSync(fd);
    }
  } catch (cause) {
    return err(E2eCallErrors.evidenceUnreadable({ detail: String(cause), path: cursor.path }));
  }
}

/**
 * The ids of every call lease live on this machine now.
 *
 * @param home the state home whose consoles' leases are read
 * @param nowMs the clock to judge them by
 * @returns the ids, or that the leases could not be read — never read as none
 */
export function liveLeaseIds({
  home,
  nowMs,
}: {
  home: string;
  nowMs: number;
}): Result<readonly string[], E2eCallError> {
  return readCallLeases({ home, seams: LEASE_SEAMS })
    .map((leases) => liveLeaseIdsOf({ leases, nowMs }))
    .mapErr((error) => E2eCallErrors.leasesUnreadable({ detail: error.message }));
}

/** The lease reads, through `node:fs`. */
const LEASE_SEAMS = {
  names: ({ path }: { path: string }) => readdirSync(path),
  readText: ({ path }: { path: string }) => readFileSync(path, "utf8"),
};

/**
 * Every copy of every call lease file on this machine, unjudged and unmerged, so a copy that does not parse is never
 * dropped beside one that does (Codex oncall-r9). Read under this process's state home and cache root AND the user's
 * default ones, resolved from the account's own home directory rather than `$HOME`, so no environment variable a seat
 * sets can point the hold away from the owner's console's leases.
 *
 * @param home the state home whose consoles' leases are read
 * @returns each copy's text, or that the leases could not be read
 */
export function callLeaseTexts({ home }: { home: string }): Result<readonly string[], E2eCallError> {
  let cacheRoots: readonly string[];
  let homes: readonly string[];
  try {
    const userHome = userInfo().homedir;
    cacheRoots = [slopweaverCacheRoot(), slopweaverCacheRootOf({ env: {}, platform: process.platform, userHome })];
    homes = [home, accountDefaultHome()];
  } catch (error) {
    // A root that cannot be resolved is leases that cannot be read: the hold reads that as a call, never as none.
    return err(E2eCallErrors.leasesUnreadable({ detail: `the lease roots: ${errorMessage({ error })}` }));
  }
  return readCallLeaseCopies({ cacheRoots, homes, seams: LEASE_SEAMS })
    .map((copies) => copies.map((copy) => copy.text))
    .mapErr((error) => E2eCallErrors.leasesUnreadable({ detail: error.message }));
}

/**
 * How one transcript ended, read from the call store.
 *
 * @param home the state home
 * @param callId the transcript call
 * @returns the end, `undefined` while none is written, or why the store could not be read
 */
export function transcriptEnd({
  home,
  callId,
}: {
  home: string;
  callId: string;
}): Result<{ readonly atIso: string; readonly why: string | null } | undefined, E2eCallError> {
  return readCallEntries({ callId, home })
    .map((entries) => foldCall({ callId, entries, skipped: 0 })?.ended)
    .mapErr((error) => E2eCallErrors.evidenceUnreadable({ detail: error.message, path: `call ${callId}` }));
}

/**
 * Which of a test instance's own transcript calls ran `talk find-card`, read from the call store. Keyed by the ids the
 * instance's own transcript batches carried, never by time or by the newest call, so the owner's call beside it is never read.
 *
 * @param home the state home
 * @param callIds the transcript calls this instance wrote to
 * @returns the ids whose record holds a successful find-card run, or why one could not be read — never read as none
 */
export function queueSearchToolCallIds({
  home,
  callIds,
}: {
  home: string;
  callIds: readonly string[];
}): Result<readonly string[], E2eCallError> {
  const ran: string[] = [];
  for (const callId of callIds) {
    const entries = readCallEntries({ callId, home });
    if (entries.isErr()) {
      return err(E2eCallErrors.evidenceUnreadable({ detail: entries.error.message, path: `call ${callId}` }));
    }
    if (queueSearchToolUsed({ call: foldCall({ callId, entries: entries.value, skipped: 0 }) })) {
      ran.push(callId);
    }
  }
  return ok(ran);
}

/**
 * Every transcript call this run wrote: the ones its requests were seen carrying, and any the store gained since the
 * session began, which is how a recovered renderer's batch shows up when Playwright never saw it.
 * The same set `closeCallSession` proves ended, so a call it waited on is never one the greeting judge skips — and
 * every one an earlier store read showed stays in it, so a file gone by the final read is refused as lost evidence
 * rather than forgotten.
 *
 * @param tracked the ids the instance's own requests carried
 * @param seen the store-written ids an earlier read during the session showed
 * @param before the transcript ids in the store before the session began
 * @param now the transcript ids in the store after it closed
 * @returns each id once, the tracked ones first
 */
export function ownTranscriptCallIds({
  tracked,
  seen,
  before,
  now,
}: {
  tracked: readonly string[];
  seen: readonly string[];
  before: ReadonlySet<string>;
  now: readonly string[];
}): readonly string[] {
  return [...new Set([...tracked, ...seen, ...now.filter((callId) => !before.has(callId))])];
}

/**
 * What the voice opened each of a test instance's own transcript calls with, judged (`src/desktop/e2eGreetingJudge.ts`),
 * read from the call store by the ids the instance's own batches carried, never the owner's call beside them. A call file with
 * any line that did not parse is unreadable here, since the opening may be that line, and so is one with no lines at
 * all: every id here came from a batch this run wrote, so an empty or missing file is lost evidence.
 *
 * @param home the state home
 * @param callIds the transcript calls this instance wrote to
 * @returns each call's opening and its faults, or why one could not be read — never read as a clean opening
 */
export function callOpenings({
  home,
  callIds,
}: {
  home: string;
  callIds: readonly string[];
}): Result<readonly E2eCallOpening[], E2eCallError> {
  const openings: E2eCallOpening[] = [];
  for (const callId of callIds) {
    const read = readCallEntriesCounted({ callId, home });
    if (read.isErr()) {
      return err(E2eCallErrors.evidenceUnreadable({ detail: read.error.message, path: `call ${callId}` }));
    }
    const { entries, skipped } = read.value;
    if (entries.length === 0 && skipped === 0) {
      return err(
        E2eCallErrors.evidenceUnreadable({
          detail: "its call file holds no lines, though this run wrote to it",
          path: `call ${callId}`,
        }),
      );
    }
    if (skipped > 0) {
      return err(
        E2eCallErrors.evidenceUnreadable({
          detail: `${String(skipped)} line(s) did not parse, and the voice's opening may be one of them`,
          path: `call ${callId}`,
        }),
      );
    }
    const call = foldCall({ callId, entries, skipped });
    const text = call === undefined ? undefined : firstVoiceFinal({ call });
    openings.push({ callId, faults: text === undefined ? [] : greetingFaults({ text }), text });
  }
  return ok(openings);
}

/**
 * How far a test instance's own transcript calls came through `card-read`'s witness, read from the call store. Each
 * call is judged WHOLE and alone, so the open in one call never joins the challenged answer in another, and only the
 * ids this instance's own transcript batches carried are read, never the owner's call beside them.
 *
 * @param home the state home
 * @param callIds the transcript calls this instance wrote to
 * @param cardKey the Queue card key, `<kind>:<id>`, `--call-card` named
 * @param challenge the whole typed challenge a final line of the owner's must carry
 * @returns the furthest progress any one call reached and the calls that hold the whole witness, or why one could
 * not be read — never read as not seen
 */
export function cardReadProgressFromCalls({
  home,
  callIds,
  cardKey,
  challenge,
}: {
  home: string;
  callIds: readonly string[];
  cardKey: string;
  challenge: string;
}): Result<{ readonly progress: E2eCardReadProgress; readonly completeCallIds: readonly string[] }, E2eCallError> {
  let progress: E2eCardReadProgress = "waiting-for-open";
  const completeCallIds: string[] = [];
  for (const callId of callIds) {
    const entries = readCallEntries({ callId, home });
    if (entries.isErr()) {
      return err(E2eCallErrors.evidenceUnreadable({ detail: entries.error.message, path: `call ${callId}` }));
    }
    const one = cardReadProgress({ cardKey, challenge, entries: entries.value });
    if (one === "complete") {
      completeCallIds.push(callId);
    }
    progress = furtherProgress({ a: progress, b: one });
  }
  return ok({ completeCallIds, progress });
}

/**
 * The typed conversations on the console that look open now, read from the call files WRITTEN within the window
 * {@link TYPED_ACTIVE_MS} spans — the write time, never a line's own stamp.
 *
 * @param home the state home
 * @param nowMs the instant judged at, whose window back selects the files
 * @returns their ids, or why the store could not be read — never read as none
 */
export function openTypedConversations({
  home,
  nowMs,
}: {
  home: string;
  nowMs: number;
}): Result<readonly string[], E2eCallError> {
  const read = callsSince({ home, sinceMs: nowMs - TYPED_ACTIVE_MS });
  if (read.isErr()) {
    return err(read.error);
  }
  if (read.value.unread.length > 0) {
    return err(E2eCallErrors.evidenceUnreadable({ detail: read.value.unread.join("; "), path: "talk calls" }));
  }
  return ok(openTypedConversationIds({ calls: read.value.calls }));
}

/**
 * Every call written to since an instant, with every file it could not read whole named apart: a call file it could
 * not read, or one with a line it skipped, may be the owner's conversation, so neither is ever read as none.
 *
 * @param home the state home
 * @param sinceMs the instant whose later writes are read
 * @returns every call read, a torn one folded from the lines that parsed, and what could not be read whole, or why the
 * store could not be listed
 */
function callsSince({
  home,
  sinceMs,
}: {
  home: string;
  sinceMs: number;
}): Result<{ readonly calls: readonly CallRecord[]; readonly unread: readonly string[] }, E2eCallError> {
  const read = readCalls({ home, keep: { sinceIso: new Date(sinceMs).toISOString() } });
  if (read.isErr()) {
    return err(E2eCallErrors.evidenceUnreadable({ detail: read.error.message, path: "talk calls" }));
  }
  const { calls, unreadable } = read.value;
  const torn = tornCallIds({ calls }).map((callId) => `call ${callId} has a line that could not be parsed`);
  return ok({ calls, unread: [...unreadable, ...torn] });
}

/**
 * The typed conversations beside the test's own written to since the last read that found none open, from the call
 * store's files written since that read.
 *
 * @param home the state home
 * @param clearReadMs when that read began
 * @param ownerText what the test's typed turn contains: the run's nonce
 * @returns their ids among the files read, beside every file that could not be read whole — a file it could not read never
 * hides one it could — or why the store could not be listed
 */
export function typedBesideSince({
  home,
  clearReadMs,
  ownerText,
}: {
  home: string;
  clearReadMs: number;
  ownerText: string;
}): Result<{ readonly beside: readonly string[]; readonly unread: readonly string[] }, E2eCallError> {
  return callsSince({ home, sinceMs: clearReadMs }).map(({ calls, unread }) => ({
    beside: typedBesideSinceRead({ calls, ownerText }),
    unread,
  }));
}

/**
 * Whether one transcript is marked as the desktop test instance's: it has an open line, and every one carries
 * `origin.instance: "e2e"`, so no reader of the owner's words takes it (`src/talk/callOrigin.ts`).
 *
 * @param home the state home
 * @param callId the transcript call
 * @returns whether it is marked, or why the store could not be read
 */
export function transcriptMarked({ home, callId }: { home: string; callId: string }): Result<boolean, E2eCallError> {
  return readCallEntries({ callId, home })
    .map((entries) => callOpenedByTestInstance({ entries }))
    .mapErr((error) => E2eCallErrors.evidenceUnreadable({ detail: error.message, path: `call ${callId}` }));
}
