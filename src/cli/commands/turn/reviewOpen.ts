/*
 * The OPEN mode: validate the answer, boot a reviewer onto it, record where that reviewer is, deliver its
 * pickup, and report.
 *
 * The boot-then-record-then-deliver order is the contract, and `openReview` is where it is visible in one
 * body — a reviewer that reads its packet before the record naming it exists is the race this ordering
 * closes, the same one `turn dispatch` closes for a worker. `./reviewPacket.js` owns what the reviewer READS;
 * this file owns when it is opened.
 */
import { readFileSync } from "node:fs";

import { opusSpawnEffort } from "../../../cmux/modelPin.js";
import { planReviewSession } from "../../../cmux/plan.js";
import { runningCheckoutBranch, runningCheckoutRoot } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { preflightRefusal } from "../../../live/turn/answerPreflight.js";
import { answerableProjectionOf, validateAnswerForDispatch } from "../../../live/turn/briefAnswerable.js";
import { deliverFreshSessionPickup, launchFreshVisibleSession } from "../../../live/turn/freshSession.js";
import { answerDigestOf } from "../../../live/turn/poster.js";
import { appendProgressLogEvent } from "../../../live/turn/progressLog.js";
import { reviewerPickupPrompt } from "../../../live/turn/review.js";
import { resolveReviewPacketImages } from "../../../live/turn/reviewImages.js";
import { archiveSupersededVerdict, reviewPaths, writeReviewedAnswer } from "../../../live/turn/reviewStore.js";
import { packetCarriesClock } from "../../../live/turn/reviewThroughput.js";
import { registerDispatchedSession } from "../../../live/turn/sessionLedger.js";
import type { FreshVisibleSessionRef } from "../../../live/turn/tier.js";
import { type AnswerFormAnswer, parseAnswerArm } from "../../../outbound/assistant/answerForm.js";
import { productionSpawnDeps } from "../../../sessionHarness/recordedSpawn.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { botAnswerBareRefContext } from "../../bareRefContext.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type TurnCommandError, TurnCommandErrors, turnCommandErrorLines } from "./errors.js";
import { reviewAfterCleanRefusal } from "./reviewAfterClean.js";
import { refuse } from "./reviewCommon.js";
import { recordCarryStarvation, recordRoundCap } from "./reviewLedger.js";
import { inheritedRound, recordReview } from "./reviewPacket.js";
import { type ReviewSubject, readJson } from "./reviewSubject.js";
import { roundOneThreadRefusals } from "./reviewThreadPreflight.js";

/*
 * An early return rather than `runningCheckoutBranch() ?? "detached"`: `no-silent-fallback` refuses the `??`,
 * and oxlint's `prefer-nullish-coalescing` refuses the ternary and the let-reassign spelling of the same
 * idea, so a returning statement is the shape that satisfies both (`resolveHome`, `src/cli/optionParsers.ts`).
 * A detached HEAD is a real checkout state the reviewer's plan has to name, not an error.
 */
function reviewBranchLabel(): string {
  const branch = runningCheckoutBranch();
  if (branch === undefined) {
    return "detached";
  }
  return branch;
}

/**
 * The answer, parsed through the door's own schema and checked against the decision it was judged under.
 *
 * @param answerPath the composed answer on disk
 * @param subject the ask, its brief and the decision that dispatched it
 * @param home the resolved state home
 * @returns the parsed answer, or every reason it would be refused before a reviewer ever saw it
 */
export function validatedAnswer({
  answerPath,
  subject,
  home,
}: {
  answerPath: string;
  subject: ReviewSubject;
  home: string;
}): Result<AnswerFormAnswer, TurnCommandError> {
  const raw = readJson({ path: answerPath, what: "answer" });
  if (raw.isErr()) {
    return err(raw.error);
  }
  const answer = parseAnswerArm({ context: botAnswerBareRefContext({ home }), home, raw: raw.value });
  if (answer.isErr()) {
    return err(TurnCommandErrors.upstreamRefused({ reasons: answer.error }));
  }
  const validated = validateAnswerForDispatch({
    answer: answer.value,
    brief: answerableProjectionOf({ brief: subject.brief }),
    decision: subject.decision,
  });
  return validated.isErr()
    ? err(TurnCommandErrors.answerPreflightRefused({ cause: validated.error.message }))
    : ok(answer.value);
}

