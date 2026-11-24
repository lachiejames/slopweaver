/**
 * The reviewed-residue list's pure half: one entry per private-term finding that was accepted, keyed by the file's
 * path, the row class and the SHA-256 of the exact line it sits on. `fresh-cut verify` subtracts exactly those
 * findings and counts them as "reviewed, accepted"; every other finding still refuses, and a line whose bytes changed
 * no longer matches its entry, so it refuses again.
 *
 * Two entry shapes, told apart by `schemaVersion` (`./anchoredAcceptance.ts` holds the split):
 *
 * - **Version 1, `owner-address` only.** A visible session READ the line and judged it a placeholder or no address.
 *   It matches the same path, class and line in any cut, exactly as it always has.
 * - **Version 2, every other class.** The owner ruled on the word, and the entry carries the pointer to the owner's
 *   own turn. It matches only in the ONE record and tree it was accepted in, so a ruling on one cut never forgives
 *   the same line of another.
 *
 * An entry carries no term value, no matched text and no prose; the strict schemas refuse any field beyond these.
 *
 * The freeze audit re-reads this list WHOLE, every entry against its line, never a sample or only the entries the
 * latest verify used; a verify report records the SHA-256 of the exact list bytes it subtracted so that audit can
 * bind the two.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrivateTermClass } from "../hygiene/privateTerms.js";
import { err, ok, type Result } from "../lib/result.js";
import { formatTurnPointer, parseTurnPointer } from "../transcripts/pointer.js";
import {
  type AcceptedOnAnchor,
  emptyAcceptedOnAnchor,
  isOwnerAnchoredClass,
  type OwnerAnchoredClass,
  ownerAnchoredClassSchema,
  REVIEWED_RESIDUE_CLASS,
} from "./anchoredAcceptance.js";
import { type CutFile, type FreshCutFinding, PATH_LIST_LOCUS } from "./core.js";

/** The judgements a reader may give an accepted owner-address line. Closed: no free-text reason, which could carry a value. */
export const REVIEWED_RESIDUE_JUDGEMENTS = ["placeholder", "not-an-address"] as const;

/** One judgement from {@link REVIEWED_RESIDUE_JUDGEMENTS}. */
type ReviewedResidueJudgement = (typeof REVIEWED_RESIDUE_JUDGEMENTS)[number];

/** An object id, SHA-1 or SHA-256. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Pure: whether a string is a turn pointer written exactly as `formatTurnPointer` writes one, so no padded or
 * otherwise reshaped form of a pointer is ever stored.
 *
 * @param value the candidate pointer
 * @returns true when it parses and re-renders to itself
 */
export function isCanonicalTurnPointer({ value }: { value: string }): boolean {
  const pointer = parseTurnPointer({ text: value });
  return pointer !== undefined && formatTurnPointer({ pointer }) === value;
}

/** The fields both entry shapes share, and the match key's three. */
const sharedEntryFields = {
  entryId: z.uuid(),
  lineNumberAtReview: z.number().int().positive(),
  lineSha256: z.string().regex(/^[0-9a-f]{64}$/),
  path: z.string().min(1),
  reviewedAtIso: z.iso.datetime(),
  reviewedBySessionId: z.string().min(1),
  reviewedRecordId: z.uuid(),
  reviewedTreeSha: z.string().regex(OBJECT_ID),
};

/** One owner-address finding a reading session accepted. Unchanged since the list began, so every old line reads. */
export const ownerAddressResidueEntrySchema = z
  .object({
    ...sharedEntryFields,
    className: z.literal(REVIEWED_RESIDUE_CLASS),
    judgement: z.enum(REVIEWED_RESIDUE_JUDGEMENTS),
    schemaVersion: z.literal(1),
  })
  .strict();

/** One finding of another class, accepted on the owner's own turn, for one record and tree only. */
const ownerAnchoredResidueEntrySchema = z
  .object({
    ...sharedEntryFields,
    className: ownerAnchoredClassSchema,
    ownerAnchor: z.string().refine((value) => isCanonicalTurnPointer({ value }), {
      message: "the owner anchor must be a canonical transcript:<session>#<turn> pointer",
    }),
    schemaVersion: z.literal(2),
  })
  .strict();

