/**
 * The pure half of `./wakeMergeProof.ts`'s two git reads: each reads git's output as a stream of byte chunks and keeps
 * only the first few bytes of every record, so a listing as large as the checkout is never held as one string.
 *
 * MEASURED on the main checkout (`git ls-files -v -s -z | wc -c`): 1,942,418 bytes. Read whole through
 * `execFileSync`, that listing passed node's 1 MiB default output buffer, every merge proof failed with `spawnSync git
 * ENOBUFS`, and the wake asked `handover finish` about none of the 30 merged parks whose worktree was gone. Both verdicts below need only a record's opening
 * bytes — an index entry's tag and mode, a status line's `# ` marker and `HEAD`'s commit — so nothing longer is kept.
 */

/** NUL, which ends every `git ls-files -z` entry. */
export const NUL = 0;

/** Newline, which ends every `git status --porcelain=v2` line. */
export const NEWLINE = 10;

/**
 * Enough of an index entry for its tag and mode: `<tag> <mode> ` is nine bytes, and the rest is never read.
 */
export const INDEX_HEAD_BYTES = 16;

/**
 * Enough of a status line for `# branch.oid ` (13 bytes) and a SHA-256 commit (64 hex), with room to spare.
 */
export const STATUS_HEAD_BYTES = 128;

/** The mode git records for a submodule's gitlink. */
const GITLINK_MODE = "160000";

/**
 * The opening bytes of every non-empty record in a chunked byte stream, a delimiter split across two chunks included.
 * Decoded as latin1: both readers compare ASCII only, and a multi-byte path character past the head is never seen.
 *
 * @param chunks git's output, in order
 * @param delimiter the byte that ends a record
 * @param headBytes how many leading bytes of each record to keep
 * @returns each record's head, in order
 */
export function* recordHeads({
  chunks,
  delimiter,
  headBytes,
}: {
  chunks: Iterable<Uint8Array>;
  delimiter: number;
  headBytes: number;
}): Generator<string> {
  const record: OpenRecord = { head: [], length: 0 };
  for (const chunk of chunks) {
    for (const byte of chunk) {
      const ended = takeByte({ byte, delimiter, headBytes, record });
      if (ended !== undefined) {
        yield ended;
      }
    }
  }
  if (record.length > 0) {
    yield String.fromCharCode(...record.head);
  }
}

/** The record being read: its kept opening bytes, and how many bytes it has run to so far. */
interface OpenRecord {
  head: number[];
  length: number;
}

/**
 * Feed one byte to the open record, ending it on the delimiter.
 *
 * @returns the head of a non-empty record the byte ended, else `undefined`
 */
function takeByte({
  byte,
  delimiter,
  headBytes,
  record,
}: {
  byte: number;
  delimiter: number;
  headBytes: number;
  record: OpenRecord;
}): string | undefined {
  if (byte !== delimiter) {
    if (record.head.length < headBytes) {
      record.head.push(byte);
    }
    record.length += 1;
    return undefined;
  }
  const ended = record.length > 0 ? String.fromCharCode(...record.head) : undefined;
  record.head = [];
  record.length = 0;
  return ended;
}

/**
 * What in the index stops `git status` from vouching for the tree a probe reads, if anything.
 *
 * A flagged entry — `assume-unchanged` (a lowercase tag) or `skip-worktree` (`S`) — hides its file's edits from status.
 * A submodule is a second repository: status reads only its gitlink and its own status, never
 * its index flags, its ignore rules or whether it was ever checked out, so a probe under it reads a tree this proof
 * never saw. Either makes the tree unprovable, and the row reseats as it did before this module.
 *
 * @param entries each `git ls-files -v -s -z` entry's head (`<tag> <mode> …`)
 * @returns `hidden` for a flagged entry, `nested` for a submodule, or `undefined` when neither stands
 */
export function indexBlindSpot({ entries }: { entries: Iterable<string> }): "hidden" | "nested" | undefined {
  let flagged = false;
  for (const entry of entries) {
    if (entry.split(" ")[1] === GITLINK_MODE) {
      return "nested";
    }
    const tag = entry.charAt(0);
    if (tag === "S" || tag !== tag.toUpperCase()) {
      flagged = true;
    }
  }
  if (flagged) {
    return "hidden";
  }
  return undefined;
}

/**
 * Read one `git status --porcelain=v2 --branch` document: the commit `HEAD` stood on, and whether any entry — staged,
 * unstaged, unmerged or untracked — followed the `#` header lines.
 *
 * @param lines each line's head, in order
 * @returns `HEAD`'s commit (`undefined` before the first commit) and whether the tree carried no change
 */
export function statusSnapshot({ lines }: { lines: Iterable<string> }): {
  readonly headOid: string | undefined;
  readonly clean: boolean;
} {
  let clean = true;
  let headOid: string | undefined;
  for (const line of lines) {
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length);
      headOid = oid === "(initial)" ? undefined : oid;
    }
    if (!line.startsWith("# ")) {
      clean = false;
    }
  }
  return { clean, headOid };
}
