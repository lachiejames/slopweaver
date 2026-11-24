/**
 * `fresh-cut accept`'s work: record that one finding of a recorded cut is accepted, on one of two tracks. An
 * owner-address finding is accepted because a visible session READ the line and judged it a placeholder or no address
 * at all. A finding of any other class is accepted only on an owner anchor, a pointer to the owner's own turn that
 * ruled on it, and the pointer is RESOLVED against its transcript before anything is written, so an invented pair of
 * ids is refused rather than recorded. The turn's text is read only to find it, and never stored or printed.
 *
 * The finding is re-derived exactly as `fresh-cut verify` would report it, so a line the verify does not flag, a
 * finding of another class, or one already accepted is refused rather than recorded, while the byte-identical copy of
 * an accepted line stays open to its own acceptance; the list is read, checked and
 * appended under one operation lock, so two concurrent accepts of one line cannot both succeed. The entry names the
 * session that recorded it, the instant and the cut, and carries no term value and no text of the line.
 */
import { randomUUID } from "node:crypto";
import { acquireOperationLock, type OperationLockHandle } from "../admit/operationLock.js";
import { err, ok, type Result } from "../lib/result.js";
import { REVIEWED_RESIDUE_CLASS } from "./anchoredAcceptance.js";
import type { FreshCutRecord } from "./core.js";
import { type FreshCutError, FreshCutErrors } from "./errors.js";
import { acceptanceCandidate, type ReviewedResidueDecision, type ReviewedResidueEntry } from "./reviewedResidue.js";
import { appendReviewedResidue, readReviewedResidue, reviewedResiduePath } from "./reviewedResidueStore.js";
import { type FreshCutScan, prepareFreshCutScan, resolveOwnerAnchor } from "./verify.js";

/** The operation-lock key every accept of this home takes for its read, check and append. */
export const REVIEWED_RESIDUE_LOCK_KEY = "fresh-cut-reviewed-residue";

/**
 * Check an anchored decision's pointer names an owner turn. An owner-address decision carries no anchor and reads
 * no transcript. The turn found is dropped here: only its pointer, already in the decision, goes any further.
 *
 * @param decision what the acceptance records
 * @param projectsDir the transcripts' root, `~/.claude/projects` in a real run
 * @returns nothing, or why the anchor cannot be relied on
 */
function checkedOwnerAnchor({
  decision,
  projectsDir,
}: {
  decision: ReviewedResidueDecision;
  projectsDir: string;
}): Result<void, FreshCutError> {
  if (decision.className === REVIEWED_RESIDUE_CLASS) {
    return ok(undefined);
  }
  const resolved = resolveOwnerAnchor({ ownerAnchor: decision.ownerAnchor, projectsDir });
  if (resolved.isOk()) {
    return ok(undefined);
  }
  if (resolved.error.kind === "no-owner-turn") {
    return err(FreshCutErrors.ownerAnchorRefused());
  }
  return err(FreshCutErrors.ownerAnchorUnreadable({ why: resolved.error.why }));
}

/**
 * Accept one finding into the reviewed-residue list.
 *
 * @param record the cut the finding was read in
 * @param source the source checkout to re-derive the tree in
 * @param home the state home holding the scan inputs and the list
 * @param path the file's tree-relative path, as the verify report names it
 * @param line the 1-based line, as the verify report names it
 * @param decision the class and either the reader's judgement (owner-address) or the owner's anchor (any other)
 * @param sessionId the visible session recording the acceptance
 * @param projectsDir the transcripts' root an owner anchor is resolved in
 * @param now the acceptance's instant
 * @returns the entry appended and the list's path, or why nothing was
 */