/** One accepted finding, as the list stores it. The match key is `path`, `className` and `lineSha256`. */
export const reviewedResidueEntrySchema = z.discriminatedUnion("schemaVersion", [
  ownerAddressResidueEntrySchema,
  ownerAnchoredResidueEntrySchema,
]);

/** One owner-address entry. */
export type OwnerAddressResidueEntry = z.infer<typeof ownerAddressResidueEntrySchema>;

/** One owner-anchored entry. */
export type OwnerAnchoredResidueEntry = z.infer<typeof ownerAnchoredResidueEntrySchema>;

/** One accepted finding. */
export type ReviewedResidueEntry = z.infer<typeof reviewedResidueEntrySchema>;

/** What an acceptance records about the line: a reader's judgement on an owner-address line, or the owner's anchor. */
export type ReviewedResidueDecision =
  | { readonly className: typeof REVIEWED_RESIDUE_CLASS; readonly judgement: ReviewedResidueJudgement }
  | { readonly className: OwnerAnchoredClass; readonly ownerAnchor: string };

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

/**
 * Pure: whether an entry may take a finding out of THIS verification. An owner-address entry may in any cut; an
 * anchored one only in the record and tree it was accepted in.
 *
 * @param entry the entry
 * @param recordId the verification's record
 * @param treeSha the verification's tree
 * @returns true when the entry applies here
 */
function entryApplies({
  entry,
  recordId,
  treeSha,
}: {
  entry: ReviewedResidueEntry;
  recordId: string;
  treeSha: string;
}): boolean {
  if (entry.schemaVersion === 1) {
    return true;
  }
  return entry.reviewedRecordId === recordId && entry.reviewedTreeSha === treeSha;
}

/**
 * Pure: how many entries of each key may take a finding out of THIS verification.
 *
 * @param entries the whole list
 * @param recordId the verification's record
 * @param treeSha the verification's tree
 * @returns each key's count of applicable entries
 */
function availableEntries({
  entries,
  recordId,
  treeSha,
}: {
  entries: readonly ReviewedResidueEntry[];
  recordId: string;
  treeSha: string;
}): Map<string, number> {
  const available = new Map<string, number>();
  for (const entry of entries.filter((candidate) => entryApplies({ entry: candidate, recordId, treeSha }))) {
    const key = residueKey(entry);
    const prior = available.get(key);
    available.set(key, prior === undefined ? 1 : prior + 1);
  }
  return available;
}

/**
 * Pure: the key an entry must carry to take this private-term finding out, or undefined for one no entry ever can —
 * one off a real file's own path, the path list's locus, or a line the file does not hold.
 *
 * @param finding one private-term finding; a hygiene finding never reaches here
 * @param bytesByPath every file of the cut, by path
 * @returns the key, or undefined when the finding is never subtractable
 */
function subtractableKey({
  finding,
  bytesByPath,
}: {
  finding: Extract<FreshCutFinding, { kind: "private-term" }>;
  bytesByPath: ReadonlyMap<string, CutFile["bytes"]>;
}): string | undefined {
  const bytes = bytesByPath.get(finding.path);
  if (bytes === undefined || isPathListLocus({ path: finding.path })) {
    return undefined;
  }
  const digest = reviewedLineSha256({ bytes, line: finding.line });
  if (digest.isErr()) {
    return undefined;
  }
  return residueKey({ className: finding.className, lineSha256: digest.value, path: finding.path });
}

/** What the list took out of one verification's findings. */
export interface ReviewedResidueSubtraction {
  /** The findings left, in report order. */
  readonly findings: readonly FreshCutFinding[];
  /** Every finding taken out, of either entry shape. */
  readonly reviewedAccepted: number;
  /** The anchored share of {@link reviewedAccepted}, by class. */
  readonly acceptedOnAnchor: AcceptedOnAnchor;
}

