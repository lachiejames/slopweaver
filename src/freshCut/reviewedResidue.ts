/**
 * The reviewed-residue list's pure half: one entry per private-term finding a visible session READ and judged not to
 * be a private detail, keyed by the file's path, the row class and the SHA-256 of the exact line it sits on.
 * `fresh-cut verify` subtracts exactly those findings and counts them as "reviewed, accepted"; every other finding
 * still refuses, and a line whose bytes changed no longer matches its entry, so it refuses again.
 *
 * Owner-address only, enforced at both ends: `fresh-cut accept` takes no other class, and the schema below refuses
 * any other, so a hand-written topic, health, money or organisation entry makes the whole list unreadable rather
 * than hiding a finding the owner has not ruled on. An entry carries no term value, no matched text and no prose.
 *
 * The freeze audit re-reads this list WHOLE, every entry against its line, never a sample or only the entries the
 * latest verify used; a verify report records the SHA-256 of the exact list bytes it subtracted so that audit can
 * bind the two.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { err, ok, type Result } from "../lib/result.js";
import { type CutFile, type FreshCutFinding, PATH_LIST_LOCUS } from "./core.js";

/** The judgements a reader may give an accepted line. Closed: no free-text reason, which could carry a value. */
export const REVIEWED_RESIDUE_JUDGEMENTS = ["placeholder", "not-an-address"] as const;

/** One judgement from {@link REVIEWED_RESIDUE_JUDGEMENTS}. */
export type ReviewedResidueJudgement = (typeof REVIEWED_RESIDUE_JUDGEMENTS)[number];

/** The one row class a finding may be accepted under. */
export const REVIEWED_RESIDUE_CLASS = "owner-address";

/** One accepted finding, as the list stores it. The match key is `path`, `className` and `lineSha256`. */
export const reviewedResidueEntrySchema = z
  .object({
    className: z.literal(REVIEWED_RESIDUE_CLASS),
    entryId: z.uuid(),
    judgement: z.enum(REVIEWED_RESIDUE_JUDGEMENTS),
    lineNumberAtReview: z.number().int().positive(),
    lineSha256: z.string().regex(/^[0-9a-f]{64}$/),
    path: z.string().min(1),
    reviewedAtIso: z.iso.datetime(),
    reviewedBySessionId: z.string().min(1),
    reviewedRecordId: z.uuid(),
    reviewedTreeSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    schemaVersion: z.literal(1),
  })
  .strict();

/** One accepted finding. */
export type ReviewedResidueEntry = z.infer<typeof reviewedResidueEntrySchema>;

/** The 1-based line a caller named lies past the file's last line. */
export interface LineOutOfRangeError {
  readonly code: "LINE_OUT_OF_RANGE";
  readonly message: string;
}

/**
 * Pure: the exact bytes of one logical line, its delimiter excluded. A line ends at LF or NUL, because the verify
 * scans a blob's NUL bytes as line breaks; nothing is decoded, trimmed or normalised, so a CR stays part of its line.
 *
 * @param bytes the file's bytes
 * @param line the 1-based line number
 * @returns the line's bytes, or why there is no such line
 */
export function lineBytesAt({ bytes, line }: { bytes: Buffer; line: number }): Result<Buffer, LineOutOfRangeError> {
  let start = 0;
  let current = 1;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a || bytes[index] === 0x00) {
      if (current === line) {
        return ok(bytes.subarray(start, index));
      }
      current += 1;
      start = index + 1;
    }
  }
  if (current === line) {
    return ok(bytes.subarray(start));
  }
  return err({ code: "LINE_OUT_OF_RANGE", message: `line ${String(line)} is past the file's last line` });
}

/**
 * Pure: the SHA-256 of one logical line's exact bytes ({@link lineBytesAt}).
 *
 * @param bytes the file's bytes
 * @param line the 1-based line number
 * @returns the lowercase hex digest, or why there is no such line
 */
export function reviewedLineSha256({
  bytes,
  line,
}: {
  bytes: Buffer;
  line: number;
}): Result<string, LineOutOfRangeError> {
  return lineBytesAt({ bytes, line }).map((lineBytes) => createHash("sha256").update(lineBytes).digest("hex"));
}

/**
 * Pure: the match key of one entry or finding.
 *
 * @param path the file's tree-relative path
 * @param className the row class
 * @param lineSha256 the line's digest
 * @returns the key
 */
