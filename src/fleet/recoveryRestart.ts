/**
 * One chair restart inside a Recovery pass: seat a supervisor on the plan that just passed the check, then watch the
 * pin until it names the new chair, the chair ends, or the pass runs out of time.
 *
 * **A chair that is still running is never left beside another.** A refused spawn, or a chair that ended before it
 * took the pin, leaves nothing running, so the next plan may be tried; a chair still running at the deadline is
 * `starting`, and nothing else is opened beside it. A doc whose chair never took the pin has its board row closed,
 * so nothing reads it as a supervisor waiting to be seated; one that took the pin and then ended is `lost`, its row
 * left as a supervisor's own and nothing opened after it.
 */
import type { AppSessionSnapshot } from "../sessionHarness/appProtocol.js";
import {
  appSessionEnded,
  judgeRecoveryChair,
  type RecoveryChairLook,
  type RecoveryRestartAttempt,
  reconfirmedRestart,
} from "./recoveryChair.js";
import { boundedReason, RECOVERY_PASS_MS, type RecoveryCandidate } from "./recoveryCheck.js";
import type { RecoveryChairOpenFailure, RecoveryPassDeps } from "./recoveryPassDeps.js";
import type { RecoveryPredecessor } from "./recoverySuccessor.js";

/** What a chair restart may take: the app's own launch bound, then at least two minutes for it to take the pin. */
const RECOVERY_RESTART_MS = 180_000 + 120_000;

/** One restart, and why the pass must stop after it when what it opened could not be settled. */
export interface RestartDone {
  readonly attempt: RecoveryRestartAttempt;
  readonly infrastructure?: string;
}

/**
 * Watch the new chair until a look settles it. Each look reads the pin, THEN lists the app, so a pin naming the chair
 * beside a running snapshot held at the list. A list the app did not answer is one look missed.
 */
async function awaitPin({
  deps,
  sessionId,
  deadlineMs,
}: {
  deps: RecoveryPassDeps;
  sessionId: string;
  deadlineMs: number;
}): Promise<Exclude<RecoveryChairLook, { kind: "waiting" }>> {
  for (;;) {
    const deadlinePassed = deps.nowMs() >= deadlineMs;
    const pin = deps.chair.pin();
    const listed = await deps.host.list();
    if (listed.isOk()) {
      const snapshot: AppSessionSnapshot | undefined = listed.value.find((one) => one.sessionId === sessionId);
      const look = judgeRecoveryChair({ deadlinePassed, pin, sessionId, snapshot });
      if (look.kind !== "waiting") {
        return look;
      }
    } else if (deadlinePassed) {
      return {
        kind: "starting",
        reason: boundedReason({ text: `the app could not be asked about the new chair: ${listed.error}` }),
      };
    }
    await deps.pause();
  }
}

