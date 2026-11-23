/**
 * Whether a renderer crash the call leg caused was handled the way the crash-recovery rule says it is: the shell logged the death and
 * handed the reloaded page its recovery, the dead call was ended on the record with the crash as its reason, and
 * exactly one successor call opened after it — or, for a second crash inside the settle window, none. Pure.
 *
 * Correlated by call id, never by time alone: the desktop log is shared with the owner's own app, so only lines naming the
 * test's own calls are evidence.
 */
import type { E2eDesktopEvent, E2ePlanCallLogEvent } from "./e2eCallEvidence.js";
import type { E2eCallEvidence } from "./e2eCallOutcome.js";
import { type E2eVerdict, failed } from "./e2eOutcome.js";

/** How a crash closes the transcript: `desktop/src/overlayRecovery.ts`'s `rendererGoneWhy`, its opening words. */
export const CRASH_SENTENCE_START = "the voice window's renderer ";

/** The call a crash killed, as the leg captured it before the crash. */
export interface E2eCrashedCall {
  readonly planCallId: string;
  readonly transcriptCallId: string;
  /** How its transcript ended, read back after the recovery; `undefined` when no end was written. */
  readonly ended: { readonly atIso: string; readonly why: string | null } | undefined;
}

/**
 * The shell's death entry for one call.
 *
 * @param events the desktop log's entries since the scenario began
 * @param call the crashed call
 * @returns the entry, or `undefined` when none names it
 */
function goneFor({
  events,
  call,
}: {
  events: readonly E2eDesktopEvent[];
  call: E2eCrashedCall;
}): Extract<E2eDesktopEvent, { kind: "renderer-gone" }> | undefined {
  return events
    .filter((event) => event.kind === "renderer-gone")
    .find(
      (event) => event.call?.transcriptCallId === call.transcriptCallId && event.call.planCallId === call.planCallId,
    );
}

/**
 * The checks every crash shares: the shell logged the death with the reconnect it decided, the reloaded page took
 * the recovery, the transcript was closed with the crash sentence, and the plan call has an end line.
 *
 * @param call the crashed call
 * @param reconnect what the shell should have decided
 * @param evidence what the scenario collected
 * @returns `undefined` when all hold, else the first failure
 */
function crashHandled({
  call,
  reconnect,
  evidence,
}: {
  call: E2eCrashedCall;
  reconnect: boolean;
  evidence: E2eCallEvidence;
}): E2eVerdict | undefined {
  const gone = goneFor({ call, events: evidence.desktopEvents });
  if (gone === undefined) {
    return failed({ detail: `no renderer-gone entry names call ${call.transcriptCallId}`, kind: "evidence-missing" });
  }
  if (gone.reconnect !== reconnect) {
    return failed({
      detail: `the shell decided reconnect=${String(gone.reconnect)} for ${call.transcriptCallId}, not ${String(reconnect)}`,
      kind: "evidence-missing",
    });
  }
  const taken = evidence.desktopEvents.some(
    (event) => event.kind === "recovery-taken" && event.transcriptCallId === call.transcriptCallId,
  );
  if (!taken) {
    return failed({
      detail: `the reloaded page never took the recovery of ${call.transcriptCallId}`,
      kind: "evidence-missing",
    });
  }
  if (call.ended?.why?.startsWith(CRASH_SENTENCE_START) !== true) {
    return failed({
      detail: `transcript ${call.transcriptCallId} was not closed with the crash sentence (ended: ${JSON.stringify(call.ended)})`,
      kind: "transcript-missing",
    });
  }
  const end = evidence.planEvents.find((event) => event.kind === "ended" && event.callId === call.planCallId);
  if (end === undefined) {
    return failed({
      detail: `plan call ${call.planCallId} has no end line in the console log`,
      kind: "evidence-missing",
    });
  }
  return undefined;
}

/**
 * The plan calls that opened after one ended.
 *
 * @param events the plan-call events read
 * @param endedCallId the call whose end they follow
 * @returns their ids, in log order
 */
