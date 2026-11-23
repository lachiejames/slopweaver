/**
 * The no-work-claim check in the pinned chair's `Stop` hook — the second place the predicate runs.
 *
 * A no-work claim ("there is nothing to seat", said over 116 open rows) can be a CHAT
 * reply to the owner's question about the fleet, not a tick, so `supervisor tick close`'s gate
 * (`../supervisor/tickCloseNoWorkClaim.ts`) could not have seen it. This reads the reply the harness hands the
 * hook as `last_assistant_message` and judges it against the newest kept `handover reconcile` reading, with the
 * same predicate (`../../../supervisor/noWorkClaimGate.ts`) and the same `no-work-claim` hatch.
 *
 * Three properties are the design:
 *
 * - **Only the pinned chair.** A seat saying "no work left" about its own doc is telling the truth about its
 *   doc; the chair is the one voice that speaks for the board. Matched exactly on the pin's session id.
 * - **Silent on every failure.** No pin, no message, no reading, a reading that will not decode: nothing is
 *   printed. Only a REFUSED verdict blocks — a Stop gate that blocks on its own read failures is the worst
 *   object in the hook's design (`./hookRun.ts`).
 * - **The newest reading, at any age.** No age limit is invented; a stale reading that refuses is cleared by
 *   running `handover reconcile` again, which records a fresh one.
 */
import { lastReading } from "../../../readings/store.js";
import { isRegisteredSupervisor } from "../../../sessions/supervisorPin.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { judgeNoWorkClaim } from "../../../supervisor/noWorkClaimGate.js";
import { noWorkClaimHatchOpen, noWorkClaimRefusalLines } from "../supervisor/tickCloseNoWorkClaim.js";

/** The producer slug `supervisor tick open` records the reconciliation under. */
const RECONCILE_PRODUCER = "handover reconcile";

/** What the check reads, as plain seams so a test passes fakes and every failure path is reachable. */
export interface NoWorkClaimStopSeams {
  /** Whether this session id is the one holding the supervisor pin. */
  readonly isPinnedChair: (args: { sessionId: string }) => boolean;
  /** The newest kept reconciliation document, or `undefined` when none reads. */
  readonly lastReconciliation: () => unknown;
  /** Whether the `no-work-claim` hatch is open. */
  readonly hatchIsOpen: () => boolean;
}

/**
 * The block lines for one Stop, or none.
 *
 * @param sessionId the hooked session, from the payload
 * @param lastMessage the payload's `last_assistant_message`
 * @param seams the pin, the reading and the hatch
 * @returns the refusal lines when the pinned chair's reply claims no work over open rows, else empty
 */
export function noWorkClaimStopLines({
  sessionId,
  lastMessage,
  seams,
}: {
  sessionId: string | undefined;
  lastMessage: unknown;
  seams: NoWorkClaimStopSeams;
}): readonly string[] {
  if (sessionId === undefined || typeof lastMessage !== "string" || lastMessage.length === 0) {
    return [];
  }
  if (!seams.isPinnedChair({ sessionId })) {
    return [];
  }
  const reconciliation = seams.lastReconciliation();
  if (reconciliation === undefined) {
    return [];
  }
  const verdict = judgeNoWorkClaim({
    reconciliation,
    texts: [{ label: "your last reply", text: lastMessage }],
  });
  if (verdict.kind !== "refused" || seams.hatchIsOpen()) {
    return [];
  }
  return noWorkClaimRefusalLines({ subject: "your last reply", verdict });
}

/**
 * The payload's `last_assistant_message`, or `undefined` when it carries none.
 *
 * @returns the field's value, unchecked — {@link noWorkClaimStopLines} judges its type
 */
export function lastAssistantMessageOf({ payload }: { payload: unknown }): unknown {
  if (typeof payload !== "object" || payload === null || !("last_assistant_message" in payload)) {
    return undefined;
  }
  return payload.last_assistant_message;
}

/**
 * The production seams: the pin file, the readings ledger and the ambient hatch, each failing to "nothing".
 *
 * @param home the state home both files live under
 * @returns the seams
 */
export function productionNoWorkClaimStopSeams({ home }: { home: string }): NoWorkClaimStopSeams {
  return {
    hatchIsOpen: noWorkClaimHatchOpen,
    isPinnedChair: ({ sessionId }) =>
      isRegisteredSupervisor({
        record: readSupervisorPin({ home }),
        session: { host: "claude-code", id: sessionId },
      }),
    lastReconciliation: () => {
      const reading = lastReading({ home, producer: RECONCILE_PRODUCER });
      if (reading.isErr()) {
        return undefined;
      }
      return reading.value.document;
    },
  };
}
