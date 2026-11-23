/**
 * The loop-breakage rows `turn review` owes the ledger — a round past the cap, a round that opens on a blank
 * page although the last one settled claims, a reviewer that died without writing a verdict, and a previous
 * round's reviewer whose verdict landed after the next round opened (archived here as well as recorded).
 *
 * Every row is composed by `../../../live/turn/reviewRounds.ts` or `../../../live/turn/review.ts` (pure) and
 * appended here (effect), with the one line whoever opened the round should see. None of these refuses
 * anything: a breakage row makes a pathology durable, and `turn review`'s own header says why blocking the
 * round would take the fix-and-re-review path away instead of the pathology.
 */
import { dirname, join } from "node:path";
import { logger } from "../../../lib/logger.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { LOOP_BREAKAGE_FILE, recordLoopBreakage } from "../../../live/turn/loopBreakage.js";
import type { ReviewRecord } from "../../../live/turn/review.js";
import {
  lateReviewerVerdictBreakage,
  lateVerdictArchiveInstant,
  type ReviewPollTruth,
  reviewerDeathBreakage,
} from "../../../live/turn/reviewPoll.js";
import {
  type CarriedForward,
  carryStarvationBreakage,
  REVIEW_ROUND_CAP,
  roundCapBreakage,
} from "../../../live/turn/reviewRounds.js";
import {
  claimVerdictFile,
  linkVerdictArchive,
  readReviewRecord,
  readVerdictFile,
  removeClaimedVerdict,
  restoreClaimedVerdict,
  reviewPaths,
} from "../../../live/turn/reviewStore.js";
import { stateHomePaths } from "../../../stateHome.js";

/**
 * Surface an ask that has run past {@link REVIEW_ROUND_CAP} — a line for whoever opened the round, and a
 * durable breakage row so the pathology outlives the terminal it was printed in.
 *
 * A no-op inside the cap. It never refuses the round: read `reviewRounds.ts` for why blocking one would take
 * the fix-and-re-review path away instead of taking the six rounds away.
 *
 * @param askIdentity the ask being reviewed again
 * @param home the resolved state home
 * @param round which round is opening, 1-based
 * @param now samples the instant the row is stamped with, only past the cap; the wall clock unless a test
 *   supplies its own
 */
export function recordRoundCap({
  askIdentity,
  home,
  round,
  now = () => new Date(),
}: {
  askIdentity: AskIdentity;
  home: string;
  round: number;
  now?: () => Date;
}): void {
  if (round <= REVIEW_ROUND_CAP) {
    return;
  }
  logger.out({
    line:
      `round ${String(round)} of review for this ask, past the cap of ${String(REVIEW_ROUND_CAP)} — this packet ` +
      "narrows what a NEW finding in scope the question never asked for is allowed to escalate to",
  });
  const written = recordLoopBreakage({
    breakage: roundCapBreakage({ askIdentity, atIso: now().toISOString(), round }),
    home,
  });
  if (written.written) {
    logger.out({ line: `recorded in ${join(stateHomePaths({ home }).ledgers, LOOP_BREAKAGE_FILE)}` });
  }
}

/**
 * Surface a round that opens on a blank page although the last round settled high-impact claims — a line for
 * whoever opened it, and the durable breakage row `reviewRounds.ts` says the starvation is owed.
 *
 * A no-op when the round carries anything, or when the last round settled nothing. Never refuses the round.
 *
 * @param askIdentity the ask being reviewed again
 * @param home the resolved state home
 * @param inherited what this round inherits
 * @param now samples the instant the row would be stamped with — asked before the starvation is judged, so
 *   even a round that owes no row samples it once; the wall clock unless a test supplies its own
 */
export function recordCarryStarvation({
  askIdentity,
  home,
  inherited,
  now = () => new Date(),
}: {
  askIdentity: AskIdentity;
  home: string;
  inherited: CarriedForward;
  now?: () => Date;
}): void {
  const breakage = carryStarvationBreakage({ askIdentity, atIso: now().toISOString(), inherited });
  if (breakage === undefined) {
    return;
  }
  logger.out({ line: `${breakage.error} — ${breakage.didInstead}` });
  const written = recordLoopBreakage({ breakage, home });
  if (written.written) {
    logger.out({ line: `recorded in ${join(stateHomePaths({ home }).ledgers, LOOP_BREAKAGE_FILE)}` });
  }
}

/**
 * Write the loop-breakage row a reviewer's death is owed, so the death leaves a durable trace instead of only
 * a line in whichever terminal happened to poll.
 *
 * Reported and ignored on failure, and never allowed to change what the poll reports: the caller is being
 * told its reviewer is gone, which is the more important half of this moment.
 *
 * @param home the state home the ledger lives under
 * @param record the review whose reviewer died
 * @param truth the phantom truth
 * @param now samples the instant the row is stamped with; the wall clock unless a test supplies its own
 */
