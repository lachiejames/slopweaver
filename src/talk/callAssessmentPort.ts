/**
 * The data-class assessment port (`../store/dataClassRules.ts`'s {@link DataClassAssessment}), answered from what the
 * daily visible reader recorded.
 *
 * The register is read ONCE, when the port is built, and a register that cannot be read refuses to build a port at
 * all: an unreadable register is never mistaken for one with nothing in it. So a caller building the port per run —
 * `store classify`, its production caller — fails its whole pass on a torn line rather than writing `unknown` over
 * rows that were assessed.
 *
 * - **A call** is named and nothing about its words. The port reads the call file whole HERE, takes the digest of the
 *   owner's passages as they stand now (`./callAssessmentRead.ts`), and answers only a verdict recorded against exactly
 *   that digest. So a verdict on earlier words never answers for a call the owner has since said more on.
 * - **A stored row** is named by its table, row id, the rule that sent it and the digest of its words, which the caller
 *   read in the same statement as the row's facts (`../store/storedRowAssessmentRead.ts`). The port answers only a
 *   verdict recorded for that row under that rule over that digest: changed words or a changed rule answer `undecided`.
 *
 * Everything not settled answers `undecided`, read as `unknown` and so as `restricted`: a subject nobody assessed,
 * words changed since, and a call held back from the worklist (live, torn, written by a console not the owner's,
 * silent, the test instance's).
 */
import { err, ok, okAsync, type Result } from "#lib/result.js";

import type {
  DataClassAssessment,
  DataClassAssessmentFailedError,
  DataClassAssessmentVerdict,
} from "../store/dataClassRules.js";
import {
  readRecordedAssessments,
  recordedAssessmentFor,
  storedRowAssessmentIndex,
  storedRowAssessmentKey,
} from "../store/recordedDataClassAssessment.js";
import { readCallAssessmentRequest } from "./callAssessmentRead.js";

/** The verdict the port answers for anything not settled. */
const undecided = ({ reason }: { reason: string }) =>
  okAsync<DataClassAssessmentVerdict, DataClassAssessmentFailedError>({ kind: "undecided", reason });

/**
 * The port over the calls and the register under one home, the register read once.
 *
 * @param nowMs the clock a call's liveness is judged by, read on every call answer
 * @returns the assessment port, or why the register could not be read
 */
export function recordedDataClassAssessment({
  home,
  nowMs,
}: {
  home: string;
  nowMs: () => number;
}): Result<DataClassAssessment, DataClassAssessmentFailedError> {
  const held = readRecordedAssessments({ home });
  if (held.isErr()) {
    return err({ code: "DATA_CLASS_ASSESSMENT_FAILED", message: held.error.message });
  }
  const records = held.value;
  const storedRows = storedRowAssessmentIndex({ records });
  const port: DataClassAssessment = ({ request }) => {
    const { subject } = request;
    if (subject.kind === "stored-row") {
      const found = storedRows.get(
        storedRowAssessmentKey({
          requestSha256: subject.requestSha256,
          rowId: subject.rowId,
          ruleId: subject.ruleId,
          table: subject.table,
        }),
      );
      if (found === undefined) {
        return undecided({ reason: "no visible session has assessed this row's current words under this rule" });
      }
      return okAsync<DataClassAssessmentVerdict, DataClassAssessmentFailedError>(found.verdict);
    }
    const current = readCallAssessmentRequest({ callId: subject.callId, home, nowMs: nowMs() });
    if (current.isErr()) {
      return undecided({ reason: current.error.message });
    }
    const found = recordedAssessmentFor({
      callId: subject.callId,
      records,
      requestSha256: current.value.requestSha256,
    });
    if (found === undefined) {
      return undecided({ reason: "no visible session has assessed this call's current words" });
    }
    return okAsync<DataClassAssessmentVerdict, DataClassAssessmentFailedError>(found.verdict);
  };
  return ok(port);
}
