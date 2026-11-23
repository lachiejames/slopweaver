/*
 * How a JSONL FILE streams: the chunked line reader every corpus read in this repository goes through,
 * and the directory scan that finds the files for it.
 *
 * The reader is generic and knows nothing about corpus rows — {@link readJsonlRows} takes the caller's own
 * `parseLine`, and {@link readJsonlLines} hands back raw lines with their byte offsets. That is why this
 * module sits beside `corpusRowCore.ts` rather than above it, and why a caller outside the corpus can use
 * it for any line-delimited file.
 *
 * A missing directory scans as EMPTY with the unreadable path recorded, so a mistyped path looks like "no
 * data" rather than a crash. `resolveCorpusDir` (`corpusResolve.ts`) is what refuses to hand out such a
 * directory, closing the "wrong path looked empty" footgun before a reader ever gets there.
 */

import { closeSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

import { appendAll } from "../lib/arrays.js";
import type { IngestError } from "../lib/ingestError.js";
import { openFileNonBlocking } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import {
  type CorpusWalkJudge,
  corpusWalkJudgeFor,
  type OwnerProtectionResolver,
  type ProtectedSkip,
  type ProtectionOperation,
  protectedSkipLine,
  protectionResolver,
} from "./bronzeProtection.js";
import { sortBronzeEntries } from "./corpusPaths.js";
import { type CorpusStoreError, CorpusStoreErrors } from "./corpusStore.errors.js";

/** A decoder that refuses a malformed byte, keeping a leading byte-order mark as `toString` does. */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** What a strict read delivers for a line holding a byte that is not UTF-8: one lone U+FFFD. */
export const UNDECODABLE_LINE = "�";

/**
 * One line's bytes as text. Strictly, a line holding a byte that is not UTF-8 becomes ONE lone U+FFFD rather than its
 * repaired text: no JSON line parses as that, so a strict reader counts the line as unparsed — the way it already
 * counts a torn one — and never reads a repaired string as what was written. The placeholder is also a line a file
 * can genuinely hold, so `undecodable` says which it was.
 */
function lineText({ bytes, strictUtf8 }: { bytes: Buffer; strictUtf8: boolean }): {
  line: string;
  undecodable: boolean;
} {
  if (!strictUtf8) {
    return { line: bytes.toString("utf8"), undecodable: false };
  }
  try {
    return { line: STRICT_UTF8.decode(bytes), undecodable: false };
  } catch {
    return { line: UNDECODABLE_LINE, undecodable: true };
  }
}

/**
 * The result of walking a corpus tree: the `.jsonl` files found, and — the half that used to be thrown
 * away — every directory the walk could not list.
 *
 * `jsonlFiles` used to `catch { return [] }`, which is how an unreadable bronze directory reached the CLI as
 * *"no corpus yet — run `slopweaver refresh` first"*. That is a READ FAILURE rendered as an ABSENCE, and the
 * two have different fixes (`chmod` vs `refresh`). Measured before this change: `chmod 000` on the bronze dir
 * exited 3 with that message and no hint that anything had gone wrong.
 *
 * Named outside this module by the bronze writer, whose dedup index absorbs one from either walk.
 */
export interface JsonlScan {
  readonly files: readonly JsonlFile[];
  readonly unreadableDirs: readonly string[];
  /** What a judged walk left out because the owner's protect list covers it; always empty from {@link scanJsonl}. */
  readonly protectedSkipped: readonly ProtectedSkip[];
}

/**
 * One `.jsonl` file the walk found, with its size — what the heap guard projects from before reading it.
 *
 * @internal — reached only through {@link JsonlScan}, never named by a consumer.
 */
export interface JsonlFile {
  readonly path: string;
  readonly bytes: number;
}

/**
 * Every `.jsonl` file under `dir`, recursively, plus the dirs that could not be listed.
 *
 * EXPORTED for the bronze writer's streaming dedup index ({@link ./bronzeDedupIndex.buildBronzeDedupIndex}),
 * which walks the same tree this reader does but must not RETAIN what it walks. It needs both halves of the
 * result for the same reason {@link readCorpusTally} does: a directory that could not be listed is the exact
 * condition under which the writer must refuse rather than re-append a source it already holds, and
 * `listBronzeFiles` (which swallows a failed `readdir` as an empty source) would invert that guarantee.
 *
 * @param dir the corpus tree to walk
 * @returns the `.jsonl` files found with their sizes, and every directory the walk could not list
 */
export function scanJsonl({ dir }: { dir: string }): JsonlScan {
  let entries: readonly string[];
  try {
    // ORDERED, so the read order of bronze is deterministic rather than filesystem-dependent, and so
    // file-then-line order IS write order — which is what lets `latestRecords` break a timestamp tie by
    // recency for a kind where that is meaningful. It is NOT a plain sort: see
    // {@link ./corpusPaths.sortBronzeEntries} for the canonical compacted file, which a plain sort put
    // last while its contents are the OLDEST rows the source has.
    entries = sortBronzeEntries({ entries: readdirSync(dir) });
  } catch {
    return { files: [], protectedSkipped: [], unreadableDirs: [dir] };
  }
  const files: JsonlFile[] = [];
  const unreadableDirs: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = safeFs({ execute: () => statSync(full), operation: "scanJsonl.stat", path: full });
    if (stat.isErr()) {
      unreadableDirs.push(full);
    } else if (stat.value.isDirectory()) {
      const nested = scanJsonl({ dir: full });
      appendAll({ from: nested.files, into: files });
      appendAll({ from: nested.unreadableDirs, into: unreadableDirs });
    } else if (entry.endsWith(".jsonl")) {
      files.push({ bytes: stat.value.size, path: full });
    }
  }
  return { files, protectedSkipped: [], unreadableDirs };
}

