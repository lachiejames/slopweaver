/**
 * The run hooks' cheap pre-pass: measure EVERY journal on disk, rank them, and keep the ones worth a full scan.
 *
 * Three steps, each bounded. Every journal is stat'ed. Then, newest first and only when the hooked session is
 * known, its bytes are searched once for that session's id as a quoted JSON string. A journal that
 * names the session is parsed with the real folds to learn whether the session HOLDS it — the only claim the
 * ranking acts on — up to {@link PRE_PARSE_BYTE_BUDGET} bytes in all; past that it is ranked `mentioned`,
 * unverified. MEASURED: 407 journals, 3.6 MB in all (`du -sh "$SLOPWEAVER_HOME/runs"`).
 *
 * The bytes go into one fixed buffer one byte longer than {@link MAX_JOURNAL_BYTES}, never through a whole-file
 * read: a file that grew past the limit between its stat and its read fills the extra byte and is counted
 * unavailable rather than read without bound. Every failure is counted, never thrown — a hook fails OPEN.
 */

import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import {
  type JournalRankEntry,
  type JournalSkipSummary,
  type JournalTier,
  MAX_HOOK_JOURNALS,
  rankJournals,
} from "./hookJournalRank.js";
import { type ParsedLedger, parseLedger, runStateOf } from "./ledger.js";
import { runOwnership } from "./runOwner.js";
import { isSafeSlug, runJournalPath } from "./runStore.js";

/** The journal suffix, so the slug can be recovered from a filename. */
const JOURNAL_SUFFIX = ".jsonl";

/** Journals larger than this are skipped rather than parsed — an append-only file has no upper bound. */
export const MAX_JOURNAL_BYTES = 512 * 1024;

/**
 * The most journal bytes the pre-pass will PARSE to prove ownership, across every journal naming the session.
 * Eight maximum-size journals; on this machine's 9 KB average journal, about 450 of them.
 */
export const PRE_PARSE_BYTE_BUDGET = 8 * MAX_JOURNAL_BYTES;

/** The journals a hook invocation will fully scan, in rank order, and what it left out. */
export interface JournalSelection {
  readonly slugs: readonly string[];
  readonly summary: JournalSkipSummary;
}

/**
 * Every slug with a journal on disk, or none when the directory does not exist yet.
 *
 * @param runsDir where journals live
 * @returns each slug, sorted alphabetically — a listing order, never a relevance one
 */
export function slugsWithJournals({ runsDir }: { runsDir: string }): readonly string[] {
  try {
    return readdirSync(runsDir)
      .filter((name) => name.endsWith(JOURNAL_SUFFIX))
      .map((name) => name.slice(0, -JOURNAL_SUFFIX.length))
      .toSorted();
  } catch {
    // No runs directory is the normal state on a machine that has never started one. A hook must be inert
    // there, not broken.
    return [];
  }
}

/**
 * Whether a journal fits the per-journal bound at this instant. Unstattable and non-regular count as not.
 *
 * @param runsDir where journals live
 * @param slug the journal's slug
 * @returns its mtime when it is a regular file within {@link MAX_JOURNAL_BYTES}, else `undefined`
 */
function journalWithinBound({ runsDir, slug }: { runsDir: string; slug: string }): number | undefined {
  try {
    const stat = statSync(runJournalPath({ runsDir, slug }));
    return stat.isFile() && stat.size <= MAX_JOURNAL_BYTES ? stat.mtimeMs : undefined;
  } catch {
    return undefined;
  }
}

/** A file's bytes into `buffer`, up to its length; the count read, or `undefined` when the read failed. */
function readInto({ path, buffer }: { path: string; buffer: Buffer }): number | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    let total = 0;
    while (total < buffer.length) {
      const read = readSync(fd, buffer, total, buffer.length - total, total);
      if (read === 0) {
        break;
      }
      total += read;
    }
    return total;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      closeQuietly({ fd });
    }
  }
}

/** Close a descriptor, swallowing a close failure: the bytes are already read, and a hook fails OPEN (r1 review). */
function closeQuietly({ fd }: { fd: number }): void {
  try {
    closeSync(fd);
  } catch {
    // An EIO on close says nothing about the bytes already in the buffer, and throwing would break the hook.
  }
}

/**
 * The session id as a quoted JSON string — a FILTER, never the verdict. It matches the id however the property
 * around it is spaced (a hand-formatted line included, r1 review) and never a longer id, since the closing quote
 * is part of it. A match in another field only costs a parse, which then finds the session does not hold it.
 *
 * @param sessionId the hooked session, as the payload names it
 * @returns the needle, or `undefined` when the session is unidentified and nothing can mention it
 */
export function sessionNeedle({ sessionId }: { sessionId: string | undefined }): Buffer | undefined {
  if (sessionId === undefined) {
    return undefined;
  }
  return Buffer.from(JSON.stringify(sessionId), "utf8");
}

/**
 * Whether journal text proves the session holds a run it has not closed — the same folds the gate runs.
 *
 * A journal with an undecodable line proves nothing, exactly as the gate treats it as ambiguous.
 *
 * @param text the journal's whole text, already bounded by {@link MAX_JOURNAL_BYTES}
 * @param sessionId the hooked session
 * @returns `true` only for a decodable journal this session holds whose run is not closed
 */
export function heldBySession({ text, sessionId }: { text: string; sessionId: string }): boolean {
  const ledger = parseLedger({ text });
  if (ledger.unreadable.length > 0) {
    return false;
  }
  return (
    runOwnership({ events: ledger.events, sessionId }).kind === "mine" &&
    runStateOf({ events: ledger.events }).phase !== "closed"
  );
}

