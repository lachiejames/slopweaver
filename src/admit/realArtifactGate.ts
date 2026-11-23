/**
 * The gate that refuses to send an answer standing on a generated artifact where a real one exists, unless
 * it says in one line why the real one could not be had.
 *
 * ## Why a gate and not a reviewer note
 *
 * The reviewer's packet already carries the softer half — a missing screenshot is a `low`-impact note and
 * never a round (`../live/turn/visualEvidenceGuidance.ts`). That ceiling is right for "no picture at all"
 * and wrong here: the measured answer HAD pictures, two of them, and passed both the screenshot deliverable and
 * a full review round. What it lacked was a reason, and the door reads the answer's own bytes, which is
 * where "carries neither a link nor a `substitutedForReal` entry" is a fact rather than a judgement.
 *
 * ## `warn`, like every other gate on this path
 *
 * Block-by-default with a break-glass, and the door records the override. "I have looked at it, this ask is
 * not really about the deployed thing, send it" stays representable, and taking that decision is itself in
 * the audit trail.
 */

import type { AnswerFormAnswer } from "../outbound/assistant/answerForm.js";
import { unaccountedRealArtifacts } from "./realArtifact.js";
import type { DoorFinding, DoorGate } from "./types.js";

/**
 * The override token that waives this gate, recorded by the door whenever it is used.
 *
 * @internal — named here so the value has one home; the docs and tests quote it rather than re-spelling it.
 */
export const REAL_ARTIFACT_OVERRIDE = "answer.real-artifact:v1";

/**
 * Every real-artifact subject this answer neither proves nor accounts for, as door findings.
 *
 * @param answer the composed answer about to be sent
 * @param question the question as asked, tags already stripped
 * @returns every finding that stands; empty when the answer links the real thing or states why it could not
 *
 * @internal — exported so a test can assert the findings without composing a whole door request.
 */
export function realArtifactFindings({
  answer,
  question,
}: {
  answer: AnswerFormAnswer;
  question: string;
}): readonly DoorFinding[] {
  return unaccountedRealArtifacts({ answer, question }).map((subject): DoorFinding => {
    return {
      code: `ANSWER_NO_REAL_ARTIFACT_${subject.id.toUpperCase().replaceAll("-", "_")}`,
      correction: `hand back ${subject.real} — or add one grounding.evidence.substitutedForReal entry naming what you could not produce and WHY`,
      override: REAL_ARTIFACT_OVERRIDE,
      severity: "warn",
      summary: `this answer carries no openable link to the real thing and no stated reason it could not: ${subject.why}`,
    };
  });
}

/**
 * The real-artifact gate, ready to compose into the door's gate list.
 *
 * @param answer the composed answer about to be sent
 * @param question the question as asked, tags already stripped
 * @returns a `DoorGate` that reports every real artifact the answer neither proves nor accounts for
 */
export function realArtifactGate({ answer, question }: { answer: AnswerFormAnswer; question: string }): DoorGate {
  return () => realArtifactFindings({ answer, question });
}
