/**
 * One whole pass of `slopweaver fleet recover`: close anything an earlier pass left, then open a throwaway session per
 * vendor until one answers, closing each before the next opens.
 *
 * **Every session is a visible card, and there is one pass.** Each plan is tried at most once, one session at a time, so
 * the fallback is a short row of cards the owner can watch and stop, never a retry running behind them (rule 2).
 *
 * **A session this pass cannot prove gone stops it.** Opening another beside it, or removing the directory it runs in,
 * would be acting on a guess; the result says what could not be settled instead of a verdict on either vendor.
 *
 * Effects are injected through `recoveryPassDeps.ts`, so a test drives the whole pass with plain functions.
 */
import { errorMessage } from "#lib/errorMessage.js";

import type { AppSessionSnapshot } from "../sessionHarness/appProtocol.js";
import {
  boundedReason,
  type FleetRecoveryResult,
  judgeRecoverySnapshot,
  orderedRecoveryCandidates,
  RECOVERY_KEY_PREFIX,
  RECOVERY_PASS_MS,
  RECOVERY_TURN_MS,
  RECOVERY_VENDORS,
  type RecoveryAttempt,
  type RecoveryCandidate,
  type RecoveryEvidence,
  type RecoveryVerdict,
  recoveryAttemptFits,
  recoveryChallenge,
  recoveryResultOf,
} from "./recoveryCheck.js";
import type {
  RecoveryHost,
  RecoveryOpenFailure,
  RecoveryPassDeps,
  RecoveryScratch,
  RecoverySession,
} from "./recoveryPassDeps.js";

/** One pass as it runs: what it has read and done so far. */
interface PassState {
  readonly deps: RecoveryPassDeps;
  readonly runId: string;
  readonly startedMs: number;
  readonly attempts: RecoveryAttempt[];
  readonly evidence: RecoveryEvidence[];
}

/** An instant as ISO 8601. */
function isoOf({ ms }: { ms: number }): string {
  return new Date(ms).toISOString();
}

/** Whether the app still runs this session: neither of the two states an ended one is kept under. */
function isUp({ snapshot }: { snapshot: AppSessionSnapshot }): boolean {
  return snapshot.state !== "closed" && snapshot.state !== "failed";
}

/** Close each of these, or say which one could not be. */
async function closeAll({
  host,
  sessions,
}: {
  host: RecoveryHost;
  sessions: readonly RecoverySession[];
}): Promise<string | undefined> {
  for (const session of sessions) {
    const closed = await host.close({ session });
    if (closed.isErr()) {
      return `the throwaway session ${session.handle} could not be closed: ${closed.error}`;
    }
  }
  return undefined;
}

/**
 * Close what an earlier pass left and clear its directories: the app's own sessions first, then any row the ledger still
 * holds open for a session the app no longer has.
 *
 * A session is an earlier pass's only when its ledger key is a Recovery key AND it runs inside this home's scratch, so a
 * pass under one state home never closes another's.
 */
async function settleLeftovers({ deps }: { deps: RecoveryPassDeps }): Promise<string | undefined> {
  const { host, scratch } = deps;
  const listed = await host.list();
  if (listed.isErr()) {
    return listed.error;
  }
  const standing = listed.value.filter(
    (snapshot) =>
      isUp({ snapshot }) &&
      snapshot.ledgerKey.startsWith(RECOVERY_KEY_PREFIX) &&
      scratch.holds({ directory: snapshot.directory }),
  );
  const unclosed = await closeAll({ host, sessions: standing });
  if (unclosed !== undefined) {
    return unclosed;
  }
  const rows = host.leftOpen();
  if (rows.isErr()) {
    return rows.error;
  }
  const unsettled = await closeAll({ host, sessions: rows.value });
  if (unsettled !== undefined) {
    return unsettled;
  }
  return clearScratch({ scratch });
}

/** Remove the scratch, or say why it could not be. */
function clearScratch({ scratch }: { scratch: RecoveryScratch }): string | undefined {
  const cleared = scratch.clear();
  if (cleared.isErr()) {
    return cleared.error.message;
  }
  return undefined;
}

