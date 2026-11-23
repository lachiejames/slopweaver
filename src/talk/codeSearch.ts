/**
 * The literal search behind `slopweaver talk code find`.
 *
 * ## Two budgets, because "bounded output" is not "bounded work"
 *
 * A pre-mortem separated these: reading a file whole and then slicing bounds
 * what comes BACK and bounds neither the memory nor the scanning. So a search carries a SCAN budget — how
 * many bytes it is willing to look at, per file and in total — alongside the OUTPUT budget that bounds the
 * excerpts. A file bigger than the per-file scan cap is searched up to the cap and REPORTED as partially
 * scanned, which is a different answer from "no match in that file" and is returned as one.
 *
 * ## Literal, never a pattern
 *
 * The needle is compared with `indexOf`. There is no regular expression anywhere in this path, so no input
 * the model emits can cost more than a linear scan, and a search for `a.*b` looks for those six characters.
 *
 * ## A tracked NAME is checked here too, on exactly the same terms as a read
 *
 * Every path this file opens goes through {@link refuseAliasedPath} first. It did not, until Codex review
 * A review reproduced the gap against the shipped verb: a tracked name that is a symlink to
 * a file OUTSIDE the checkout came back from `talk code find` as an ordinary hit, quoting the outside
 * file's line, while `talk code read` refused the same name. Two readers, one of which made the checks, is
 * the shape that produced it — so the checks now live in one exported function that both call.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

import { appendAll } from "../lib/arrays.js";
import { ok, type Result } from "../lib/result.js";

import { type DirectoryListings, READ_NOFOLLOW, refuseAliasedDescriptor, refuseAliasedPath } from "./checkout.js";
import { spendBudget } from "./codeBounds.js";
import type { TalkError } from "./errors.js";

/** How many bytes of any ONE file a search will look at. */
export const PER_FILE_SCAN_BYTES = 1024 * 1024;

/**
 * How many bytes a whole search will look at, across every file.
 *
 * MEASURED on this repository: **79,834,503 bytes of tracked TEXT across 8,290 files**, beside
 * 5,779,491 bytes of binary in 14. The first value here was 32 MiB, and the very first smoke test of
 * `talk code find` came back `scanBudgetExhausted: true` after 3,077 files — a search that silently could
 * not reach most of the tree. 96 MiB covers today's measurement with room, and {@link binarySkipped} keeps
 * the 5.7 MB of images out of it entirely. Reproduce:
 *
 * ```bash
 * git ls-files -z | xargs -0 cat | wc -c
 * ```
 */
export const TOTAL_SCAN_BYTES = 96 * 1024 * 1024;

/** How many bytes of EXCERPT a whole search will return. */
export const TOTAL_EXCERPT_BYTES = 64 * 1024;

/** How much of a matching line is quoted back. */
export const EXCERPT_CHARS = 200;

/** How far into a file the binary probe looks for a NUL byte. */
export const BINARY_PROBE_BYTES = 8192;

/** One matching line. */
export interface CodeHitLine {
  /** 1-indexed line number within the file. */
  readonly line: number;
  /** The matching line, trimmed and capped at {@link EXCERPT_CHARS}. */
  readonly excerpt: string;
}

/** One matching file and the lines that matched in it. */
export interface CodeHit {
  readonly path: string;
  readonly lines: readonly CodeHitLine[];
  /** Whether the file was larger than the per-file scan cap, so later matches may exist and were not seen. */
  readonly partiallyScanned: boolean;
}

/** Everything a search found, and every way it stopped short. */
export interface CodeSearchResult {
  readonly hits: readonly CodeHit[];
  /** Whether the file limit stopped the search before every tracked file was considered. */
  readonly hitLimitReached: boolean;
  /** Whether the total SCAN budget ran out. */
  readonly scanBudgetExhausted: boolean;
  /** Whether the total EXCERPT budget ran out. */
  readonly excerptBudgetExhausted: boolean;
  /** How many tracked files were opened and searched. */
  readonly filesScanned: number;
  /** How many tracked files were skipped as binary, so a reader knows the search did not look at them. */
  readonly binarySkipped: number;
  /**
   * How many tracked names were skipped as ALIASES — a symlink, a hard link, a symlinked parent directory
   * or a name that is not a regular file. Reported separately from `binarySkipped` because the two are
   * different facts about a checkout, and because a non-zero count here is worth a reader's attention: it
   * says the checkout holds names whose bytes are not the checkout's own.
   */
  readonly aliasSkipped: number;
  /** How many tracked files could not be opened or read, so a match inside one was never seen. */
  readonly unreadableSkipped: number;
}

