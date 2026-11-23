/**
 * The shared fail-CLOSED reader every source scanner sits on.
 *
 * ## Why this exists
 *
 * Seven gates independently wrote the same four lines — `try { readFileSync } catch { continue }` — and then
 * printed `clean (N sources scanned)`, where N was the number of files LISTED, not the number actually READ.
 * Measured on a clean tree with one tracked source made unreadable, all seven produced byte-identical output
 * and exited 0. A gate that reports clean over a file it could not open is the exact defect those gates
 * exist to catch, one level up.
 *
 * `controlBytes.ts` and `gitInTests.ts` already had the right shape — collect the unreadable paths and fail.
 * This is that shape, extracted once so a new scanner inherits it instead of re-deriving the bug.
 *
 * ## Two failure kinds, deliberately distinct
 *
 * An UNREADABLE file is a file the gate did not check. An EMPTY SELECTION is a gate that checked nothing at
 * all — an over-broad exclusion or a typo'd path filter silently reduces the scan to zero files, and
 * `{ hits: [], unreadable: [] }` cannot tell that apart from a genuinely clean tree. Callers get both facts.
 *
 * Pure: the reader is injected, so both failure branches are testable without touching a filesystem.
 */

/** One file the scan could not read, and why. A path here was NOT checked. */
export interface UnreadableFile {
  readonly path: string;
  readonly reason: string;
}

/** The outcome of scanning a set of text files. */
export interface TextFileScanResult<THit> {
  readonly hits: readonly THit[];
  readonly unreadable: readonly UnreadableFile[];
  /** How many files were actually read and scanned — never the size of the input list. */
  readonly scanned: number;
}

/**
 * Read and scan each path, collecting hits and, separately, every path that could not be read.
 *
 * @param paths the repo-relative paths to scan
 * @param readText reads one path's text, throwing when it cannot
 * @param scan the pure per-file scanner
 * @returns the hits, the unreadable paths, and the count actually scanned
 */
export function scanTextFiles<THit>({
  paths,
  readText,
  scan,
}: {
  paths: readonly string[];
  readText: (args: { path: string }) => string;
  scan: (args: { path: string; content: string }) => readonly THit[];
}): TextFileScanResult<THit> {
  const hits: THit[] = [];
  const unreadable: UnreadableFile[] = [];
  let scanned = 0;
  for (const path of paths) {
    let content: string;
    try {
      content = readText({ path });
    } catch (error) {
      unreadable.push({ path, reason: reasonOf({ error }) });
      continue;
    }
    scanned += 1;
    for (const hit of scan({ content, path })) {
      hits.push(hit);
    }
  }
  return { hits, scanned, unreadable };
}

/** A short, stable reason string for a failed read (the errno when there is one). */
function reasonOf({ error }: { error: unknown }): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const { code } = error;
    if (typeof code === "string") {
      return code;
    }
  }
  return "read failed";
}

/**
 * Print the fail-closed tail shared by every scanner: the unreadable paths, and the refusal when a scan
 * selected no files at all.
 *
 * A gate calls this AFTER printing its own hits, and returns 1 whenever this returns false.
 *
 * @param label the gate's name, for the message
 * @param unreadable paths that could not be read
 * @param scanned how many files were actually read
 * @param write the stderr sink
 * @returns true when the scan was complete (something was read, and everything selected was readable)
 */
export function reportScanIntegrity({
  label,
  unreadable,
  scanned,
  write,
}: {
  label: string;
  unreadable: readonly UnreadableFile[];
  scanned: number;
  write: (text: string) => void;
}): boolean {
  for (const file of unreadable) {
    write(`  ${file.path}  (unreadable: ${file.reason} — NOT checked)\n`);
  }
  if (unreadable.length > 0) {
    write(
      `\n${label}: ${String(unreadable.length)} file(s) could not be read, so this gate did not\n` +
        `check them. Reporting clean over an unread file is the failure this gate exists to prevent.\n`,
    );
    return false;
  }
  if (scanned === 0) {
    write(
      `\n${label}: selected ZERO files to scan. That is a broken path filter, not a clean tree —\n` +
        `an empty selection and a clean result are indistinguishable in the output otherwise.\n`,
    );
    return false;
  }
  return true;
}

/**
 * The empty-selection half of {@link reportScanIntegrity}, for a gate that walks its own files rather than
 * going through `scanTextFiles` — an empty selection and a clean tree are indistinguishable in the output
 * otherwise, so a broken path filter reads as a pass.
 *
 * Returns a COUNT rather than a boolean so a caller adds it straight onto its unreadable tally and hands the
 * total to `gateOutcome`: what the gate never saw is one number however it came to be unseen.
 *
 * @param label the gate's name, for the message
 * @param selected how many files the gate's own filter chose
 * @param write the stderr sink
 * @returns 1 when the selection was empty (and the fact has been written), 0 otherwise
 */
export function reportEmptySelection({
  label,
  selected,
  write,
}: {
  label: string;
  selected: number;
  write: (text: string) => void;
}): number {
  if (selected > 0) {
    return 0;
  }
  write(
    `\n${label}: selected ZERO files to scan. That is a broken path filter, not a clean tree —\n` +
      `an empty selection and a clean result are indistinguishable in the output otherwise.\n`,
  );
  return 1;
}