/**
 * A buffer one byte past {@link MAX_JOURNAL_BYTES}, so a journal that outgrew its stat fills the extra byte.
 *
 * @returns a fresh buffer, meant to be reused across every read of one hook invocation
 */
export function journalReadBuffer(): Buffer {
  return Buffer.alloc(MAX_JOURNAL_BYTES + 1);
}

/**
 * Parse one journal through the bounded buffer — never a whole-file read, so a journal appended to after it was
 * stat'ed is refused rather than read without bound (r1 review: a stat then `readFileSync` left that window).
 *
 * @param runsDir where journals live
 * @param slug the journal's slug
 * @param buffer from {@link journalReadBuffer}, reused
 * @returns the parsed ledger, or `undefined` when the journal is not a regular file, is over the bound, or would
 *   not read — a hook skips and counts it, never guesses
 */
export function readJournalBounded({
  runsDir,
  slug,
  buffer,
}: {
  runsDir: string;
  slug: string;
  buffer: Buffer;
}): ParsedLedger | undefined {
  // The slug check matches `readRunJournal`'s; the stat refuses a FIFO or a directory before any open — a read
  // of either could hang the hook.
  if (!isSafeSlug({ slug }) || journalWithinBound({ runsDir, slug }) === undefined) {
    return undefined;
  }
  const read = readInto({ buffer, path: runJournalPath({ runsDir, slug }) });
  if (read === undefined || read > MAX_JOURNAL_BYTES) {
    return undefined;
  }
  return parseLedger({ text: buffer.subarray(0, read).toString("utf8") });
}

/** What one journal's bytes say about the session, and how many bytes the verdict parsed. */
interface Classified {
  readonly tier: JournalTier | undefined;
  readonly parsedBytes: number;
}

/** The pass's fixed state: the session, its needle, the one reused buffer. */
interface ClassifyContext {
  readonly sessionId: string;
  readonly needle: Buffer;
  readonly buffer: Buffer;
}

/** One journal's tier from its bytes, or an `undefined` tier when it grew past the bound or would not read. */
function classify({
  path,
  context,
  budgetLeft,
}: {
  path: string;
  context: ClassifyContext;
  budgetLeft: number;
}): Classified {
  const read = readInto({ buffer: context.buffer, path });
  if (read === undefined || read > MAX_JOURNAL_BYTES) {
    return { parsedBytes: 0, tier: undefined };
  }
  const bytes = context.buffer.subarray(0, read);
  if (!bytes.includes(context.needle)) {
    return { parsedBytes: 0, tier: "other" };
  }
  if (read > budgetLeft) {
    return { parsedBytes: 0, tier: "mentioned" };
  }
  const held = heldBySession({ sessionId: context.sessionId, text: bytes.toString("utf8") });
  return { parsedBytes: read, tier: held ? "held" : "other" };
}

/** Every journal within the bound, newest first, and how many were not. */
function statAll({ runsDir }: { runsDir: string }): {
  readonly found: readonly { readonly slug: string; readonly mtimeMs: number }[];
  readonly unavailable: number;
} {
  const found: { slug: string; mtimeMs: number }[] = [];
  let unavailable = 0;
  for (const slug of slugsWithJournals({ runsDir })) {
    const mtimeMs = journalWithinBound({ runsDir, slug });
    if (mtimeMs === undefined) {
      unavailable += 1;
    } else {
      found.push({ mtimeMs, slug });
    }
  }
  // Newest first, so the parse budget is spent on the journals most likely to be live.
  return { found: found.toSorted((a, b) => b.mtimeMs - a.mtimeMs), unavailable };
}

/**
 * Choose the journals one hook invocation fully scans: the ones this session holds first, then newest first.
 *
 * @param runsDir where journals live
 * @param sessionId the hooked session — the payload's id, the identity `runOwnership` judges against
 * @returns the slugs to scan in rank order, and the counts of what was left out
 */
export function selectHookJournals({
  runsDir,
  sessionId,
}: {
  runsDir: string;
  sessionId: string | undefined;
}): JournalSelection {
  const stats = statAll({ runsDir });
  const needle = sessionNeedle({ sessionId });
  // One buffer for the whole pass, one byte past the limit so a file that outgrew its stat is caught.
  const context =
    needle === undefined || sessionId === undefined ? undefined : { buffer: journalReadBuffer(), needle, sessionId };
  const entries: JournalRankEntry[] = [];
  let skippedUnavailable = stats.unavailable;
  let budgetLeft = PRE_PARSE_BYTE_BUDGET;
  for (const { slug, mtimeMs } of stats.found) {
    if (context === undefined) {
      entries.push({ mtimeMs, slug, tier: "other" });
      continue;
    }
    const classified = classify({ budgetLeft, context, path: runJournalPath({ runsDir, slug }) });
    budgetLeft -= classified.parsedBytes;
    if (classified.tier === undefined) {
      skippedUnavailable += 1;
    } else {
      entries.push({ mtimeMs, slug, tier: classified.tier });
    }
  }
  const ranked = rankJournals({ cap: MAX_HOOK_JOURNALS, entries });
  return {
    slugs: ranked.considered,
    summary: { cap: MAX_HOOK_JOURNALS, skippedBeyondCap: ranked.skippedBeyondCap, skippedUnavailable },
  };
}