export function recordReviewerDeath({
  home,
  record,
  truth,
  now = () => new Date(),
}: {
  home: string;
  record: ReviewRecord;
  truth: Extract<ReviewPollTruth, { kind: "phantom" }>;
  now?: () => Date;
}): void {
  const written = recordLoopBreakage({
    breakage: reviewerDeathBreakage({ atIso: now().toISOString(), record, truth }),
    home,
  });
  if (written.written) {
    logger.out({ line: `recorded in ${join(stateHomePaths({ home }).ledgers, LOOP_BREAKAGE_FILE)}` });
  }
}

/**
 * Archive a verdict a PREVIOUS round's reviewer wrote after this round opened, and write the breakage row it
 * is owed — the act a worker used to do by hand with `mv`, recording nothing (see
 * `lateReviewerVerdictBreakage`).
 *
 * The recorded reviewer's own verdict at that path is the answer the worker is waiting for, so only a file
 * that speaks for some OTHER reviewer is archived, and the judgement is made on a CLAIMED copy: the file is
 * renamed off the path first (`claimVerdictFile`) and the claimed bytes are classified. Judging the path and
 * then moving it let a reviewer writing in between have its own verdict archived. A claimed file that turns out to be this round's own is put back, never over a newer one; while it is
 * claimed the path reads empty, which every reader already treats as "still working". The cheap read first
 * keeps the common path from touching the file at all. The row is written only after the archive succeeded,
 * so it never records a recovery that did not happen, and a verdict whose row could not be written is put
 * back for the next poll and thrown, the leftover archive link named in the throw, so none stands unrecorded
 * and unnamed. Nothing here closes, presses or releases a workspace.
 *
 * `record` is whatever the poll read before its liveness I/O, so it can be a round already replaced: a file
 * judged against it could be the NEW round's own verdict. So `record.json` is read again, and
 * nothing moves unless it still names the same round, asked both before the claim and after it.
 *
 * @param home the state home the review and the ledger live under
 * @param record the review now standing
 * @param now samples the instant the row is stamped with; the wall clock unless a test supplies its own
 * @returns where the verdict was archived, or `undefined` when the file no longer needed moving
 */
export function archiveLateReviewerVerdict({
  home,
  record,
  now = () => new Date(),
}: {
  home: string;
  record: ReviewRecord;
  now?: () => Date;
}): string | undefined {
  if (!stillStanding({ home, record }) || readVerdictFile({ record }).kind !== "superseded") {
    return undefined;
  }
  // The record's own path, never one recomputed from `home`: the two are the same directory, and moving a file
  // other than the one judged foreign is the one mistake this function must not make.
  const paths = { dir: dirname(record.verdictPath), verdict: record.verdictPath };
  // Sampled before anything moves: a clock that throws once the archive is linked would skip the undo below.
  const atIso = now().toISOString();
  const claimed = claimVerdictFile({ paths });
  if (claimed === undefined) {
    return undefined;
  }
  const read = readVerdictFile({ record: { ...record, verdictPath: claimed } });
  // Asked again AFTER the claim: a round opening between the first ask and the claim would make the claimed
  // file that new round's own, so nothing is archived unless the round judged against is still the one open.
  if (read.kind !== "superseded" || !stillStanding({ home, record })) {
    putBack({ moved: claimed, paths, why: "was claimed to judge it" });
    return undefined;
  }
  // Link, then the row, then the unlink: the archive NAME exists only while the claim still holds the same
  // bytes, so a row that cannot be written drops just the link and the claim goes back, and an unlink that
  // fails afterwards leaves the archive and its row standing.
  const archivedPath = linkOrPutBack({ claimed, paths, record, reviewer: read.wroteIt });
  if (archivedPath === undefined) {
    return undefined;
  }
  const row = writeLateVerdictRow({ archivedPath, atIso, home, record, wroteIt: read.wroteIt });
  if (row.failure !== undefined) {
    refuseUnrecordedArchive({ archivedPath, claimed, failure: row.failure, paths });
  }
  // The claim is removed BEFORE anything is printed: a write to a closed stdout throws, and must not strand the
  // claim beside an archive that is already recorded.
  const claimLeft = removeClaimedVerdict({ claimed });
  logger.out({ line: `archived a late verdict from ${read.wroteIt}, a previous round's reviewer, to ${archivedPath}` });
  if (row.written) {
    logger.out({ line: `recorded in ${join(stateHomePaths({ home }).ledgers, LOOP_BREAKAGE_FILE)}` });
  }
  if (claimLeft !== undefined) {
    logger.error({ msg: `archived and recorded, but the claim ${claimed} could not be removed: ${claimLeft}` });
  }
  return archivedPath;
}

/**
 * Link a claimed late verdict under its archive name, putting the claim back when the link throws.
 *
 * @param claimed the claim path now holding the late verdict
 * @param paths the review directory and the fixed verdict path inside it
 * @param record the review now standing, whose spawn instant names the archive
 * @param reviewer the previous round's reviewer the verdict speaks for
 * @returns the archive path, or `undefined` when the archive helper had nothing to link
 */