/**
 * {@link scanJsonl} with every step judged first, so a walk never stats, follows or opens a protected path.
 *
 * The ORDER is the point. The root is judged as a `list` before it is listed, and REFUSED when an entry covers it.
 * Every entry is judged as a `list` before `statSync` follows it, and a `.jsonl` as a `read` before it is returned for
 * opening; a covered one is SKIPPED and named in `protectedSkipped`, so a directory symlink pointing into a protected
 * tree is never entered, and one `no-access` entry under the root never refuses a reader of the rest of it. Sort order
 * and the unreadable-directory half are {@link scanJsonl}'s exactly; the unguarded walk stays as it is for every
 * reader this does not cover.
 *
 * @param dir the corpus tree to walk
 * @param walk refuses the root, and names the entry covering any step the walk then skips
 * @returns the same scan {@link scanJsonl} returns plus what it skipped, or the root's refusal
 */
export function scanJsonlGuarded({ dir, walk }: { dir: string; walk: CorpusWalkJudge }): Result<JsonlScan> {
  return walk.judge({ access: "list", path: dir }).map(() => walkJudged({ dir, walk }));
}

/**
 * The judged walk below a root that was already judged. It never refuses, because every covered step is skipped.
 *
 * @param dir a directory the walk has judged
 * @param walk names the entry covering a step
 * @returns the scan of everything under `dir`, with what it skipped
 */
function walkJudged({ dir, walk }: { dir: string; walk: CorpusWalkJudge }): JsonlScan {
  let entries: readonly string[];
  try {
    entries = sortBronzeEntries({ entries: readdirSync(dir) });
  } catch {
    return { files: [], protectedSkipped: [], unreadableDirs: [dir] };
  }
  const files: JsonlFile[] = [];
  const unreadableDirs: string[] = [];
  const protectedSkipped: ProtectedSkip[] = [];
  for (const name of entries) {
    const walked = guardedEntry({ name, path: join(dir, name), walk });
    appendAll({ from: walked.files, into: files });
    appendAll({ from: walked.unreadableDirs, into: unreadableDirs });
    appendAll({ from: walked.protectedSkipped, into: protectedSkipped });
  }
  return { files, protectedSkipped, unreadableDirs };
}

/**
 * One warning per path a judged walk skipped, so a whole-corpus reader names what it left out rather than reading
 * the rest as the whole.
 *
 * @param scan the walk's result
 * @returns the warnings, empty when nothing was skipped
 */
export function protectedSkipWarnings({ scan }: { scan: JsonlScan }): readonly string[] {
  return scan.protectedSkipped.map((skip) => `NOT READ, protected by the owner's list: ${protectedSkipLine({ skip })}`);
}

/**
 * {@link scanJsonlGuarded} judged by the owner's protect list: the judge built first, from both registries, so a
 * walk whose protection cannot be read lists nothing, and a protected root refuses before it is listed.
 *
 * @param home the Slopweaver home whose registries apply, beside the account's own default
 * @param dir the corpus tree to walk, which may sit outside `home`
 * @param operation what the verb is doing, as its refusal says it
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the scan with what it skipped, or the refusal line
 */