/** Boot the reviewer's workspace, opening and closing the spawn deps around the one launch. */
async function bootReviewer({
  plan,
}: {
  plan: ReturnType<typeof planReviewSession>;
}): Promise<Result<FreshVisibleSessionRef, TurnCommandError>> {
  const spawnDeps = productionSpawnDeps();
  try {
    const outcome = await launchFreshVisibleSession({ deps: spawnDeps, plan });
    return "reason" in outcome
      ? err(TurnCommandErrors.reviewerBootFailed({ cause: outcome.reason }))
      : ok(outcome.session);
  } finally {
    spawnDeps.close();
  }
}

/**
 * Deliver the pickup line into the already-recorded reviewer workspace.
 *
 * An `unwitnessed` delivery is accepted rather than refused, and says so on stderr. The line was accepted by
 * cmux, so the reviewer most likely has it queued; refusing here would close and re-open a workspace that is
 * about to start work, and the `turn review --poll` this verb prints next is the check that actually settles
 * whether a verdict is coming. See `../../../cmux/pickupWitnessWindow.ts`'s `sendPickupOnceThenWitness` for why the line is
 * typed once, and its `resubmitPickupThenWitness` for the bare Enter that has already been sent by the time
 * this arm is reached — the reviewer strand is what that step closes.
 *
 * @param packetPath the written packet, checked for its clock before anything is sent
 * @param plan the reviewer's plan, naming the pickup text
 * @param session the already-booted reviewer workspace
 * @returns `ok` once the line was sent, or the reason it could not be sent at all
 */
async function deliverReviewerPickup({
  packetPath,
  plan,
  session,
}: {
  packetPath: string;
  plan: ReturnType<typeof planReviewSession>;
  session: FreshVisibleSessionRef;
}): Promise<Result<void, TurnCommandError>> {
  // The packet's clock is composed by code, so this only fires if a later edit drops it — and then no
  // reviewer starts a round blind to the fact that it is on the asker's critical path.
  if (!packetCarriesClock({ packet: readFileSync(packetPath, "utf8") })) {
    return err(TurnCommandErrors.packetWithoutClock({ packetPath, workspaceRef: session.workspaceRef }));
  }
  const spawnDeps = productionSpawnDeps();
  try {
    const delivered = await deliverFreshSessionPickup({ deps: spawnDeps, plan, session });
    if (delivered.isErr()) {
      return err(
        TurnCommandErrors.reviewerPickupUnsent({ cause: delivered.error.reason, workspaceRef: session.workspaceRef }),
      );
    }
    if (delivered.value.kind === "unwitnessed") {
      logger.error({
        msg:
          `turn review: the reviewer's pickup line was sent into ${session.workspaceRef}, its composer was ` +
          `submitted again, and nothing witnessed it arriving — it was NOT re-typed, because a queued prompt ` +
          `looks exactly like this. Poll for the verdict as normal; do not type the line in by hand.`,
      });
    }
    return ok(undefined);
  } finally {
    spawnDeps.close();
  }
}

/** What the caller said about its own read of the thread: `--read-through` and `--delta-cleared`. */
export interface ThreadReadClaim {
  readonly cleared: boolean;
  readonly readThrough: string | undefined;
}

/**
 * The round-1 live thread check, or nothing on a later round — whose reviewer re-reads the tail itself and whose
 * send re-reads it again (`./reviewThreadPreflight.ts`'s header). Named on stderr when the flags were passed to
 * a later round, so they are never silently a no-op.
 *
 * @param home the resolved state home
 * @param round which round this would be
 * @param subject the ask whose thread is read
 * @param threadRead what the caller claimed about its read
 * @returns the refusal lines, empty when the round may open
 */
async function threadRefusals({
  home,
  round,
  subject,
  threadRead,
}: {
  home: string;
  round: number;
  subject: ReviewSubject;
  threadRead: ThreadReadClaim;
}): Promise<readonly string[]> {
  if (round > 1) {
    if (threadRead.cleared || threadRead.readThrough !== undefined) {
      logger.error({
        msg: `turn review: --read-through/--delta-cleared are checked before round 1 only; this is round ${String(round)}, whose reviewer re-reads the thread itself`,
      });
    }
    return [];
  }
  return roundOneThreadRefusals({
    askIdentity: subject.askIdentity,
    cleared: threadRead.cleared,
    home,
    nowIso: new Date().toISOString(),
    readThrough: threadRead.readThrough,
  });
}