function linkOrPutBack({
  claimed,
  paths,
  record,
  reviewer,
}: {
  claimed: string;
  paths: { readonly dir: string; readonly verdict: string };
  record: ReviewRecord;
  reviewer: string;
}): string | undefined {
  try {
    return linkVerdictArchive({
      paths: { dir: paths.dir, verdict: claimed },
      reviewer,
      spawnedAt: lateVerdictArchiveInstant({ record }),
    });
  } catch (cause) {
    putBack({ moved: claimed, paths, why: "was claimed to archive it" });
    throw cause;
  }
}

/**
 * Write the late verdict's loop-breakage row. A duplicate is not a failure — the row already stands — and a
 * throw out of the writer (its own failure report hitting a closed stderr) is a failed row too, never an escape
 * past the put-back.
 *
 * @param archivedPath where the late verdict now lives
 * @param atIso the instant the row is stamped with, sampled before anything moved
 * @param home the state home the ledger lives under
 * @param record the review now standing
 * @param wroteIt the previous round's reviewer the verdict speaks for
 * @returns whether a row was written, and why not when that is a failure the caller must undo
 */
function writeLateVerdictRow({
  archivedPath,
  atIso,
  home,
  record,
  wroteIt,
}: {
  archivedPath: string;
  atIso: string;
  home: string;
  record: ReviewRecord;
  wroteIt: string;
}): { written: boolean; failure: { why: string; cause: unknown } | undefined } {
  try {
    const written = recordLoopBreakage({
      breakage: lateReviewerVerdictBreakage({ archivedPath, atIso, record, wroteIt }),
      home,
    });
    const failed = !written.written && written.kind !== "duplicate";
    return { failure: failed ? { cause: undefined, why: written.why } : undefined, written: written.written };
  } catch (cause) {
    // A fixed string, carried with the cause rather than read off it: describing an arbitrary throw can throw
    // again, before the put-back.
    return { failure: { cause, why: "the loop-breakage writer threw" }, written: false };
  }
}

/**
 * Put the claim back after its row could not be written, and throw naming the archive link left standing.
 *
 * An archive with no row is the undercount this exists to close, and an empty path would stop any later poll
 * from retrying, so the verdict goes back and the next poll tries both again. If this round's reviewer writes
 * inside the put-back, `putBack` keeps both and the throw names the claim and the link. The archive link is
 * KEPT and named rather than dropped: once the claim is back, a reviewer renaming its own verdict over the path
 * would make that link the late verdict's last name, and no unlink can be made conditional on another link
 * surviving. A named duplicate beats a lost verdict.
 *
 * @param archivedPath the archive link that stays standing, unrecorded
 * @param claimed the claim path to put back
 * @param failure why the row was not written, and the throw behind it when there was one
 * @param paths the review directory and the fixed verdict path inside it
 */
function refuseUnrecordedArchive({
  archivedPath,
  claimed,
  failure,
  paths,
}: {
  archivedPath: string;
  claimed: string;
  failure: { why: string; cause: unknown };
  paths: { readonly dir: string; readonly verdict: string };
}): never {
  const kept = `the unrecorded archive link ${archivedPath} is left standing and is safe to remove`;
  try {
    putBack({ moved: claimed, paths, why: "was claimed, but its loop-breakage row could not be written," });
  } catch (cause) {
    // A newer verdict landing inside the put-back throws naming only the claim; the link is named too.
    const why = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${why}; ${kept}`, { cause });
  }
  throw new Error(
    `the late verdict's loop-breakage row was not written (${failure.why}), so it was put back for the next poll — ${kept}`,
    { cause: failure.cause },
  );
}

/**
 * Whether `record.json` still names the round `record` describes — same spawn, same reviewer session.
 *
 * @param home the state home the review lives under
 * @param record the round the caller is about to judge a verdict against
 * @returns `false` when the record is gone, unreadable, now describes another round, or names a verdict path
 *   other than the canonical one
 */
function stillStanding({ home, record }: { home: string; record: ReviewRecord }): boolean {
  const askIdentity = { channel: record.channel, messageTs: record.messageTs, threadTs: record.threadTs };
  const standing = readReviewRecord({ askIdentity, home });
  // Only the canonical `verdict.json`: a recorded path named like an archive would make the archive link land
  // back on the live path.
  return (
    record.verdictPath === reviewPaths({ askIdentity, home }).verdict &&
    standing !== undefined &&
    standing.spawnedAt === record.spawnedAt &&
    standing.reviewerSession === record.reviewerSession &&
    standing.verdictPath === record.verdictPath
  );
}

/**
 * Put a file this module moved off the verdict path back onto it, refusing loudly — both files kept — when
 * another file landed there in the meantime.
 *
 * @param moved where the file sits now
 * @param paths the review directory and the fixed verdict path inside it
 * @param why what the move was for, completing "<verdict path> <why> and another file landed there"
 */
function putBack({
  moved,
  paths,
  why,
}: {
  moved: string;
  paths: { readonly dir: string; readonly verdict: string };
  why: string;
}): void {
  if (restoreClaimedVerdict({ claimed: moved, paths }) === "path-taken") {
    throw new Error(
      `${paths.verdict} ${why} and another file landed there before it could be put back — both kept, the moved one at ${moved}`,
    );
  }
}
