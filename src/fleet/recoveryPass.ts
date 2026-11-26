/**
 * One whole pass of `slopweaver fleet recover`: close anything an earlier pass left (`./recoveryLeftovers.ts`), read
 * whether the supervisor is
 * down, then open a throwaway session per vendor until one answers, closing each before the next opens. While the
 * supervisor is down, the first plan that answers seats a new chair (`./recoveryRestart.ts`); a chair that never
 * opened, or ended before it took the pin, falls back to the vendor's next plan, then the next vendor's.
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

import {
  type RecoveryChairReading,
  type RecoveryRestartAttempt,
  recoveryChairResultOf,
  restartFallsBack,
} from "./recoveryChair.js";
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
import { type AttemptDone, clearScratch, closeAll, settleLeftovers, settleRefusedLaunch } from "./recoveryLeftovers.js";
import type { RecoveryPassDeps, RecoverySession } from "./recoveryPassDeps.js";
import { reconfirmLastRestart, restartChair } from "./recoveryRestart.js";

/** One pass as it runs: what it has read and done so far. */
interface PassState {
  readonly deps: RecoveryPassDeps;
  readonly runId: string;
  readonly startedMs: number;
  readonly attempts: RecoveryAttempt[];
  readonly evidence: RecoveryEvidence[];
  /** What the pass read of the supervisor, once it has. */
  chair: RecoveryChairReading | undefined;
  readonly restarts: RecoveryRestartAttempt[];
}

/** What the pass read of the supervisor, or that it stopped before reading it. */
function chairReadingOf({ state }: { state: PassState }): RecoveryChairReading {
  if (state.chair === undefined) {
    return { kind: "unknown", why: "the check stopped before the supervisor was read, so nothing was restarted" };
  }
  return state.chair;
}

/** Whether the chair is down and no chair this pass opened is restarted or still starting. */
function chairWanted({ state }: { state: PassState }): boolean {
  return state.chair?.kind === "down" && state.restarts.every((attempt) => restartFallsBack({ attempt }));
}

/** An instant as ISO 8601. */
function isoOf({ ms }: { ms: number }): string {
  return new Date(ms).toISOString();
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
    const next = await afterAttempt({ candidate, done, state });
    if (next !== "next-plan") {
      return next;
    }
  }
  return undefined;
}

/**
 * After one attempt: stop on a session it could not settle, try the next plan after one that did not pass, and after
 * one that passed, restart the chair on it when the chair is down. Answers `next-plan` when the vendor's next plan may
 * be tried; otherwise why the pass must stop, or nothing.
 */
async function afterAttempt({
  state,
  candidate,
  done,
}: {
  state: PassState;
  candidate: RecoveryCandidate;
  done: AttemptDone;
}): Promise<string | undefined | "next-plan"> {
  if (done.infrastructure !== undefined) {
    return done.infrastructure;
  }
  if (done.attempt.outcome !== "passed") {
    return "next-plan";
  }
  const { chair } = state;
  if (chair?.kind !== "down" || !chairWanted({ state })) {
    return undefined;
  }
  const restart = await restartChair({
    candidate,
    deps: state.deps,
    predecessor: chair.predecessor,
    startedMs: state.startedMs,
  });
  state.restarts.push(restart.attempt);
  if (restart.infrastructure !== undefined) {
    return restart.infrastructure;
  }
  return restartFallsBack({ attempt: restart.attempt }) ? "next-plan" : undefined;
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
  state.chair = await deps.chair.read();
  const stopped = await checkVendors({ state });
  await reconfirmLastRestart({ deps, restarts: state.restarts });
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
  const state: PassState = { attempts: [], chair: undefined, deps, evidence: [], restarts: [], runId, startedMs };
  const infrastructure = await runGuarded({ state });
  return recoveryResultOf({
    attempts: state.attempts,
    chair: recoveryChairResultOf({ reading: chairReadingOf({ state }), restarts: state.restarts }),
    evidence: state.evidence,
    finishedAtIso: isoOf({ ms: deps.nowMs() }),
    infrastructure,
    runId,
    startedAtIso: isoOf({ ms: startedMs }),
  });
}
