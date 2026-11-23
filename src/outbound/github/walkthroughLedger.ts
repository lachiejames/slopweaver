/**
 * The WALKTHROUGH-THREAD REGISTER — which of the owner's review threads a landing verb resolved, and which of those it
 * later reopened because a colleague's reply sat collapsed under that resolve.
 *
 * ## Why the landing needs a memory
 *
 * GitHub's `resolveReviewThread` takes a node id and no precondition, so a colleague's reply landing between the
 * landing's read and its resolve is resolved with it. GitHub then records the resolve as the owner's, because the fleet
 * presses with the owner's token, and a resolve the owner made by hand after reading that reply looks exactly the same.
 * Both halves were measured: a guard reading GitHub alone reopened the owner's deliberate
 * resolves on every landing, and a guard that forgot a thread once it was reopened let `github merge --admin`
 * land over the reply on the next run. Only the landing knows which resolves were its own.
 *
 * ## Shape
 *
 * One append-only `ledgers/walkthrough-threads.jsonl` under the state home, one {@link WalkthroughLedgerRow}
 * per thread per act. A `resolving` row is written BEFORE the resolve is sent, so a resolve that went through
 * and a run that died before saying so are still remembered; a `released` row once GitHub shows that resolve
 * did not take, so a resolve the owner makes later is not mistaken for it; a `surfaced` row after a reopen went
 * through, so a resolve the owner makes afterwards is theirs and is left alone. Same lock and permissions idiom as
 * `./checksReadLedger.ts`, streamed with `readJsonlLines`.
 *
 * ## A torn append never wedges a landing
 *
 * Every landing on every pull request reads this one file and refuses on a row it cannot parse, so a write cut
 * short (a full disk, a crash) must not leave a fragment that refuses every landing after it. Each append is
 * one write of whole `\n`-terminated rows, then an `fsync` before the resolve it records is sent. So an
 * unparseable final line with no trailing newline is PROVABLY a torn write: the reader skips it, and the next
 * append trims the unterminated tail off before writing. Any other unreadable line is still refused.
 *
 * A torn row that still PARSES is kept, and the reader never judges the tail apart from the rows it streamed,
 * so a concurrent append cannot make it drop a complete row it read. Keeping one errs only one way: a
 * `resolving` row from a failed write names a resolve never sent, a `released` row is written only once GitHub
 * shows the thread open, and a `surfaced` row only after the reopen went through — at worst one extra reopen,
 * never a reply forgotten.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readSync, statSync, truncateSync, writeSync } from "node:fs";

import { acquireOperationLock } from "../../admit/operationLock.js";
import { readJsonlLines } from "../../corpus/corpusStore.js";
import { needsSeparator } from "../../lib/appendSeparator.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonStringify } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";

/** Owner-only permissions, matching `./checksReadLedger.ts` — a row names the owner's pull requests. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The lock key every writer of this register takes. */
const LOCK_KEY = "walkthrough-threads-ledger";

/** How far back {@link tornTailStart} reads at a time, looking for the last complete row's newline. */
const TAIL_CHUNK_BYTES = 4096;

/** The landing is about to resolve a thread, or GitHub shows that resolve did not take. */
interface WalkthroughResolveAct {
  readonly kind: "resolving" | "released";
  /** The thread's GraphQL node id. */
  readonly threadId: string;
}

/** The landing reopened a thread over a colleague's reply. */
interface WalkthroughSurfacedAct {
  readonly kind: "surfaced";
  readonly threadId: string;
  /**
   * When the reply it reopened over was written, and how many comments the thread held then. A reply the owner has
   * not been shown raises the count even when GitHub stamps it the same instant, and a deleted comment followed
   * by a new one moves the instant, so the thread is exempt from the reopen only while NEITHER has grown.
   * An edit to a reply is neither, the same as GitHub's own
   * conversation rule, which an edit does not reopen either.
   */
  readonly replyAtIso: string;
  readonly replyCount: number;
}

/** One act on one thread, as the landing step reports it. */
export type WalkthroughAct = WalkthroughResolveAct | WalkthroughSurfacedAct;

/** One act as the register stores it: which pull request, and when. */
export type WalkthroughLedgerRow = WalkthroughAct & {
  /** `owner/name`, as the landing verb addressed it. */
  readonly repo: string;
  readonly number: number;
  readonly atIso: string;
};

