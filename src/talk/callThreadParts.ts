/**
 * The files one call's thread journal is split across, and which file the next line goes in. Pure.
 *
 * `<callId>.jsonl` first, then `<callId>.part-000001.jsonl`, `…000002…` — a long call's journal rotates into a new
 * part before a part would pass {@link CALL_THREAD_PART_MAX_BYTES}, so every file stays importable under the authored
 * import's 32 MiB per-file ceiling (`AUTHORED_FILE_MAX_BYTES`, `src/store/fleet/authoredFile.ts`). Readers read the
 * parts in that order.
 */

/** The most one journal file may hold before the next line starts a new part. */
const CALL_THREAD_PART_MAX_BYTES = 24 * 1024 * 1024;

/**
 * A part's file name: the call id, `.part-`, at least six digits. Past part 999999 the number simply grows, so a part
 * the writer names is always one the reader reads; only the canonical spelling is a part.
 */
const PART_FILE = /^([0-9a-f-]{36})\.part-([0-9]{6,})\.jsonl$/u;

/**
 * The journal file a part index names: 0 is the primary file.
 *
 * @param index 0 for the primary file, else the part's number
 * @returns the file name
 */
export function callThreadFileName({ callId, index }: { callId: string; index: number }): string {
  if (index === 0) {
    return `${callId}.jsonl`;
  }
  return `${callId}.part-${String(index).padStart(6, "0")}.jsonl`;
}

/**
 * One call's journal files among a directory's names, in reading order.
 *
 * @param names every name in the threads directory
 * @returns each of this call's files with its index, primary first, then parts by number; another call's and
 *   anything malformed left out
 */
export function callThreadFilesOf({
  callId,
  names,
}: {
  callId: string;
  names: readonly string[];
}): readonly { readonly name: string; readonly index: number }[] {
  const files: { name: string; index: number }[] = [];
  for (const name of names) {
    if (name === `${callId}.jsonl`) {
      files.push({ index: 0, name });
      continue;
    }
    const match = PART_FILE.exec(name);
    const index = Number(match?.[2]);
    // A non-canonical spelling (`part-0000001`) would read one part twice under two names, so it is not a part.
    if (match?.[1] === callId && index > 0 && name === callThreadFileName({ callId, index })) {
      files.push({ index, name });
    }
  }
  return files.toSorted((a, b) => a.index - b.index);
}

/**
 * Which file each line goes in, appended after the last file as it stands: a line that would carry a non-empty file
 * past the ceiling starts the next part. A line alone past the ceiling still goes in a part of its own — each line is
 * already fitted under 8 MiB (`./callThreadFit.ts`), so that is a ceiling misconfigured, never data lost.
 *
 * @param lastIndex the last existing file's index, 0 when only the primary exists or none does
 * @param lastBytes that file's size, 0 when none exists
 * @param lineBytes each line's size, its newline included
 * @param maxBytes the per-file ceiling, {@link CALL_THREAD_PART_MAX_BYTES} unless a test narrows it
 * @returns the file index for each line, in order
 */
export function placeLines({
  lastIndex,
  lastBytes,
  lineBytes,
  maxBytes = CALL_THREAD_PART_MAX_BYTES,
}: {
  lastIndex: number;
  lastBytes: number;
  lineBytes: readonly number[];
  maxBytes?: number;
}): readonly number[] {
  let index = lastIndex;
  let bytes = lastBytes;
  const placed: number[] = [];
  for (const size of lineBytes) {
    if (bytes > 0 && bytes + size > maxBytes) {
      index += 1;
      bytes = 0;
    }
    placed.push(index);
    bytes += size;
  }
  return placed;
}