export function scanJsonlProtected({
  home,
  dir,
  operation,
  protection,
}: {
  home: string;
  dir: string;
  operation: ProtectionOperation;
  protection?: OwnerProtectionResolver | undefined;
}): Result<JsonlScan> {
  return corpusWalkJudgeFor({ operation, protection: protectionResolver({ home, protection }) }).andThen((walk) =>
    scanJsonlGuarded({ dir, walk }),
  );
}

/**
 * A whole-corpus reader's file set: the root judged by the owner's protect list before it is even statted, then
 * walked with every step judged. The one shape `readCorpusTally` and `censusCorpus` share, so the two readers cannot
 * disagree about what a protected, absent or non-directory root reads as, or about what a covered entry under it is.
 *
 * @param dir the corpus root, which may sit outside `home`
 * @param home the Slopweaver home whose registries apply, beside the account's own default
 * @param protection an injected resolver, or `undefined` for both of the owner's registries
 * @param statOperation the label a failed stat's typed io error carries
 * @returns the scan, the warning an absent or non-directory root reads as, or `CORPUS_PROTECTED` / the stat failure
 */
export function scanCorpusRoot({
  dir,
  home,
  protection,
  statOperation,
}: {
  dir: string;
  home: string;
  protection: OwnerProtectionResolver | undefined;
  statOperation: string;
}): Result<{ scan: JsonlScan } | { empty: string }, CorpusStoreError> {
  const judged = corpusWalkJudgeFor({
    operation: { target: "the corpus", verb: "read" },
    protection: protectionResolver({ home, protection }),
  }).andThen((walk) => walk.judge({ access: "list", path: dir }).map(() => walk));
  if (judged.isErr()) {
    return err(CorpusStoreErrors.protectedRead({ dir, lines: judged.error }));
  }
  // The stat goes through safeFs → a typed io error, so ENOENT (missing dir ⇒ treat as empty) is read off the
  // typed `code`, not a shape-sniffed `isErrno` guard.
  const statted = safeFs({ execute: () => statSync(dir).isDirectory(), operation: statOperation, path: dir });
  if (statted.isErr()) {
    if (statted.error.code === "ENOENT") {
      return ok({ empty: `corpus dir not found (treated as empty): ${dir}` });
    }
    return err(CorpusStoreErrors.statFailed({ dir, message: statted.error.message }));
  }
  if (!statted.value) {
    return ok({ empty: `not a directory (treated as empty): ${dir}` });
  }
  return ok({ scan: walkJudged({ dir, walk: judged.value }) });
}

/**
 * One entry of a guarded walk: judged as a list before it is statted, recursed into as a directory, and judged as a
 * read when it is a `.jsonl` the caller will open. A covered entry is skipped and named, never statted or opened.
 *
 * @param path the entry's full path
 * @param name the entry's own name, which decides whether it is a `.jsonl`
 * @param walk names the entry covering a step
 * @returns what the entry contributes to the scan
 */
function guardedEntry({ path, name, walk }: { path: string; name: string; walk: CorpusWalkJudge }): JsonlScan {
  const listed = walk.coverOf({ access: "list", path });
  if (listed !== undefined) {
    return { files: [], protectedSkipped: [{ entry: listed, path }], unreadableDirs: [] };
  }
  const stat = safeFs({ execute: () => statSync(path), operation: "scanJsonl.stat", path });
  if (stat.isErr()) {
    return { files: [], protectedSkipped: [], unreadableDirs: [path] };
  }
  if (stat.value.isDirectory()) {
    return walkJudged({ dir: path, walk });
  }
  if (!name.endsWith(".jsonl")) {
    return { files: [], protectedSkipped: [], unreadableDirs: [] };
  }
  const read = walk.coverOf({ access: "read", path });
  if (read !== undefined) {
    return { files: [], protectedSkipped: [{ entry: read, path }], unreadableDirs: [] };
  }
  return { files: [{ bytes: stat.value.size, path }], protectedSkipped: [], unreadableDirs: [] };
}

/**
 * Bytes read from a file per `readSync` call — the bound on the per-file transient, whatever the file's
 * size, and the quantity the in-file heap check projects. Exported so a test can assert that projection is
 * this bounded figure rather than anything derived from the file.
 */
