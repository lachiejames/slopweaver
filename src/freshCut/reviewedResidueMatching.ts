/**
 * Which finding each reviewed-residue entry takes out of one verification. An entry clears only the ONE line it was
 * accepted for, never whichever byte-identical copy the verify meets first:
 *
 * - **An anchored entry (version 2)** applies only in the record and tree it was accepted in, where the bytes cannot
 *   have moved, so it binds to its exact `lineNumberAtReview`.
 * - **An owner-address entry (version 1) carrying `occurrence`** binds, in any cut, to that occurrence among the
 *   file's lines with its exact bytes ({@link lineNumbersByDigest}).
 * - **An older owner-address entry with no `occurrence`** binds to its `lineNumberAtReview` in its own record and
 *   tree; anywhere else only when the file holds exactly ONE line with its bytes. Two or more copies are ambiguous,
 *   so it clears nothing — it fails closed rather than falling onto the first copy.
 *
 * An applicable entry whose line no longer exists, or whose line holds no open finding of its class, clears nothing
 * and is counted UNMATCHED, never silently dropped. Each entry takes out at most one finding, and each finding is
 * taken out by at most one entry.
 */
import { type CutFile, type FreshCutFinding, PATH_LIST_LOCUS } from "./core.js";
import { lineNumbersByDigest } from "./reviewedLines.js";
import type { ReviewedResidueEntry } from "./reviewedResidue.js";

/**
 * What the list matched in one verification.
 *
 * @internal — the declared shape of {@link matchReviewedResidue}'s return.
 */
export interface ReviewedResidueMatches {
  /** The indexes, into the verify's findings, of every finding an entry took out. */
  readonly matched: ReadonlySet<number>;
  /** How many applicable entries took nothing out. */
  readonly unmatched: number;
}

/**
 * Pure: whether a finding's path is the path list's own locus, bare or as a withheld path's `(file paths) line N`. A
 * finding there is about a PATH, never file content, so nothing is accepted from it or subtracted from it — not even
 * when a real file of the cut carries that exact name, which git allows: such a file fails closed and its findings
 * always refuse.
 *
 * @param path a finding's path, or a path a caller named
 * @returns true when it is the path list's locus
 */
export function isPathListLocus({ path }: { path: string }): boolean {
  return path === PATH_LIST_LOCUS || path.startsWith(`${PATH_LIST_LOCUS} line `);
}

/**
 * Pure: whether an entry was accepted in THIS record and tree.
 *
 * @param entry the entry
 * @param recordId the verification's record
 * @param treeSha the verification's tree
 * @returns true when the verification is of the cut the entry was accepted in
 */
function inReviewedCut({
  entry,
  recordId,
  treeSha,
}: {
  entry: ReviewedResidueEntry;
  recordId: string;
  treeSha: string;
}): boolean {
  return entry.reviewedRecordId === recordId && entry.reviewedTreeSha === treeSha;
}

/**
 * Pure: the one line an applicable entry is bound to in this verification, or undefined when it is bound to none.
 *
 * @param entry the entry
 * @param group the line numbers in the entry's file holding the entry's exact bytes, in file order
 * @param reviewedHere whether the verification is of the cut the entry was accepted in
 * @returns the 1-based line, or undefined
 */
function boundLine({
  entry,
  group,
  reviewedHere,
}: {
  entry: ReviewedResidueEntry;
  group: readonly number[];
  reviewedHere: boolean;
}): number | undefined {
  if (entry.schemaVersion === 1 && entry.occurrence !== undefined) {
    return group[entry.occurrence - 1];
  }
  if (entry.schemaVersion === 2 || reviewedHere) {
    return group.includes(entry.lineNumberAtReview) ? entry.lineNumberAtReview : undefined;
  }
  return group.length === 1 ? group[0] : undefined;
}