/**
 * Every reason this round must not open, before anything is booted: the answer's own preflight, then — on round
 * 1 — a thread that moved past the draft's read (`./reviewThreadPreflight.ts`), then a round that would follow
 * a CLEAN one (`./reviewAfterClean.ts`).
 *
 * @param answer the validated answer this round would review
 * @param home the resolved state home
 * @param inherited what the outgoing round left
 * @param subject the ask, its brief and the decision
 * @param threadRead what the caller claimed about its own read of the thread
 * @returns the refusal lines, empty when the round may open
 */
async function openRefusals({
  answer,
  home,
  inherited,
  subject,
  threadRead,
}: {
  answer: AnswerFormAnswer;
  home: string;
  inherited: ReturnType<typeof inheritedRound>;
  subject: ReviewSubject;
  threadRead: ThreadReadClaim;
}): Promise<readonly string[]> {
  // The composition root for the roster port: this verb is a CLI shell, so the store row is read here.
  const blocked = await preflightRefusal({ answer, brief: subject.brief, home, identityRoster: identityRosterPort() });
  if (blocked.length > 0) {
    return blocked;
  }
  const moved = await threadRefusals({ home, round: inherited.round, subject, threadRead });
  if (moved.length > 0) {
    return moved;
  }
  return reviewAfterCleanRefusal({ answer, askIdentity: subject.askIdentity, env: process.env, home, inherited });
}

/** The reviewer's plan for one subject — the current checkout, the pinned model, the pickup naming the packet. */
function reviewPlan({
  model,
  paths,
  subject,
}: {
  model: string;
  paths: ReturnType<typeof reviewPaths>;
  subject: ReviewSubject;
}): ReturnType<typeof planReviewSession> {
  const effort = opusSpawnEffort({ host: subject.host, model });
  return planReviewSession({
    askChannel: subject.askIdentity.channel,
    askMessageTs: subject.askIdentity.messageTs,
    askQuestion: subject.brief.question,
    branch: reviewBranchLabel(),
    ...(effort === undefined ? {} : { effort }),
    host: subject.host,
    model,
    pickupCommand: reviewerPickupPrompt({ packetPath: paths.packet, verdictPath: paths.verdict }),
    repoRoot: runningCheckoutRoot(),
    spawnedAt: new Date().toISOString(),
  });
}

/**
 * Move the outgoing round's verdict out of the fixed path, and say so when there was one.
 *
 * @param paths the ask's review paths
 */
function archiveAndReport({ paths }: { paths: ReturnType<typeof reviewPaths> }): void {
  const archived = archiveSupersededVerdict({ paths });
  if (archived !== undefined) {
    logger.out({ line: `archived the previous round's verdict to ${archived} before opening this one` });
  }
}

/**
 * Put the booted reviewer on the same board the worker's own entry is on, under the reviewer's own name —
 * so "who is mid-verdict" is a row to read rather than a workspace ref to correlate by hand. Called straight
 * after the boot, before any snapshot or record write: the reviewer is already standing, so a write that throws
 * must not leave it off the ledger.
 *
 * @param booted the reviewer's freshly opened session
 * @param home the resolved state home
 * @param plan the session plan the reviewer was booted from
 */
function registerBootedReviewer({
  booted,
  home,
  plan,
}: {
  booted: FreshVisibleSessionRef;
  home: string;
  plan: ReturnType<typeof reviewPlan>;
}): void {
  registerDispatchedSession({
    home,
    plan,
    surfaceRef: booted.surfaceRef,
    workspaceId: booted.workspaceId,
    workspaceRef: booted.workspaceRef,
  });
}

/**
 * What an opened review prints — where the reviewer is, which bytes it is bound to, where its verdict lands.
 *
 * @param answerDigest the digest the verdict must name for the door to accept it
 * @param model the reviewer's pinned model
 * @param paths the ask's review paths
 * @param round which round this is, 1-based
 * @param workspaceRef the reviewer's own workspace
 */