export function acceptReviewedResidue({
  record,
  source,
  home,
  path,
  line,
  decision,
  sessionId,
  projectsDir,
  now,
}: {
  record: FreshCutRecord;
  source: string;
  home: string;
  path: string;
  line: number;
  decision: ReviewedResidueDecision;
  sessionId: string;
  projectsDir: string;
  now: Date;
}): Result<{ readonly entry: ReviewedResidueEntry; readonly listPath: string }, FreshCutError> {
  const scan = prepareFreshCutScan({ home, record, source });
  if (scan.isErr()) {
    return err(scan.error);
  }
  const anchor = checkedOwnerAnchor({ decision, projectsDir });
  if (anchor.isErr()) {
    return err(anchor.error);
  }
  const listPath = reviewedResiduePath({ home });
  let lock: Result<OperationLockHandle, string>;
  try {
    lock = acquireOperationLock({ home, key: REVIEWED_RESIDUE_LOCK_KEY, nowIso: now.toISOString() });
  } catch (error) {
    return err(
      FreshCutErrors.reviewedResidueWriteFailed({
        cause: error instanceof Error ? error.message : String(error),
        path: listPath,
      }),
    );
  }
  if (lock.isErr()) {
    return err(FreshCutErrors.reviewedResidueWriteFailed({ cause: lock.error, path: listPath }));
  }
  try {
    return acceptUnderLock({ decision, home, line, now, path, record, scan: scan.value, sessionId });
  } finally {
    lock.value.release();
  }
}

/**
 * Pure: the entry one acceptance appends — version 1 for an owner-address judgement, carrying the line's occurrence
 * among the file's byte-identical lines because it matches in any cut, and version 2 for an owner anchor, which
 * matches only at its own line of its own cut and so needs none.
 *
 * @param decision what the acceptance records
 * @param shared the fields both shapes carry
 * @param occurrence the line's 1-based index among the file's lines with its exact bytes
 * @returns the entry
 */
function entryFor({
  decision,
  shared,
  occurrence,
}: {
  decision: ReviewedResidueDecision;
  shared: Omit<ReviewedResidueEntry, "className" | "schemaVersion" | "judgement" | "ownerAnchor">;
  occurrence: number;
}): ReviewedResidueEntry {
  if (decision.className === REVIEWED_RESIDUE_CLASS) {
    return { ...shared, className: decision.className, judgement: decision.judgement, occurrence, schemaVersion: 1 };
  }
  return { ...shared, className: decision.className, ownerAnchor: decision.ownerAnchor, schemaVersion: 2 };
}

/**
 * The read, check and append, run only while this process holds the list's lock, so two concurrent accepts of one
 * line cannot both find it unaccepted and both append.
 *
 * @param scan the cut's prepared scan, read before the lock was taken
 * @returns the entry appended and the list's path, or why nothing was
 */
function acceptUnderLock({
  record,
  scan,
  home,
  path,
  line,
  decision,
  sessionId,
  now,
}: {
  record: FreshCutRecord;
  scan: FreshCutScan;
  home: string;
  path: string;
  line: number;
  decision: ReviewedResidueDecision;
  sessionId: string;
  now: Date;
}): Result<{ readonly entry: ReviewedResidueEntry; readonly listPath: string }, FreshCutError> {
  const list = readReviewedResidue({ home });
  if (list.isErr()) {
    return err(list.error);
  }
  const candidate = acceptanceCandidate({
    className: decision.className,
    entries: list.value.entries,
    files: scan.files,
    findings: scan.findings,
    line,
    path,
    recordId: record.recordId,
    treeSha: record.treeSha,
  });
  if (candidate.isErr()) {
    return err(FreshCutErrors.reviewedResidueCandidateRefused({ why: candidate.error.message }));
  }
  const entry = entryFor({
    decision,
    occurrence: candidate.value.occurrence,
    shared: {
      entryId: randomUUID(),
      lineNumberAtReview: line,
      lineSha256: candidate.value.lineSha256,
      path,
      reviewedAtIso: now.toISOString(),
      reviewedBySessionId: sessionId,
      reviewedRecordId: record.recordId,
      reviewedTreeSha: record.treeSha,
    },
  });
  const written = appendReviewedResidue({ entry, home });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ entry, listPath: written.value });
}