/** Watch one session until it passes, fails or runs out of time. A list the app did not answer is one look missed. */
async function awaitTurn({
  deps,
  session,
  challenge,
  deadlineMs,
}: {
  deps: RecoveryPassDeps;
  session: RecoverySession;
  challenge: ReturnType<typeof recoveryChallenge>;
  deadlineMs: number;
}): Promise<Exclude<RecoveryVerdict, { kind: "waiting" }>> {
  for (;;) {
    const deadlinePassed = deps.nowMs() >= deadlineMs;
    const listed = await deps.host.list();
    if (listed.isOk()) {
      const verdict = judgeRecoverySnapshot({
        ...challenge,
        deadlinePassed,
        snapshot: listed.value.find((snapshot) => snapshot.sessionId === session.sessionId),
      });
      if (verdict.kind !== "waiting") {
        return verdict;
      }
    } else if (deadlinePassed) {
      return { kind: "deadline", reason: boundedReason({ text: listed.error }) };
    }
    await deps.pause();
  }
}

/** A verdict as the attempt records it. */
function verdictFields({
  verdict,
}: {
  verdict: Exclude<RecoveryVerdict, { kind: "waiting" }>;
}): Pick<RecoveryAttempt, "outcome" | "reason"> {
  if (verdict.kind === "passed") {
    return { outcome: "passed", reason: "it answered" };
  }
  return { outcome: verdict.kind, reason: verdict.reason };
}

/** One attempt, and why the pass must stop after it when its session could not be settled. */
interface AttemptDone {
  readonly attempt: RecoveryAttempt;
  readonly infrastructure?: string;
}

/**
 * A launch that left no session it named: close anything the app nonetheless holds under this attempt's own key and
 * in this home's scratch. A launch the app never answered may still open its card after that look, so the pass stops
 * there rather than open the next one beside it; the next pass closes it as a leftover.
 */
async function settleRefusedLaunch({
  deps,
  base,
  ledgerKey,
  failure,
}: {
  deps: RecoveryPassDeps;
  base: Pick<RecoveryAttempt, "alias" | "attemptId" | "vendor">;
  ledgerKey: string;
  failure: RecoveryOpenFailure;
}): Promise<AttemptDone> {
  const attempt: RecoveryAttempt = {
    ...base,
    outcome: "launch-refused",
    reason: boundedReason({ text: failure.message }),
  };
  const listed = await deps.host.list();
  if (listed.isErr()) {
    return { attempt, infrastructure: listed.error };
  }
  const stragglers = listed.value.filter(
    (snapshot) =>
      isUp({ snapshot }) && snapshot.ledgerKey === ledgerKey && deps.scratch.holds({ directory: snapshot.directory }),
  );
  const unclosed = await closeAll({ host: deps.host, sessions: stragglers });
  if (unclosed !== undefined) {
    return { attempt, infrastructure: unclosed };
  }
  if (failure.unanswered === true) {
    return {
      attempt,
      infrastructure: `the app never answered the launch on ${base.alias}, so its card may still open; the check stopped rather than open another beside it`,
    };
  }
  return { attempt };
}

/** Open one throwaway session, judge its turn and close it. */
async function tryCandidate({
  state,
  candidate,
  attemptId,
  directory,
}: {
  state: PassState;
  candidate: RecoveryCandidate;
  attemptId: string;
  directory: string;
}): Promise<AttemptDone> {
  const { deps, runId, startedMs } = state;
  const { alias, vendor } = candidate;
  const base = { alias, attemptId, vendor };
  const ledgerKey = `${RECOVERY_KEY_PREFIX}${runId}:${vendor}:${alias}`;
  const challenge = recoveryChallenge({ randomBytes: deps.randomBytes });
  const opened = await deps.host.open({
    candidate,
    directory,
    ledgerKey,
    openedAtIso: isoOf({ ms: deps.nowMs() }),
    prompt: challenge.prompt,
  });
  let session: RecoverySession;
  if (opened.isOk()) {
    session = opened.value;
  } else if (opened.error.left === undefined) {
    return settleRefusedLaunch({ base, deps, failure: opened.error, ledgerKey });
  } else {
    session = opened.error.left;
  }
  // A delivery the launch could not confirm is judged like any other: the turn itself is the evidence.
  const deadlineMs = Math.min(deps.nowMs() + RECOVERY_TURN_MS, startedMs + RECOVERY_PASS_MS);
  const verdict = await awaitTurn({ challenge, deadlineMs, deps, session });
  const attempt: RecoveryAttempt = { ...base, ...verdictFields({ verdict }), sessionId: session.sessionId };
  const unclosed = await closeAll({ host: deps.host, sessions: [session] });
  if (unclosed !== undefined) {
    return { attempt, infrastructure: unclosed };
  }
  return { attempt };
}

