/**
 * The data-class assessment port (`../store/dataClassRules.ts`'s {@link DataClassAssessment}), answered from what the
 * daily visible reader recorded.
 *
 * The caller names a call and nothing about its words. The port reads the call file whole HERE, takes the digest
 * of the owner's passages as they stand now (`./callAssessmentRead.ts`), and answers only a verdict recorded against
 * exactly that digest (`../store/recordedDataClassAssessment.ts`). So a verdict on earlier words never answers for a
 * call the owner has since said more on, whatever digest a caller once held.
 *
 * Everything not settled answers `undecided`, read as `unknown` and so as `restricted`: a call nobody assessed, words
 * added since, a call held back from the worklist (live, torn, written by a console not the owner's, silent, the test
 * instance's), and every stored row, which no session assesses yet. A register that cannot be read FAILS rather than
 * answering `undecided`, so an unreadable register is never mistaken for one with nothing in it.
 */
import { errAsync, okAsync } from "#lib/result.js";

import type {
  DataClassAssessment,
  DataClassAssessmentFailedError,
  DataClassAssessmentVerdict,
} from "../store/dataClassRules.js";
import { readRecordedAssessments, recordedAssessmentFor } from "../store/recordedDataClassAssessment.js";
import { readCallAssessmentRequest } from "./callAssessmentRead.js";

/** The verdict the port answers for anything not settled. */
const undecided = ({ reason }: { reason: string }) =>
  okAsync<DataClassAssessmentVerdict, DataClassAssessmentFailedError>({ kind: "undecided", reason });

/**
 * The port over the calls and the register under one home.
 *
 * @param nowMs the clock a call's liveness is judged by, read on every answer
 * @returns the assessment port
 * @internal — no production caller yet: carrying a call's class onto the store is the step after this one
 *   (`docs/store/data-classification.md` § "What is not built yet").
 */
export function recordedDataClassAssessment({
  home,
  nowMs,
}: {
  home: string;
  nowMs: () => number;
}): DataClassAssessment {
  return ({ request }) => {
    const { subject } = request;
    if (subject.kind !== "talk-call") {
      return undecided({ reason: "no visible session assesses stored rows yet" });
    }
    const current = readCallAssessmentRequest({ callId: subject.callId, home, nowMs: nowMs() });
    if (current.isErr()) {
      return undecided({ reason: current.error.message });
    }
    const held = readRecordedAssessments({ home });
    if (held.isErr()) {
      return errAsync<DataClassAssessmentVerdict, DataClassAssessmentFailedError>({
        code: "DATA_CLASS_ASSESSMENT_FAILED",
        message: held.error.message,
      });
    }
    const found = recordedAssessmentFor({
      callId: subject.callId,
      records: held.value,
      requestSha256: current.value.requestSha256,
    });
    if (found === undefined) {
      return undecided({ reason: "no visible session has assessed this call's current words" });
    }
    return okAsync<DataClassAssessmentVerdict, DataClassAssessmentFailedError>(found.verdict);
  };
}