/** The register cannot be read or written where it lives. */
interface WalkthroughLedgerUnreadableError {
  readonly code: "REGISTER_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A stored line is not a well-formed row. Carries the line number so it can be fixed rather than guessed. */
interface WalkthroughLedgerCorruptRowError {
  readonly code: "CORRUPT_ROW";
  readonly message: string;
  readonly lineNumber: number;
}

/** Another session holds the register's write lock. Contention, not corruption — the caller may retry. */
interface WalkthroughLedgerBusyError {
  readonly code: "REGISTER_BUSY";
  readonly message: string;
}

/** Every way reading or appending to this register can fail. */
export type WalkthroughLedgerError =
  WalkthroughLedgerUnreadableError | WalkthroughLedgerCorruptRowError | WalkthroughLedgerBusyError;

/** The factory the real code and its tests both build failures through. */
export const WalkthroughLedgerErrors = {
  busy: ({ why }: { why: string }): WalkthroughLedgerBusyError => ({
    code: "REGISTER_BUSY",
    message: `the walkthrough-thread register is locked by another session: ${why}`,
  }),
  corruptRow: ({ lineNumber, why }: { lineNumber: number; why: string }): WalkthroughLedgerCorruptRowError => ({
    code: "CORRUPT_ROW",
    lineNumber,
    message: `walkthrough-thread register line ${String(lineNumber)} is not a row this build can read: ${why}`,
  }),
  unreadable: ({ cause, path }: { cause: string; path: string }): WalkthroughLedgerUnreadableError => ({
    code: "REGISTER_UNREADABLE",
    message: `the walkthrough-thread register at ${path} could not be read: ${cause}`,
    path,
  }),
} as const;

/** Decode one stored line, refusing anything a reader would otherwise have to guess at. */
function parseLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<WalkthroughLedgerRow, WalkthroughLedgerError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    return err(WalkthroughLedgerErrors.corruptRow({ lineNumber, why: errorMessage({ error: cause }) }));
  }
  if (!isRecord(parsed)) {
    return err(WalkthroughLedgerErrors.corruptRow({ lineNumber, why: "the line is not a JSON object" }));
  }
  const { kind, repo, number, threadId, atIso, replyAtIso, replyCount } = parsed;
  if (kind !== "resolving" && kind !== "released" && kind !== "surfaced") {
    return err(
      WalkthroughLedgerErrors.corruptRow({ lineNumber, why: "`kind` is none of `resolving`, `released`, `surfaced`" }),
    );
  }
  if (typeof repo !== "string" || typeof threadId !== "string" || threadId.length === 0) {
    return err(WalkthroughLedgerErrors.corruptRow({ lineNumber, why: "`repo` or `threadId` is not a string" }));
  }
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    return err(WalkthroughLedgerErrors.corruptRow({ lineNumber, why: "`number` is not a positive whole number" }));
  }
  if (typeof atIso !== "string" || Number.isNaN(Date.parse(atIso))) {
    return err(WalkthroughLedgerErrors.corruptRow({ lineNumber, why: "`atIso` is not an instant" }));
  }
  if (kind !== "surfaced") {
    return ok({ atIso, kind, number, repo, threadId });
  }
  if (typeof replyAtIso !== "string" || Number.isNaN(Date.parse(replyAtIso))) {
    return err(
      WalkthroughLedgerErrors.corruptRow({ lineNumber, why: "a `surfaced` row's `replyAtIso` is not an instant" }),
    );
  }
  if (typeof replyCount !== "number" || !Number.isInteger(replyCount) || replyCount <= 0) {
    return err(
      WalkthroughLedgerErrors.corruptRow({
        lineNumber,
        why: "a `surfaced` row's `replyCount` is not a positive whole number",
      }),
    );
  }
  return ok({ atIso, kind, number, replyAtIso, replyCount, repo, threadId });
}

/**
 * Every row the register holds, in the order they were written.
 *
 * An install that never resolved a thread is EMPTY rather than a failure; a register that exists and cannot be
 * read is a failure, because an unreadable memory must never read as one holding nothing. The one line skipped
 * is an unparseable torn final write, as the file overview says; every row that parses is returned.
 *
 * @param home the state home
 * @returns every row, or the first failure
 */
export function readWalkthroughLedger({
  home,
}: {
  home: string;
}): Result<readonly WalkthroughLedgerRow[], WalkthroughLedgerError> {
  const path = stateHomePaths({ home }).walkthroughThreadsJsonl;
  try {
    statSync(path);
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return ok([]);
    }
    return err(WalkthroughLedgerErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  }
  const rows: WalkthroughLedgerRow[] = [];
  let failure: WalkthroughLedgerError | undefined;
  let last: "row" | "failure" | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim().length === 0) {
          return;
        }
        if (failure !== undefined) {
          last = "row";
          return;
        }
        const parsed = parseLine({ line, lineNumber: index + 1 });
        if (parsed.isErr()) {
          failure = parsed.error;
          last = "failure";
          return;
        }
        rows.push(parsed.value);
        last = "row";
      },
      path,
    });
  } catch (cause) {
    return err(WalkthroughLedgerErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  }
  if (failure !== undefined && !(last === "failure" && needsSeparator({ path }))) {
    return err(failure);
  }
  return ok(rows);
}

