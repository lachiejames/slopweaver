/**
 * The evidence one call scenario of `slopweaver desktop e2e --call` collected, read once its session is cleaned up:
 * the logs, the call store's witnesses and the voice's openings. Each read that fails leaves its field empty, and the
 * FIRST failure, in a fixed order, is what `unread` names, so the scenario is judged blocked rather than judged on a
 * silent hole. The drive that calls this is `./e2eCallDriver.ts`.
 */
import { ok, type Result } from "#lib/result.js";
import type { E2eCallError } from "../../../desktop/e2eCallErrors.js";
import { type E2eCallEvidence, NO_CALL_EVIDENCE } from "../../../desktop/e2eCallOutcome.js";
import { callRequirementsOf } from "../../../desktop/e2eCallRequirements.js";
import type { E2eCallOpening } from "../../../desktop/e2eGreetingJudge.js";
import { cardFidelityFromCalls } from "./e2eCallCardFidelityRead.js";
import { cardNextOf } from "./e2eCallCardNextScenario.js";
import { readingHoldOf } from "./e2eCallCardReadingHoldScenario.js";
import { cardReadWitnessOf } from "./e2eCallCardReadScenario.js";
import { callOpenings, ownTranscriptCallIds, queueSearchToolCallIds } from "./e2eCallEvidenceRead.js";
import { transcriptIdsIn } from "./e2eCallPreflight.js";
import { reopenWitnessFor } from "./e2eCallReopenScenario.js";
import type { ScenarioOutcome } from "./e2eCallScenarios.js";
import { type CallSession, readCallLogs } from "./e2eCallSession.js";

/**
 * Why the evidence could not all be read: the first failed read's message, in the order given.
 *
 * @param reads every read, in the order a failure is reported
 * @returns the first failure's message, `undefined` when every read succeeded
 */
export function firstUnread({
  reads,
}: {
  reads: readonly Result<unknown, { readonly message: string }>[];
}): string | undefined {
  for (const read of reads) {
    if (read.isErr()) {
      return read.error.message;
    }
  }
  return undefined;
}

/**
 * The openings of this run's own transcript calls — read only where the microphone said a bare greeting
 * (`callRequirementsOf`'s `greeting`), over every transcript this run wrote, the store's own included, never only the
 * requests Playwright saw.
 *
 * @param session the session, cleaned up
 * @returns each call's opening, empty for a scenario whose opening is not judged
 */
function openingsOf({ session }: { session: CallSession }): Result<readonly E2eCallOpening[], E2eCallError> {
  if (!callRequirementsOf({ id: session.spec.step.id }).greeting) {
    return ok([]);
  }
  return transcriptIdsIn({ home: session.spec.home }).andThen((now) =>
    callOpenings({
      callIds: ownTranscriptCallIds({
        before: session.transcriptsBefore,
        now,
        seen: [...session.seenTranscriptIds],
        tracked: session.tracker.transcriptCallIds,
      }),
      home: session.spec.home,
    }),
  );
}

/**
 * The evidence a session collected.
 *
 * @param session the session, cleaned up
 * @param outcome what its drive saw
 * @param nonce the run's token
 * @returns the evidence, and why the logs could not be read when they could not
 */
export function evidenceOf({
  session,
  outcome,
  nonce,
}: {
  session: CallSession;
  outcome: ScenarioOutcome;
  nonce: string;
}): {
  readonly evidence: E2eCallEvidence;
  readonly unread: string | undefined;
} {
  const logs = readCallLogs({ session });
  const { tracker } = session;
  // Read only for the scenario that asks, and only this instance's own transcript calls.
  const searched =
    session.spec.step.id === "queue-search"
      ? queueSearchToolCallIds({ callIds: tracker.transcriptCallIds, home: session.spec.home })
      : ok<readonly string[], E2eCallError>([]);
  const opened = openingsOf({ session });
  const witnessed = cardReadWitnessOf({ nonce, session });
  const holding = readingHoldOf({ session });
  const reopened = reopenWitnessFor({ session });
  const leaving = cardNextOf({ session });
  const judged = cardFidelityFromCalls({
    callIds: tracker.transcriptCallIds,
    home: session.spec.home,
    nonce,
    step: session.spec.step,
  });
  const evidence: E2eCallEvidence = {
    cardFidelity: judged.unwrapOr([]),
    cardNext: leaving.unwrapOr(NO_CALL_EVIDENCE.cardNext),
    cardReadWitnessCallIds: witnessed.unwrapOr([]),
    desktopEvents: logs.map((read) => read.desktopEvents).unwrapOr([]),
    heapSamples: session.heapSamples,
    heapVerdict: outcome.heapVerdict,
    leaseIds: session.leaseIds,
    openings: opened.unwrapOr([]),
    pageErrors: tracker.pageErrors,
    planCallIds: tracker.planCallIds,
    planEvents: logs.map((read) => read.planEvents).unwrapOr([]),
    queueSearchToolCallIds: searched.unwrapOr([]),
    readingHold: holding.unwrapOr(NO_CALL_EVIDENCE.readingHold),
    reopen: reopened.unwrapOr(undefined),
    transcriptCallIds: tracker.transcriptCallIds,
  };
  return {
    evidence,
    unread: firstUnread({ reads: [logs, searched, opened, witnessed, holding, reopened, leaving, judged] }),
  };
}