/** Try one vendor's plans, best first, until one passes. Answers why the pass must stop, when it must. */
async function checkVendor({
  state,
  evidence,
}: {
  state: PassState;
  evidence: RecoveryEvidence;
}): Promise<string | undefined> {
  const { attempts, deps, runId, startedMs } = state;
  for (const candidate of orderedRecoveryCandidates({ evidence })) {
    const attemptId = `${runId}-${String(attempts.length + 1)}`;
    if (!recoveryAttemptFits({ nowMs: deps.nowMs(), startedMs })) {
      const { alias, vendor } = candidate;
      attempts.push({ alias, attemptId, outcome: "deadline", reason: "not tried: the check ran out of time", vendor });
      continue;
    }
    if (!deps.lockHeld()) {
      return "another Recovery check took over";
    }
    const directory = deps.scratch.make({ attemptId });
    if (directory.isErr()) {
      return directory.error.message;
    }
    const done = await tryCandidate({ attemptId, candidate, directory: directory.value, state });
    attempts.push(done.attempt);
    if (done.infrastructure !== undefined || done.attempt.outcome === "passed") {
      return done.infrastructure;
    }
  }
  return undefined;
}

/** Every vendor in turn. Answers why the pass stopped short, when it did. */
async function checkVendors({ state }: { state: PassState }): Promise<string | undefined> {
  for (const vendor of RECOVERY_VENDORS) {
    const evidence = await state.deps.evidence({ vendor });
    state.evidence.push(evidence);
    const stopped = await checkVendor({ evidence, state });
    if (stopped !== undefined) {
      return stopped;
    }
  }
  return undefined;
}

/** The whole pass. Answers why it could not run or clean up, when it could not. */
async function runSettled({ state }: { state: PassState }): Promise<string | undefined> {
  const { deps } = state;
  const left = await settleLeftovers({ deps });
  if (left !== undefined) {
    return left;
  }
  const stopped = await checkVendors({ state });
  if (stopped !== undefined) {
    // Whatever stopped it may still be running in its directory, so nothing is removed.
    return stopped;
  }
  return clearScratch({ scratch: deps.scratch });
}

/** {@link runSettled}, with a throw from any effect turned into why the pass could not run. */
async function runGuarded({ state }: { state: PassState }): Promise<string | undefined> {
  try {
    return await runSettled({ state });
  } catch (error: unknown) {
    return errorMessage({ error });
  }
}

/**
 * Run one bounded Recovery pass.
 *
 * @param deps everything the pass does to the world
 * @param runId the pass's own id, a path segment, part of every session's ledger key
 * @returns what each vendor did, or why the check itself could not run or clean up
 */
export async function runRecoveryPass({
  deps,
  runId,
}: {
  deps: RecoveryPassDeps;
  runId: string;
}): Promise<FleetRecoveryResult> {
  const startedMs = deps.nowMs();
  const state: PassState = { attempts: [], deps, evidence: [], runId, startedMs };
  const infrastructure = await runGuarded({ state });
  return recoveryResultOf({
    attempts: state.attempts,
    evidence: state.evidence,
    finishedAtIso: isoOf({ ms: deps.nowMs() }),
    infrastructure,
    runId,
    startedAtIso: isoOf({ ms: startedMs }),
  });
}