function reportOpened({
  answerDigest,
  model,
  paths,
  round,
  workspaceRef,
}: {
  answerDigest: string;
  model: string;
  paths: ReturnType<typeof reviewPaths>;
  round: number;
  workspaceRef: string;
}): void {
  logger.out({
    line: `reviewer opened in ${workspaceRef} (model ${model}, round ${String(round)}) — packet ${paths.packet}`,
  });
  logger.out({ line: `digest ${answerDigest}` });
  logger.out({ line: `verdict will land at ${paths.verdict}` });
}

/**
 * File this round on the turn's progress log, so the card's loop draws it as a phase. Called only once a
 * reviewer holds its pickup: a round that never opened would be a phase nothing happened in. The card shows
 * it on the next push, by whichever writer.
 *
 * @param askIdentity the ask whose progress log this appends to
 * @param home the resolved state home
 * @param round the review round that just opened
 */
function recordReviewPhase({
  askIdentity,
  home,
  round,
}: {
  askIdentity: ReviewSubject["askIdentity"];
  home: string;
  round: number;
}): void {
  appendProgressLogEvent({ askIdentity, event: { kind: "review", round, tsIso: new Date().toISOString() }, home });
}

/**
 * The open mode, once the subject and answer are resolved: boot, record, deliver, report.
 *
 * @param answer the validated answer this round reviews
 * @param answerPath where that answer was read from
 * @param home the resolved state home
 * @param model the model the reviewer is pinned to
 * @param subject the ask, its brief and the decision that dispatched it
 * @param threadRead what the caller claimed about its own read of the thread, checked live before round 1
 * @returns the exit code: OK once a reviewer is booted and holding its pickup
 */
export async function openReview({
  answer,
  answerPath,
  home,
  model,
  subject,
  threadRead,
}: {
  answer: AnswerFormAnswer;
  answerPath: string;
  home: string;
  model: string;
  subject: ReviewSubject;
  threadRead: ThreadReadClaim;
}): Promise<number> {
  const paths = reviewPaths({ askIdentity: subject.askIdentity, home });
  // Read what this round inherits BEFORE the archive moves the outgoing verdict out of the way — the round
  // number and the claims the last round left open both come off files this next step disturbs.
  const inherited = inheritedRound({ askIdentity: subject.askIdentity, home });
  const blocked = await openRefusals({ answer, home, inherited, subject, threadRead });
  if (blocked.length > 0) {
    return refuse({ code: EXIT_ERROR, errors: blocked });
  }
  // BEFORE the spawn, not only when the record is written. A verdict left at the fixed path by a previous
  // round is what made `--poll` close the incoming reviewer, so no reviewer is opened while one is still
  // sitting there — and a session must not have to remember this, which is why it is here and not in a skill.
  archiveAndReport({ paths });
  recordRoundCap({ askIdentity: subject.askIdentity, home, round: inherited.round });
  recordCarryStarvation({ askIdentity: subject.askIdentity, home, inherited });
  const plan = reviewPlan({ model, paths, subject });
  const booted = await bootReviewer({ plan });
  if (booted.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: booted.error }) });
  }
  registerBootedReviewer({ booted: booted.value, home, plan });
  const answerDigest = answerDigestOf({ answer });
  writeReviewedAnswer({ answer, askIdentity: subject.askIdentity, digest: answerDigest, home });
  // Resolved HERE, not inside the synchronous `recordReview`, so the packet's one filesystem read stays visible
  // to every caller. An attachment that will not read is a ROW in the inventory, never a dropped entry — a
  // packet silently omitting a picture it could not open tells the reviewer there is nothing to look at.
  const images = await resolveReviewPacketImages({ paths: answer.images });
  recordReview({
    answer,
    answerDigest,
    answerPath,
    home,
    images,
    inherited,
    reviewer: booted.value,
    spawnedAt: plan.spawnedAt,
    subject,
  });
  const delivered = await deliverReviewerPickup({ packetPath: paths.packet, plan, session: booted.value });
  if (delivered.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: delivered.error }) });
  }
  recordReviewPhase({ askIdentity: subject.askIdentity, home, round: inherited.round });
  reportOpened({ answerDigest, model, paths, round: inherited.round, workspaceRef: booted.value.workspaceRef });
  return EXIT_OK;
}
