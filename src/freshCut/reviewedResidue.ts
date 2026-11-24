/**
 * The reviewed-residue list's pure half: one entry per private-term finding that was accepted, naming the file's
 * path, the row class and the SHA-256 of the exact line it sits on. `fresh-cut verify` subtracts exactly those
 * findings and counts them as "reviewed, accepted"; every other finding still refuses, and a line whose bytes changed
 * no longer matches its entry, so it refuses again. An entry clears only the ONE line it was accepted for, never a
 * byte-identical copy of it elsewhere in the file (`./reviewedResidueMatching.ts` holds how each is bound).
 *
 * Two entry shapes, told apart by `schemaVersion` (`./anchoredAcceptance.ts` holds the split):
 *
 * - **Version 1, `owner-address` only.** A visible session READ the line and judged it a placeholder or no address.
 *   It matches in any cut, bound to its `occurrence` among the file's lines with those exact bytes.
 * - **Version 2, every other class.** The owner ruled on the word, and the entry carries the pointer to the owner's
 *   own turn. It matches only in the ONE record and tree it was accepted in, so a ruling on one cut never forgives
 *   the same line of another, and only at its own line there.
 *
 * An entry carries no term value, no matched text and no prose; the strict schemas refuse any field beyond these.
 *
 * The freeze audit re-reads this list WHOLE, every entry against its line, never a sample or only the entries the
 * latest verify used; a verify report records the SHA-256 of the exact list bytes it subtracted so that audit can
 * bind the two.
 */
import { z } from "zod";
import type { PrivateTermClass } from "../hygiene/privateTerms.js";
import { err, type Result } from "../lib/result.js";
import { formatTurnPointer, parseTurnPointer } from "../transcripts/pointer.js";
import {
  type AcceptedOnAnchor,
  emptyAcceptedOnAnchor,
  isOwnerAnchoredClass,
  type OwnerAnchoredClass,
  ownerAnchoredClassSchema,
  REVIEWED_RESIDUE_CLASS,
} from "./anchoredAcceptance.js";
import type { CutFile, FreshCutFinding } from "./core.js";
import { type ReviewedLineIdentity, reviewedLineIdentity } from "./reviewedLines.js";
import { isPathListLocus, matchReviewedResidue } from "./reviewedResidueMatching.js";

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

/** The fields both entry shapes share. */
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

/**
 * One owner-address finding a reading session accepted. `occurrence` is optional so every line written before it
 * existed still reads unchanged; such an entry is bound as `./reviewedResidueMatching.ts` says, failing closed.
 */
export const ownerAddressResidueEntrySchema = z
  .object({
    ...sharedEntryFields,
    className: z.literal(REVIEWED_RESIDUE_CLASS),
    judgement: z.enum(REVIEWED_RESIDUE_JUDGEMENTS),
    occurrence: z.number().int().positive().optional(),
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

/** One accepted finding, as the list stores it. */
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

/** What the list took out of one verification's findings. */
export interface ReviewedResidueSubtraction {
  /** The findings left, in report order. */
  readonly findings: readonly FreshCutFinding[];
  /** Every finding taken out, of either entry shape. */
  readonly reviewedAccepted: number;
  /** The anchored share of {@link reviewedAccepted}, by class. */
  readonly acceptedOnAnchor: AcceptedOnAnchor;
  /** Every entry that applies here and took nothing out: its line is gone, moved past its binding, or not flagged. */
  readonly reviewedUnmatched: number;
}

/**
 * Pure: the findings left once every accepted one is taken out, and how many were. Only a private-term finding at a
 * real file's own path, of a class an entry names, can be taken out: a hygiene finding, the path list and a withheld
 * path (`(file paths) line N`) never are. Each entry takes out at most ONE finding, the one at the line it is bound
 * to, and order is kept. An anchored entry counts only in its own record and tree.
 *
 * @param entries the accepted findings, the whole list
 * @param files every file of the cut, with its bytes
 * @param findings the verify's findings, in report order
 * @param recordId the record being verified
 * @param treeSha that record's tree
 * @returns the findings left, the count taken out and its anchored share by class, and the entries that took nothing
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
  const { matched, unmatched } = matchReviewedResidue({ entries, files, findings, recordId, treeSha });
  const acceptedOnAnchor: Record<OwnerAnchoredClass, number> = { ...emptyAcceptedOnAnchor() };
  const left: FreshCutFinding[] = [];
  findings.forEach((finding, index) => {
    if (!matched.has(index)) {
      left.push(finding);
    } else if (finding.kind === "private-term" && isOwnerAnchoredClass(finding.className)) {
      acceptedOnAnchor[finding.className] += 1;
    }
  });
  return {
    acceptedOnAnchor,
    findings: left,
    reviewedAccepted: matched.size,
    reviewedUnmatched: unmatched,
  };
}

/** Why a named line cannot be accepted. The message names no path and no text, only what was missing. */
export interface CandidateRefusal {
  readonly code: "NO_SUCH_FINDING" | "NOT_A_FILE";
  readonly message: string;
}

/**
 * Pure: the identity an acceptance of one named line records — its digest and its occurrence among the file's lines
 * with those bytes — or why there is nothing to accept. The line must hold a private-term finding of the named class
 * that the list does not already take out of THIS record's verification, so accepting the same line twice, a line the
 * scan did not flag, a hygiene finding or a finding of another class is refused, while the byte-identical copy of an
 * accepted line stays open; a file's own path is required, so the path list and a withheld path never are.
 *
 * @param entries the list as it stands
 * @param files every file of the cut, with its bytes
 * @param findings the scan's findings, before the list is applied
 * @param path the file's tree-relative path
 * @param line the 1-based line
 * @param className the class being accepted
 * @param recordId the record the acceptance is for
 * @param treeSha that record's tree
 * @returns the line's identity, or why nothing can be accepted there
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
}): Result<ReviewedLineIdentity, CandidateRefusal> {
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
  return reviewedLineIdentity({ bytes: file.bytes, line }).mapErr((): CandidateRefusal => ({
    code: "NO_SUCH_FINDING",
    message: "that line is past the file's last line",
  }));
}
