/**
 * `fresh-cut accept`'s work: record that a visible session READ one owner-address finding of a recorded cut and judged
 * it a placeholder or no address at all. The finding is re-derived exactly as `fresh-cut verify` would report it, so a
 * line the verify does not flag, or one already accepted, is refused rather than recorded; the list is read, checked
 * and appended under one operation lock, so two concurrent accepts of one line cannot both succeed. The entry names
 * the session that read it, the instant and the cut it was read in, and carries no term value and no text of the line.
 */
import { randomUUID } from "node:crypto";
import { acquireOperationLock, type OperationLockHandle } from "../admit/operationLock.js";
import { err, ok, type Result } from "../lib/result.js";
import type { FreshCutRecord } from "./core.js";
import { type FreshCutError, FreshCutErrors } from "./errors.js";
import {
  acceptanceCandidate,
  REVIEWED_RESIDUE_CLASS,
  type ReviewedResidueEntry,
  type ReviewedResidueJudgement,
} from "./reviewedResidue.js";
import { appendReviewedResidue, readReviewedResidue, reviewedResiduePath } from "./reviewedResidueStore.js";
import { type FreshCutScan, prepareFreshCutScan } from "./verify.js";

/** The operation-lock key every accept of this home takes for its read, check and append. */
export const REVIEWED_RESIDUE_LOCK_KEY = "fresh-cut-reviewed-residue";

/**
 * Accept one owner-address finding into the reviewed-residue list.
 *
 * @param record the cut the finding was read in
 * @param source the source checkout to re-derive the tree in
 * @param home the state home holding the scan inputs and the list
 * @param path the file's tree-relative path, as the verify report names it
 * @param line the 1-based line, as the verify report names it
 * @param judgement what the reader found the match to be
 * @param sessionId the visible session that read the line
 * @param now the acceptance's instant
 * @returns the entry appended and the list's path, or why nothing was
 */
export function acceptReviewedResidue({
  record,
  source,
  home,
  path,
  line,
  judgement,
  sessionId,
  now,
}: {
  record: FreshCutRecord;
  source: string;
  home: string;
  path: string;
  line: number;
  judgement: ReviewedResidueJudgement;
  sessionId: string;
  now: Date;
}): Result<{ readonly entry: ReviewedResidueEntry; readonly listPath: string }, FreshCutError> {
  const scan = prepareFreshCutScan({ home, record, source });
  if (scan.isErr()) {
    return err(scan.error);
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
    return acceptUnderLock({ home, judgement, line, now, path, record, scan: scan.value, sessionId });
  } finally {
    lock.value.release();
  }
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
  judgement,
  sessionId,
  now,
}: {
  record: FreshCutRecord;
  scan: FreshCutScan;
  home: string;
  path: string;
  line: number;
  judgement: ReviewedResidueJudgement;
  sessionId: string;
  now: Date;
}): Result<{ readonly entry: ReviewedResidueEntry; readonly listPath: string }, FreshCutError> {
  const list = readReviewedResidue({ home });
  if (list.isErr()) {
    return err(list.error);
  }
  const candidate = acceptanceCandidate({
    entries: list.value.entries,
    files: scan.files,
    findings: scan.findings,
    line,
    path,
  });
  if (candidate.isErr()) {
    return err(FreshCutErrors.reviewedResidueCandidateRefused({ why: candidate.error.message }));
  }
  const entry: ReviewedResidueEntry = {
    className: REVIEWED_RESIDUE_CLASS,
    entryId: randomUUID(),
    judgement,
    lineNumberAtReview: line,
    lineSha256: candidate.value,
    path,
    reviewedAtIso: now.toISOString(),
    reviewedBySessionId: sessionId,
    reviewedRecordId: record.recordId,
    reviewedTreeSha: record.treeSha,
    schemaVersion: 1,
  };
  const written = appendReviewedResidue({ entry, home });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ entry, listPath: written.value });
}