export const READ_CHUNK_BYTES = 8 * 1024 * 1024;

const NEWLINE = 0x0a;

/**
 * Read a JSONL file line by line with a BOUNDED transient — one chunk plus one line — instead of one string
 * holding the whole file. Synchronous on purpose: the reader's callers are synchronous `Result` pipelines,
 * and the no-headless gate keeps the async child-process surface out of this tree.
 *
 * **This is the only way any Slopweaver code may read a data-scale `.jsonl`.** Two things the bound buys,
 * both reachable on the real corpus: a window file has no record ceiling, and the largest one today is
 * 2.34 GB. Read as one `utf8` string that is up to 4.7 GB of transient heap (a two-byte string, since the
 * content is not pure latin1) sitting beside everything parsed from it, and any file past 512 MiB would not
 * read at all — V8 throws `Cannot create a string longer than 0x1fffffe8 characters`, which turned one wide
 * backfill window into an "unreadable" file for every bronze-touching verb at once.
 *
 * Splitting on `0x0a` in the raw bytes is safe for UTF-8: a newline byte never occurs inside a multi-byte
 * sequence, so every slice decoded here is a whole line. It also matches `split("\n")` rather than
 * `readline` exactly where the two differ — U+2028/U+2029 are line terminators to Node's `readline` but not
 * to `split`, and corpus payloads carry arbitrary authored text.
 *
 * Every line is delivered with its own BYTE RANGE in the file, which is what makes a row addressable
 * without holding it: the prebuilt lexical index records `(file, byteOffset, byteLength)` per document, so
 * a query re-reads the dozen rows it cites instead of the corpus they came from. The range is measured in
 * BYTES rather than characters on purpose — it is what `pread` takes, and a UTF-8 line's character count
 * is not its length on disk.
 *
 * @param path the file to read
 * @param onLine called once per line, in order, with the line's text, its 0-based index, and its byte
 *   range in the file (the trailing empty slice after a final newline is delivered as a blank line,
 *   exactly as `split("\n")` delivered it — with a zero-length range at the end of the file)
 * @param onChunk called before each chunk is consumed, with the bytes of the file already consumed by the
 *   lines delivered so far; return `false` to stop the read there. This is the seam the heap guard hangs
 *   off — a reader that watches the REAL heap between chunks needs no per-file size projection at all, and
 *   a reader that is refused there can say how far it actually got. Omit it to read the whole file.
 * @param startByteOffset where to begin, which MUST be a line boundary — the end of a line this reader
 *   itself reported, never a number a caller computed. Defaults to the start of the file. Every offset
 *   `onLine` reports stays absolute in the file rather than relative to this start, so a resumed read's
 *   ranges mean the same thing a whole read's do.
 * @param strictUtf8 deliver a line holding a byte that is not UTF-8 as one lone U+FFFD, never its repaired text — for
 *   a reader that quotes what it reads verbatim, so damage is an unparsed line rather than words nobody wrote; the
 *   line's `undecodable` says it was that placeholder, never a U+FFFD the file really held
 * @param noFollow throw rather than read through a symlink at the path, for a journal no write here ever links
 */
export function readJsonlLines({
  path,
  onLine,
  onChunk,
  startByteOffset = 0,
  strictUtf8 = false,
  noFollow = false,
}: {
  path: string;
  onLine: (args: { line: string; index: number; byteOffset: number; byteLength: number; undecodable: boolean }) => void;
  onChunk?: (args: { bytesConsumed: number }) => boolean;
  startByteOffset?: number;
  strictUtf8?: boolean;
  noFollow?: boolean;
}): void {
  // A FIFO with no writer blocks a plain open forever, which hung `profile words` on a relay ledger made one.
  const fd = openFileNonBlocking({ noFollow, path });
  try {
    readJsonlDescriptorLines({
      fd,
      onLine,
      ...(onChunk === undefined ? {} : { onChunk }),
      startByteOffset,
      strictUtf8,
    });
  } finally {
    closeSync(fd);
  }
}

/**
 * {@link readJsonlLines} over a descriptor the caller already opened and closes — for a reader that must judge the
 * file on that one descriptor and derive something else from the very bytes the lines came from, never from a
 * second open of a path that could have been replaced in between.
 *
 * @param fd an open descriptor, read by position from `startByteOffset`; this never closes it
 * @param onLine as {@link readJsonlLines}'s
 * @param onChunk as {@link readJsonlLines}'s
 * @param onBytes called with every raw chunk exactly as read, in file order, before its lines are delivered — the
 *   bytes it sees, concatenated, are the bytes every delivered line was decoded from
 * @param startByteOffset as {@link readJsonlLines}'s
 * @param strictUtf8 as {@link readJsonlLines}'s
 */