/**
 * Where a torn final write begins: just past the last newline, or the start of a file that has none.
 *
 * Read backwards a chunk at a time, so finding it never loads the whole register.
 *
 * @param path the register, already known not to end in a newline
 * @returns the byte length to truncate the register back to
 */
function tornTailStart({ path }: { path: string }): number {
  const handle = openSync(path, "r");
  try {
    const chunk = Buffer.alloc(TAIL_CHUNK_BYTES);
    let end = statSync(path).size;
    while (end > 0) {
      const start = Math.max(0, end - TAIL_CHUNK_BYTES);
      const read = readSync(handle, chunk, 0, end - start, start);
      const newline = chunk.subarray(0, read).lastIndexOf(0x0a);
      if (newline !== -1) {
        return start + newline + 1;
      }
      end = start;
    }
    return 0;
  } finally {
    closeSync(handle);
  }
}

/**
 * Write whole rows and flush them to disk, trimming a torn final write off first.
 *
 * A write that fails part way is cut back to where it began, best effort, so a caller told nothing was
 * recorded is not left with some of its rows recorded anyway.
 *
 * @param path the register
 * @param text the rows, each `\n`-terminated
 */
function durableAppend({ path, text }: { path: string; text: string }): void {
  if (needsSeparator({ path })) {
    truncateSync(path, tornTailStart({ path }));
  }
  const handle = openSync(path, "a", FILE_MODE);
  const before = statSync(path).size;
  try {
    const bytes = Buffer.from(text);
    let written = 0;
    while (written < bytes.length) {
      written += writeSync(handle, bytes, written, bytes.length - written);
    }
    fsyncSync(handle);
  } catch (cause) {
    try {
      truncateSync(path, before);
    } catch {
      // The torn tail stays for the reader to skip and the next append to trim.
    }
    throw cause;
  } finally {
    closeSync(handle);
  }
}

/**
 * Append rows under one lock, creating the register if it is not there yet.
 *
 * @param rows the acts to record, one per thread
 * @param nowIso the instant the lock is taken at, so the lock's own staleness check has a clock
 * @returns the path written, or the failure
 */
export function appendWalkthroughLedger({
  home,
  rows,
  nowIso,
}: {
  home: string;
  rows: readonly WalkthroughLedgerRow[];
  nowIso: string;
}): Result<string, WalkthroughLedgerError> {
  const paths = stateHomePaths({ home });
  const path = paths.walkthroughThreadsJsonl;
  try {
    mkdirSync(paths.ledgers, { mode: DIR_MODE, recursive: true });
  } catch (cause) {
    return err(WalkthroughLedgerErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  }
  const lock = acquireOperationLock({ home, key: LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(WalkthroughLedgerErrors.busy({ why: lock.error }));
  }
  try {
    const encoded = rows.map((row) => safeJsonStringify({ label: "a walkthrough-thread register row", value: row }));
    durableAppend({ path, text: encoded.map((line) => `${line}\n`).join("") });
    return ok(path);
  } catch (cause) {
    return err(WalkthroughLedgerErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  } finally {
    lock.value.release();
  }
}

/** What the register remembers about one pull request's threads. */
export interface WalkthroughMemory {
  /** Every thread whose latest landing resolve was not released: the landing may have resolved it. */
  readonly resolved: readonly string[];
  /** Each thread a landing reopened over a colleague's reply, to the thread as it stood at the latest reopen. */
  readonly surfaced: Readonly<Record<string, { readonly replyAtIso: string; readonly replyCount: number }>>;
}

/**
 * Fold the register down to one pull request, in written order: a `released` row cancels the `resolving` row
 * before it, a later `resolving` row counts again, and a thread surfaced twice keeps the later reopen.
 *
 * @param rows every row the register holds
 * @param repo `owner/name`, compared case-insensitively
 * @returns the threads resolved and surfaced on that pull request
 */
export function walkthroughMemory({
  rows,
  repo,
  number,
}: {
  rows: readonly WalkthroughLedgerRow[];
  repo: string;
  number: number;
}): WalkthroughMemory {
  const resolved = new Set<string>();
  const surfaced = new Map<string, { readonly replyAtIso: string; readonly replyCount: number }>();
  for (const row of rows) {
    if (row.repo.toLowerCase() !== repo.toLowerCase() || row.number !== number) {
      continue;
    }
    if (row.kind === "surfaced") {
      surfaced.set(row.threadId, { replyAtIso: row.replyAtIso, replyCount: row.replyCount });
    } else if (row.kind === "resolving") {
      resolved.add(row.threadId);
    } else {
      resolved.delete(row.threadId);
    }
  }
  return { resolved: [...resolved], surfaced: Object.fromEntries(surfaced) };
}