/**
 * Search the tracked files of a checkout for a literal string.
 *
 * A file that cannot be opened is SKIPPED rather than failing the search — one unreadable file in a
 * checkout should not deny an answer about the rest — and the skip is counted in `unreadableSkipped`.
 *
 * @param root the resolved checkout root
 * @param tracked the tracked paths to search, in order
 * @param text the literal needle
 * @param maxHits how many matching FILES to return at most
 * @returns what was found and every budget that bit
 */
export function searchTrackedFiles({
  root,
  tracked,
  text,
  maxHits,
}: {
  root: string;
  tracked: readonly string[];
  text: string;
  maxHits: number;
}): Result<CodeSearchResult, TalkError> {
  const hits: CodeHit[] = [];
  const totals = freshTotals();
  // One readdir per DIRECTORY rather than per file: the spelling check walks every component of every
  // tracked path, and a search over this repository crosses the same directories thousands of times.
  const listings: DirectoryListings = new Map();

  for (const path of tracked) {
    if (hits.length >= maxHits) {
      totals.hitLimitReached = true;
      break;
    }
    const scanGrant = spendBudget({ spent: totals.scanned, total: TOTAL_SCAN_BYTES, want: PER_FILE_SCAN_BYTES });
    if (scanGrant.grant === 0) {
      totals.scanBudgetExhausted = true;
      break;
    }
    const outcome = scanOneFile({
      excerptBudget: TOTAL_EXCERPT_BYTES - totals.excerpted,
      grant: scanGrant,
      listings,
      path,
      root,
      text,
    });
    record({ outcome, totals });
    appendAll({ from: outcome.hit, into: hits });
  }

  // Spelled out rather than spread: `scanned` and `excerpted` are the search's own bookkeeping, and
  // `codeRun.ts` spreads this whole record into `--json`, so a spread here would publish them.
  return ok({
    aliasSkipped: totals.aliasSkipped,
    binarySkipped: totals.binarySkipped,
    excerptBudgetExhausted: totals.excerptBudgetExhausted,
    filesScanned: totals.filesScanned,
    hitLimitReached: totals.hitLimitReached,
    hits,
    scanBudgetExhausted: totals.scanBudgetExhausted,
    unreadableSkipped: totals.unreadableSkipped,
  });
}

/** Every running total one search keeps while it walks the tracked set. */
interface SearchTotals {
  filesScanned: number;
  binarySkipped: number;
  aliasSkipped: number;
  unreadableSkipped: number;
  scanned: number;
  excerpted: number;
  scanBudgetExhausted: boolean;
  excerptBudgetExhausted: boolean;
  hitLimitReached: boolean;
}

/** A search's counters at the start, before any file has reported. */
function freshTotals(): SearchTotals {
  return {
    aliasSkipped: 0,
    binarySkipped: 0,
    excerpted: 0,
    excerptBudgetExhausted: false,
    filesScanned: 0,
    hitLimitReached: false,
    scanBudgetExhausted: false,
    scanned: 0,
    unreadableSkipped: 0,
  };
}

/** Fold ONE file's outcome into the running totals. Mutates `totals`, returns nothing. */
function record({ totals, outcome }: { totals: SearchTotals; outcome: FileOutcome }): void {
  totals.filesScanned += outcome.searched ? 1 : 0;
  totals.binarySkipped += outcome.binary ? 1 : 0;
  totals.aliasSkipped += outcome.aliased ? 1 : 0;
  totals.unreadableSkipped += outcome.unreadable ? 1 : 0;
  totals.scanned += outcome.scannedBytes;
  totals.excerpted += outcome.excerptSpent;
  totals.scanBudgetExhausted = totals.scanBudgetExhausted || outcome.scanBudgetExhausted;
  totals.excerptBudgetExhausted = totals.excerptBudgetExhausted || outcome.excerptBudgetExhausted;
}

/** What ONE file contributed to a search, and every budget that bit while it did. */
interface FileOutcome {
  /** Whether the file was opened, read as text and searched — a skipped or binary file was not. */
  readonly searched: boolean;
  /** Whether it was skipped as binary, which is a different answer from "no match". */
  readonly binary: boolean;
  /** Whether it was skipped because the tracked name is an alias for bytes that are not the checkout's. */
  readonly aliased: boolean;
  /** Whether it could not be opened or read, so a match inside it was never seen. */
  readonly unreadable: boolean;
  /** Bytes charged to the scan budget; zero for a file nothing was searched in. */
  readonly scannedBytes: number;
  /** Whether the whole-search scan budget ran out while this file was being granted its share. */
  readonly scanBudgetExhausted: boolean;
  /** Excerpt bytes charged to the output budget. */
  readonly excerptSpent: number;
  /** Whether the excerpt budget bit inside this file, so later matches in it were not excerpted. */
  readonly excerptBudgetExhausted: boolean;
  /** The hit, when the file matched — a list so the caller appends it without branching. */
  readonly hit: readonly CodeHit[];
}

