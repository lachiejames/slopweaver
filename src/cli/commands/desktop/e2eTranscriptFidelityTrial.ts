/**
 * One `transcription-fidelity` call's trial, built once its session has proven every call ended: the one call file
 * read and folded, joined with what the page recorded about its microphone and what the microphone played. The
 * scoring and every validity rule are pure (`../../../desktop/e2eTranscriptFidelityReport.ts`); this only reads.
 */
import type { E2eVerdict } from "../../../desktop/e2eOutcome.js";
import {
  type E2eTranscriptFidelityTrial,
  transcriptFidelityTrial,
} from "../../../desktop/e2eTranscriptFidelityReport.js";
import { type CallRecord, foldCall } from "../../../talk/callRecord.js";
import { readCallEntriesCounted } from "../../../talk/callStore.js";
import type { CallSession } from "./e2eCallSession.js";

/**
 * The one call file, folded, or why it cannot be.
 *
 * @param home the state home holding the talk store
 * @param callIds every transcript the session opened
 * @returns the record, or the reason as text
 */
export function fidelityRecordOf({ callIds, home }: { callIds: readonly string[]; home: string }): CallRecord | string {
  if (callIds.length !== 1) {
    return `expected one call file, the session opened ${String(callIds.length)}`;
  }
  const callId = callIds[0]!;
  const read = readCallEntriesCounted({ callId, home });
  if (read.isErr()) {
    return read.error.message;
  }
  const record = foldCall({ callId, entries: read.value.entries, skipped: read.value.skipped });
  if (record === undefined) {
    return `call file ${callId} holds no call`;
  }
  return record;
}

/**
 * The trial of a session that ran a `transcription-fidelity` call.
 *
 * @param session the closed session
 * @param transcriptCallIds every transcript call id the session's evidence names
 * @param verdict the scenario's own judgement, so a call that dropped mid-script is never scored
 * @returns the trial, `undefined` for any other scenario
 */
export function fidelityTrialOf({
  session,
  transcriptCallIds,
  verdict,
}: {
  session: CallSession;
  transcriptCallIds: readonly string[];
  verdict: E2eVerdict;
}): E2eTranscriptFidelityTrial | undefined {
  const spec = session.spec.step.fidelity;
  if (spec === undefined) {
    return undefined;
  }
  return transcriptFidelityTrial({
    evidence: {
      applied: session.micCaptures.map((capture) => capture.applied),
      hold: session.fidelityHolds.length === 1 ? session.fidelityHolds[0]! : null,
      callIds: transcriptCallIds,
      record: fidelityRecordOf({ callIds: transcriptCallIds, home: session.spec.home }),
      spec,
      // The preflight writes the fidelity microphone for every step carrying a schedule entry, or the session never opens.
      wavSha256: session.fidelityMicrophone!.sha256,
      verdict,
    },
  });
}