/**
 * Pure: the findings left once every accepted one is taken out, and how many were. Only a private-term finding at a
 * real file's own path, of a class an entry names, can be taken out: a hygiene finding, the path list and a withheld
 * path (`(file paths) line N`) never are. Each entry takes out at most ONE finding, so two identical accepted lines
 * need two entries, and order is kept. An anchored entry counts only in its own record and tree.
 *
 * @param entries the accepted findings, the whole list
 * @param files every file of the cut, with its bytes
 * @param findings the verify's findings, in report order
 * @param recordId the record being verified
 * @param treeSha that record's tree
 * @returns the findings left, the count taken out and its anchored share by class
 */
export function subtractReviewedResidue({
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
}): ReviewedResidueSubtraction {
  const available = availableEntries({ entries, recordId, treeSha });
  const bytesByPath = new Map(files.map((file) => [file.path, file.bytes]));
  const left: FreshCutFinding[] = [];
  const acceptedOnAnchor: Record<OwnerAnchoredClass, number> = { ...emptyAcceptedOnAnchor() };
  let reviewedAccepted = 0;
  for (const finding of findings) {
    if (finding.kind !== "private-term") {
      left.push(finding);
      continue;
    }
    const key = subtractableKey({ bytesByPath, finding });
    const remaining = key === undefined ? undefined : available.get(key);
    if (key === undefined || remaining === undefined || remaining === 0) {
      left.push(finding);
      continue;
    }
    available.set(key, remaining - 1);
    reviewedAccepted += 1;
    if (isOwnerAnchoredClass(finding.className)) {
      acceptedOnAnchor[finding.className] += 1;
    }
  }
  return { acceptedOnAnchor, findings: left, reviewedAccepted };
}

/** Why a named line cannot be accepted. The message names no path and no text, only what was missing. */
export interface CandidateRefusal {
  readonly code: "NO_SUCH_FINDING" | "NOT_A_FILE";
  readonly message: string;
}

/**
 * Pure: the digest an acceptance of one named line records, or why there is nothing to accept. The line must hold a
 * private-term finding of the named class that the list does not already take out of THIS record's verification, so
 * accepting the same line twice, a line the scan did not flag, a hygiene finding or a finding of another class is
 * refused; a file's own path is required, so the path list and a withheld path never are.
 *
 * @param entries the list as it stands
 * @param files every file of the cut, with its bytes
 * @param findings the scan's findings, before the list is applied
 * @param path the file's tree-relative path
 * @param line the 1-based line
 * @param className the class being accepted
 * @param recordId the record the acceptance is for
 * @param treeSha that record's tree
 * @returns the line's digest, or why nothing can be accepted there
 */
export function acceptanceCandidate({
  entries,
  files,
  findings,
  path,
  line,
  className,
  recordId,
  treeSha,
}: {
  entries: readonly ReviewedResidueEntry[];
  files: readonly CutFile[];
  findings: readonly FreshCutFinding[];
  path: string;
  line: number;
  className: PrivateTermClass;
  recordId: string;
  treeSha: string;
}): Result<string, CandidateRefusal> {
  if (isPathListLocus({ path })) {
    return err({ code: "NOT_A_FILE", message: "that path is the path list's locus, which nothing is accepted from" });
  }
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    return err({ code: "NOT_A_FILE", message: "that path is not a file of this cut" });
  }
  const left = subtractReviewedResidue({ entries, files, findings, recordId, treeSha }).findings;
  const open = left.some(
    (finding) =>
      finding.kind === "private-term" &&
      finding.className === className &&
      finding.path === path &&
      finding.line === line,
  );
  if (!open) {
    return err({
      code: "NO_SUCH_FINDING",
      message: `that line holds no ${className} finding the list does not already accept`,
    });
  }
  return reviewedLineSha256({ bytes: file.bytes, line }).mapErr((): CandidateRefusal => ({
    code: "NO_SUCH_FINDING",
    message: "that line is past the file's last line",
  }));
}