/** A file that contributed nothing, before the flag saying why is set on top of it. */
const NOTHING: FileOutcome = {
  aliased: false,
  binary: false,
  excerptBudgetExhausted: false,
  excerptSpent: 0,
  hit: [],
  scanBudgetExhausted: false,
  scannedBytes: 0,
  searched: false,
  unreadable: false,
};

/**
 * Search ONE file and report what it contributed, with no accumulator of its own.
 *
 * Split from {@link searchTrackedFiles} so the loop above is accumulation and the decisions are here: six
 * counters and five branches in one body scored over the `cognitive-complexity` ceiling, and the shape that
 * fixes it is the one that also makes a per-file decision testable on its own.
 */
function scanOneFile({
  root,
  path,
  text,
  grant,
  excerptBudget,
  listings,
}: {
  root: string;
  path: string;
  text: string;
  grant: { grant: number; exhausted: boolean };
  excerptBudget: number;
  listings: DirectoryListings;
}): FileOutcome {
  if (refuseAliasedPath({ listings, path, root }) !== undefined) {
    return { ...NOTHING, aliased: true };
  }
  const content = readForScan({ grant: grant.grant, path: join(root, path) });
  if (content === undefined) {
    return { ...NOTHING, unreadable: true };
  }
  if (content.aliased) {
    return { ...NOTHING, aliased: true };
  }
  if (content.binary) {
    return { ...NOTHING, binary: true };
  }
  const lines = matchingLines({ excerptBudget, needle: text, text: content.text });
  const matched = lines.matches.length > 0;
  return {
    aliased: false,
    binary: false,
    // Not gated on `matched`: a first matching line the budget could not afford is a hit lost, not a file with none.
    excerptBudgetExhausted: lines.budgetBit,
    excerptSpent: matched ? lines.spent : 0,
    hit: matched ? [{ lines: lines.matches, partiallyScanned: content.partiallyScanned, path }] : [],
    scanBudgetExhausted: grant.exhausted,
    scannedBytes: content.scannedBytes,
    searched: true,
    unreadable: false,
  };
}

/**
 * Read up to `grant` bytes of a file for scanning, or undefined when it cannot be read at all.
 *
 * Binary is detected by a NUL byte in what was read rather than by an extension allowlist: an allowlist has
 * to be maintained and is wrong for the file somebody adds next week, while a NUL byte is what actually
 * makes a file unsearchable as text. The bytes are still counted against nothing — a binary file is
 * reported as skipped and its size is not charged to the scan budget, since nothing was searched.
 */
function readForScan({
  path,
  grant,
}: {
  path: string;
  grant: number;
}): { text: string; scannedBytes: number; partiallyScanned: boolean; binary: boolean; aliased: boolean } | undefined {
  let fd: number;
  try {
    fd = openSync(path, READ_NOFOLLOW);
  } catch {
    return undefined;
  }
  try {
    const stat = fstatSync(fd);
    // The name passed every alias check a moment ago; this is the same pair against what was actually
    // OPENED, which is what a writer replacing the file between lstat and open would slip past.
    if (refuseAliasedDescriptor({ path, stat }) !== undefined) {
      return { aliased: true, binary: false, partiallyScanned: false, scannedBytes: 0, text: "" };
    }
    const want = Math.min(stat.size, grant);
    const buffer = Buffer.alloc(want);
    const read = readSync(fd, buffer, 0, want, 0);
    const bytes = buffer.subarray(0, read);
    if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
      return { aliased: false, binary: true, partiallyScanned: false, scannedBytes: 0, text: "" };
    }
    return {
      aliased: false,
      binary: false,
      partiallyScanned: read < stat.size,
      scannedBytes: read,
      text: bytes.toString("utf8"),
    };
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** The lines of a scanned chunk that contain the needle, capped by the remaining excerpt budget. */
function matchingLines({ text, needle, excerptBudget }: { text: string; needle: string; excerptBudget: number }): {
  matches: readonly CodeHitLine[];
  spent: number;
  budgetBit: boolean;
} {
  const matches: CodeHitLine[] = [];
  let spent = 0;
  let budgetBit = false;
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.indexOf(needle) < 0) {
      continue;
    }
    const excerpt = line.trim().slice(0, EXCERPT_CHARS);
    if (spent + excerpt.length > excerptBudget) {
      budgetBit = true;
      break;
    }
    spent += excerpt.length;
    matches.push({ excerpt, line: index + 1 });
  }
  return { budgetBit, matches, spent };
}