function openedAfter({
  events,
  endedCallId,
}: {
  events: readonly E2ePlanCallLogEvent[];
  endedCallId: string;
}): readonly string[] {
  const end = events.find((event) => event.kind === "ended" && event.callId === endedCallId);
  if (end === undefined) {
    return [];
  }
  return events
    .filter((event) => event.kind === "opened" && event.lineIndex > end.lineIndex)
    .map((event) => event.callId);
}

/**
 * Judge one crash that should reconnect: handled, then exactly one successor opened after the dead call's end.
 *
 * @param call the crashed call
 * @param evidence what the scenario collected
 * @returns passed, or the first failure
 */
export function judgeCrashEvidence({
  call,
  evidence,
}: {
  call: E2eCrashedCall;
  evidence: E2eCallEvidence;
}): E2eVerdict {
  const handled = crashHandled({ call, evidence, reconnect: true });
  if (handled !== undefined) {
    return handled;
  }
  const successors = openedAfter({ endedCallId: call.planCallId, events: evidence.planEvents });
  if (successors.length === 0) {
    return failed({ detail: `no plan call opened after ${call.planCallId} ended`, kind: "call-not-live" });
  }
  if (successors.length > 1) {
    return failed({
      detail: `${String(successors.length)} plan calls opened after ${call.planCallId} ended: ${successors.join(", ")}`,
      kind: "overlapping-calls",
    });
  }
  return { passed: true };
}

/**
 * Judge a crash while the call was still connecting. Recovery covers a call only once it is live, so the right verdict
 * is that the attempt left nothing behind — every plan call it minted ended, no lease it took is still live —
 * never that it reconnected. The fresh call afterwards is the drive's `live`.
 *
 * @param attemptPlanCallIds the plan calls minted before the crash, possibly none
 * @param leftLeaseIds the leases taken before the crash that are still live after cleanup's wait
 * @param evidence what the scenario collected
 * @returns passed, or the first failure
 */
export function judgeConnectingCrash({
  attemptPlanCallIds,
  leftLeaseIds,
  evidence,
}: {
  attemptPlanCallIds: readonly string[];
  leftLeaseIds: readonly string[];
  evidence: E2eCallEvidence;
}): E2eVerdict {
  const gone = evidence.desktopEvents.some((event) => event.kind === "renderer-gone" && event.call === null);
  if (!gone) {
    return failed({ detail: "no renderer-gone entry with no call up followed the crash", kind: "evidence-missing" });
  }
  const ended = new Set(evidence.planEvents.filter((event) => event.kind === "ended").map((event) => event.callId));
  const orphans = attemptPlanCallIds.filter((id) => !ended.has(id));
  if (orphans.length > 0) {
    return failed({
      detail: `the connecting attempt's plan call(s) never ended: ${orphans.join(", ")}`,
      kind: "evidence-missing",
    });
  }
  if (leftLeaseIds.length > 0) {
    return failed({
      detail: `the connecting attempt left lease(s) live: ${leftLeaseIds.join(", ")}`,
      kind: "overlapping-calls",
    });
  }
  return { passed: true };
}

/**
 * Judge a second crash inside the settle window: both calls handled, the second without a reconnect, and no third
 * plan call opened after the second one's end.
 *
 * @param first the call the first crash killed
 * @param second the successor the second crash killed
 * @param evidence what the scenario collected
 * @returns passed, or the first failure
 */
export function judgeSecondCrash({
  first,
  second,
  evidence,
}: {
  first: E2eCrashedCall;
  second: E2eCrashedCall;
  evidence: E2eCallEvidence;
}): E2eVerdict {
  const firstHandled = crashHandled({ call: first, evidence, reconnect: true });
  if (firstHandled !== undefined) {
    return firstHandled;
  }
  const secondHandled = crashHandled({ call: second, evidence, reconnect: false });
  if (secondHandled !== undefined) {
    return secondHandled;
  }
  const third = openedAfter({ endedCallId: second.planCallId, events: evidence.planEvents });
  if (third.length > 0) {
    return failed({
      detail: `the second crash inside the settle window still opened ${third.join(", ")}`,
      kind: "overlapping-calls",
    });
  }
  return { passed: true };
}