/**
 * Pure: the key one finding, or one entry's bound line, is looked up by.
 *
 * @param path the file's tree-relative path
 * @param className the row class
 * @param line the 1-based line
 * @returns the key
 */
function lineKey({ path, className, line }: { path: string; className: string; line: number }): string {
  return `${path}\u0000${className}\u0000${String(line)}`;
}

/**
 * Pure: the indexes of every subtractable finding, by its path, class and line. Only a private-term finding at a real
 * file's own path is subtractable: a hygiene finding, the path list and a withheld path never are.
 *
 * @param findings the verify's findings, in report order
 * @param bytesByPath every file of the cut, by path
 * @returns each key's finding indexes, in report order
 */
function subtractableFindings({
  findings,
  bytesByPath,
}: {
  findings: readonly FreshCutFinding[];
  bytesByPath: ReadonlyMap<string, Buffer>;
}): Map<string, number[]> {
  const byKey = new Map<string, number[]>();
  findings.forEach((finding, index) => {
    if (finding.kind !== "private-term" || isPathListLocus({ path: finding.path }) || !bytesByPath.has(finding.path)) {
      return;
    }
    const key = lineKey(finding);
    const indexes = byKey.get(key);
    if (indexes === undefined) {
      byKey.set(key, [index]);
    } else {
      indexes.push(index);
    }
  });
  return byKey;
}

/**
 * Pure: each file some entry names, by its {@link lineNumbersByDigest}; a path that is no file of the cut is absent.
 *
 * @param entries the whole list
 * @param bytesByPath every file of the cut, by path
 * @returns each named file's line numbers by digest
 */
function digestsByEntryPath({
  entries,
  bytesByPath,
}: {
  entries: readonly ReviewedResidueEntry[];
  bytesByPath: ReadonlyMap<string, Buffer>;
}): ReadonlyMap<string, ReadonlyMap<string, readonly number[]>> {
  const byPath = new Map<string, ReadonlyMap<string, readonly number[]>>();
  for (const path of new Set(entries.map((entry) => entry.path))) {
    const bytes = bytesByPath.get(path);
    if (bytes !== undefined) {
      byPath.set(path, lineNumbersByDigest({ bytes }));
    }
  }
  return byPath;
}

/**
 * Pure: which findings the list takes out of THIS verification, and how many applicable entries took nothing. An
 * anchored entry for another record or tree is not applicable, so it is neither matched nor unmatched.
 *
 * @param entries the accepted findings, the whole list
 * @param files every file of the cut, with its bytes
 * @param findings the verify's findings, in report order
 * @param recordId the record being verified
 * @param treeSha that record's tree
 * @returns the matched finding indexes and the unmatched entry count
 */
export function matchReviewedResidue({
  entries,
  files,
  findings,
  recordId,
  treeSha,
}: {
  entries: readonly ReviewedResidueEntry[];
  files: readonly CutFile[];
  findings: readonly FreshCutFinding[];
  recordId: string;
  treeSha: string;
}): ReviewedResidueMatches {
  const bytesByPath = new Map(files.map((file) => [file.path, file.bytes]));
  const open = subtractableFindings({ bytesByPath, findings });
  const digests = digestsByEntryPath({ bytesByPath, entries });
  const matched = new Set<number>();
  let unmatched = 0;
  for (const entry of entries) {
    const reviewedHere = inReviewedCut({ entry, recordId, treeSha });
    if (entry.schemaVersion === 2 && !reviewedHere) {
      continue;
    }
    const group = digests.get(entry.path)?.get(entry.lineSha256);
    const line = group === undefined ? undefined : boundLine({ entry, group, reviewedHere });
    const indexes = line === undefined ? [] : open.get(lineKey({ className: entry.className, line, path: entry.path }));
    const claimed = indexes?.find((index) => !matched.has(index));
    if (claimed === undefined) {
      unmatched += 1;
    } else {
      matched.add(claimed);
    }
  }
  return { matched, unmatched };
}