/** The attempt for a chair that ended or never opened, its doc's board row closed so nothing seats it later. */
function retired({
  deps,
  base,
  slug,
  sessionId,
  outcome,
  reason,
}: {
  deps: RecoveryPassDeps;
  base: Pick<RecoveryRestartAttempt, "alias" | "vendor">;
  slug: string | undefined;
  sessionId: string | undefined;
  outcome: "ended" | "spawn-refused";
  reason: string;
}): RestartDone {
  const attempt: RecoveryRestartAttempt = {
    ...base,
    outcome,
    reason: boundedReason({ text: reason }),
    ...(slug === undefined ? {} : { slug }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
  if (slug === undefined) {
    return { attempt };
  }
  const closed = deps.chair.retire({ slug, why: attempt.reason });
  if (closed.isErr()) {
    return { attempt, infrastructure: `${slug}'s board row could not be closed: ${closed.error}` };
  }
  return { attempt };
}

/**
 * What a spawn that reported no chair left behind. The ledger row the spawn reads its chair from is written
 * best-effort, so a chair can be running with no row: the app is asked for a running session under the doc's slug
 * before the spawn counts as refused, and when the app cannot be asked, nothing more is opened.
 */
async function seatOfRefusedSpawn({
  deps,
  base,
  failure,
}: {
  deps: RecoveryPassDeps;
  base: Pick<RecoveryRestartAttempt, "alias" | "vendor">;
  failure: RecoveryChairOpenFailure;
}): Promise<
  { readonly done: RestartDone } | { readonly seated: { readonly slug: string; readonly sessionId: string } }
> {
  const { reason, slug } = failure;
  const refused = { base, deps, outcome: "spawn-refused", reason, sessionId: undefined, slug } as const;
  if (slug === undefined) {
    return { done: retired(refused) };
  }
  const listed = await deps.host.list();
  if (listed.isErr()) {
    const text = `the spawn reported no chair (${reason}), and the app could not be asked whether one opened (${listed.error}), so nothing more was opened`;
    return { done: { attempt: { ...base, outcome: "starting", reason: boundedReason({ text }), slug } } };
  }
  const running = listed.value.findLast((one) => one.ledgerKey === slug && !appSessionEnded({ state: one.state }));
  if (running === undefined) {
    return { done: retired(refused) };
  }
  return { seated: { sessionId: running.sessionId, slug } };
}

/**
 * Look once more at the pass's last restart as the pass ends, in place: a chair that took the pin and has since
 * ended, or lost the pin, is `lost` rather than `restarted`. A list the app does not answer makes it `starting`, so
 * a chair that could not be re-checked is never reported as restarted.
 *
 * @param deps everything the pass does to the world
 * @param restarts every restart the pass made, the last replaced when it no longer holds the seat
 */
export async function reconfirmLastRestart({
  deps,
  restarts,
}: {
  deps: RecoveryPassDeps;
  restarts: RecoveryRestartAttempt[];
}): Promise<void> {
  const last = restarts.at(-1);
  if (last?.outcome !== "restarted") {
    return;
  }
  const pin = deps.chair.pin();
  const listed = await deps.host.list();
  if (listed.isErr()) {
    const text = `it took the supervisor pin, but the app could not be asked again as the check ended: ${listed.error}`;
    restarts[restarts.length - 1] = { ...last, outcome: "starting", reason: boundedReason({ text }) };
    return;
  }
  const snapshot = listed.value.find((one) => one.sessionId === last.sessionId);
  restarts[restarts.length - 1] = reconfirmedRestart({ attempt: last, pin, snapshot });
}

/**
 * Seat a supervisor on one plan and judge whether it took the pin.
 *
 * @param deps everything the pass does to the world
 * @param candidate the plan that just passed the check
 * @param predecessor the chair it replaces, when one was pinned
 * @param startedMs when the pass began, which bounds the wait
 * @returns the attempt, and why the pass must stop after it when it must
 */
export async function restartChair({
  deps,
  candidate,
  predecessor,
  startedMs,
}: {
  deps: RecoveryPassDeps;
  candidate: RecoveryCandidate;
  predecessor: RecoveryPredecessor | undefined;
  startedMs: number;
}): Promise<RestartDone> {
  const base = { alias: candidate.alias, vendor: candidate.vendor };
  const deadlineMs = startedMs + RECOVERY_PASS_MS;
  if (deadlineMs - deps.nowMs() < RECOVERY_RESTART_MS) {
    return {
      attempt: { ...base, outcome: "deadline", reason: "not tried: too little time was left for a chair to start" },
    };
  }
  const opened = await deps.chair.open({ candidate, predecessor });
  let seated: { readonly slug: string; readonly sessionId: string };
  if (opened.isOk()) {
    seated = opened.value;
  } else {
    const found = await seatOfRefusedSpawn({ base, deps, failure: opened.error });
    if ("done" in found) {
      return found.done;
    }
    seated = found.seated;
  }
  const { sessionId, slug } = seated;
  const look = await awaitPin({ deadlineMs, deps, sessionId });
  if (look.kind === "ended") {
    return retired({ base, deps, outcome: "ended", reason: look.reason, sessionId, slug });
  }
  if (look.kind === "starting" || look.kind === "lost") {
    // A lost chair's run is a supervisor's own, so its row is left to it and nothing is opened after it.
    return { attempt: { ...base, outcome: look.kind, reason: look.reason, sessionId, slug } };
  }
  return { attempt: { ...base, outcome: "restarted", reason: "it took the supervisor pin", sessionId, slug } };
}