export function readJsonlDescriptorLines({
  fd,
  onLine,
  onChunk,
  onBytes,
  startByteOffset = 0,
  strictUtf8 = false,
}: {
  fd: number;
  onLine: (args: { line: string; index: number; byteOffset: number; byteLength: number; undecodable: boolean }) => void;
  onChunk?: (args: { bytesConsumed: number }) => boolean;
  onBytes?: (args: { bytes: Buffer }) => void;
  startByteOffset?: number;
  strictUtf8?: boolean;
}): void {
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let carry: Buffer = Buffer.alloc(0);
  let index = 0;
  // Where the NEXT read starts, tracked here rather than by the descriptor's cursor: a resumed read begins
  // somewhere other than zero, and `readSync`'s sequential mode has no way to say so.
  let position = startByteOffset;
  // Where `window`'s first byte sits in the file: the carry starts that many bytes BEFORE the read position,
  // which keeps a line's offset absolute rather than relative to whichever chunk happened to contain it.
  let windowOffset = startByteOffset;
  for (;;) {
    // `windowOffset` is where the unconsumed carry begins, so it IS the byte count of everything already
    // delivered as whole lines — newline separators included, which a sum of line ranges would miss.
    if (onChunk !== undefined && !onChunk({ bytesConsumed: windowOffset })) {
      return;
    }
    const read = readSync(fd, chunk, 0, READ_CHUNK_BYTES, position);
    if (read === 0) {
      break;
    }
    position += read;
    onBytes?.({ bytes: chunk.subarray(0, read) });
    const window = carry.length > 0 ? Buffer.concat([carry, chunk.subarray(0, read)]) : chunk.subarray(0, read);
    let start = 0;
    for (let at = window.indexOf(NEWLINE, start); at !== -1; at = window.indexOf(NEWLINE, start)) {
      onLine({
        byteLength: at - start,
        byteOffset: windowOffset + start,
        index,
        ...lineText({ bytes: window.subarray(start, at), strictUtf8 }),
      });
      index += 1;
      start = at + 1;
    }
    // Copy the partial tail out of the reusable chunk — the next read overwrites it.
    carry = Buffer.from(window.subarray(start));
    windowOffset += start;
  }
  onLine({ byteLength: carry.length, byteOffset: windowOffset, index, ...lineText({ bytes: carry, strictUtf8 }) });
}

/**
 * Stream a JSONL file into typed rows, one line at a time, through a caller-supplied line parser.
 *
 * The shared shape behind every sibling store (`members/`, `structures/`, `history/`) and any other reader
 * of a corpus-scale JSONL: each of them used to `readFileSync(path, "utf8")` and `split("\n")` the result,
 * which is the exact construction that stops working at 512 MiB and holds a whole file of transient heap
 * long before that. The per-line contract is unchanged — a bad line becomes a line-numbered warning and
 * never aborts the read — so a caller's behaviour is identical for every file small enough that the old
 * shape worked at all.
 *
 * @param path the JSONL file to read
 * @param parseLine the per-line parser: a row, or the reason the line was rejected
 * @returns the rows and their line-numbered warnings, or the typed fs error (`ENOENT` for an absent file,
 *   which callers read off `code` to mean "nothing stored yet")
 */
export function readJsonlRows<TRow>({
  path,
  parseLine,
}: {
  path: string;
  parseLine: (args: { line: string }) => { row: TRow } | { error: string };
}): Result<{ rows: readonly TRow[]; warnings: readonly string[] }, IngestError> {
  const rows: TRow[] = [];
  const warnings: string[] = [];
  return safeFs({
    execute: () => {
      readJsonlLines({
        onLine: ({ index, line }) => {
          if (line.trim().length === 0) {
            return;
          }
          const result = parseLine({ line });
          if ("row" in result) {
            rows.push(result.row);
          } else {
            warnings.push(`line ${String(index + 1)}: ${result.error}`);
          }
        },
        path,
      });
      return { rows, warnings };
    },
    operation: "readJsonlRows",
    path,
  });
}