function residueKey({ path, className, lineSha256 }: { path: string; className: string; lineSha256: string }): string {
  return `${path}\u0000${className}\u0000${lineSha256}`;
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
function isPathListLocus({ path }: { path: string }): boolean {
  return path === PATH_LIST_LOCUS || path.startsWith(`${PATH_LIST_LOCUS} line `);
}

/** Why a named line cannot be accepted. The message names no path and no text, only what was missing. */
export interface CandidateRefusal {
  readonly code: "NO_SUCH_FINDING" | "NOT_A_FILE";
  readonly message: string;
}

/**
 * Pure: the digest an acceptance of one named line records, or why there is nothing to accept. The line must hold an
 * owner-address finding the list does not already take out, so accepting the same line twice, or a line the scan
 * did not flag, or a hygiene or other-class finding, is refused; a file's own path is required, so the path list and
 * a withheld path never are.
 *
 * @param entries the list as it stands
 * @param files every file of the cut, with its bytes
 * @param findings the scan's findings, before the list is applied
 * @param path the file's tree-relative path
 * @param line the 1-based line
 * @returns the line's digest, or why nothing can be accepted there
 */
export function acceptanceCandidate({
  entries,
  files,
  findings,
  path,
  line,
}: {
  entries: readonly ReviewedResidueEntry[];
  files: readonly CutFile[];
  findings: readonly FreshCutFinding[];
  path: string;
  line: number;
}): Result<string, CandidateRefusal> {
  if (isPathListLocus({ path })) {
    return err({ code: "NOT_A_FILE", message: "that path is the path list's locus, which nothing is accepted from" });
  }
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    return err({ code: "NOT_A_FILE", message: "that path is not a file of this cut" });
  }
  const left = subtractReviewedResidue({ entries, files, findings }).findings;
  const open = left.some(
    (finding) =>
      finding.kind === "private-term" &&
      finding.className === REVIEWED_RESIDUE_CLASS &&
      finding.path === path &&
      finding.line === line,
  );
  if (!open) {
    return err({
      code: "NO_SUCH_FINDING",
      message: "that line holds no owner-address finding the list does not already accept",
    });
  }
  return reviewedLineSha256({ bytes: file.bytes, line }).mapErr((): CandidateRefusal => ({
    code: "NO_SUCH_FINDING",
    message: "that line is past the file's last line",
  }));
}

/**
 * Pure: the findings left once every accepted one is taken out, and how many were. Only a private-term finding of
 * the accepted class, at a real file's own path, can be taken out: a hygiene finding, the path list and a withheld
 * path (`(file paths) line N`) never are. Each entry takes out at most ONE finding, so two identical accepted lines
 * need two entries, and order is kept.
 *
 * @param entries the accepted findings, the whole list
 * @param files every file of the cut, with its bytes
 * @param findings the verify's findings, in report order
 * @returns the findings left and the count taken out
 */
export function subtractReviewedResidue({
  entries,
  files,
  findings,
}: {
  entries: readonly ReviewedResidueEntry[];
  files: readonly CutFile[];
  findings: readonly FreshCutFinding[];
}): { readonly findings: readonly FreshCutFinding[]; readonly reviewedAccepted: number } {
  const available = new Map<string, number>();
  for (const entry of entries) {
    const key = residueKey(entry);
    const prior = available.get(key);
    available.set(key, prior === undefined ? 1 : prior + 1);
  }
  const bytesByPath = new Map(files.map((file) => [file.path, file.bytes]));
  const left: FreshCutFinding[] = [];
  let reviewedAccepted = 0;
  for (const finding of findings) {
    const bytes = bytesByPath.get(finding.path);
    const subtractable =
      finding.kind === "private-term" &&
      finding.className === REVIEWED_RESIDUE_CLASS &&
      bytes !== undefined &&
      !isPathListLocus({ path: finding.path });
    if (!subtractable) {
      left.push(finding);
      continue;
    }
    const digest = reviewedLineSha256({ bytes, line: finding.line });
    if (digest.isErr()) {
      left.push(finding);
      continue;
    }
    const key = residueKey({ className: finding.className, lineSha256: digest.value, path: finding.path });
    const remaining = available.get(key);
    if (remaining === undefined || remaining === 0) {
      left.push(finding);
      continue;
    }
    available.set(key, remaining - 1);
    reviewedAccepted += 1;
  }
  return { findings: left, reviewedAccepted };
}
