/**
 * The register of the verdicts the owner's daily visible session recorded about calls — what the data-class
 * assessment port answers from (`../talk/callAssessmentPort.ts`, which reads the call's current words itself).
 *
 * The owner ruled who classifies what the owner says on calls: ONE daily visible reader, on the plans already
 * owned, with no new spend. So nothing here calls a model. The session reads a call's exact words, decides one class
 * per passage, and records them through `talk assessment-record`; this module writes that down. A call nobody has
 * assessed answers `undecided` at the port, which every reader treats as `unknown` and so as `restricted`
 * (`./dataClass.ts`).
 *
 * ## One line per assessed call, bound to the words it read
 *
 * `$SLOPWEAVER_HOME/judgement/data-class-assessments.jsonl`, `0600`. Each line names the call, the digest of the exact
 * passages assessed (`../talk/callAssessment.ts`), one verdict per passage and the call's verdict derived from them.
 * It holds NO passage text: the call file stays the one copy of the owner's words, so nothing here can drift from
 * or reword them. A verdict answers only the digest it was recorded against, so words added to a call after it was
 * assessed make that call due again rather than borrowing the earlier class.
 *
 * ## Exactly one truth per digest
 *
 * Recording the same verdicts for the same digest again writes nothing and answers the line already there. Recording
 * DIFFERENT verdicts for a digest that already has some is refused: two answers about the same words would make the
 * class depend on which line a reader met first. A line that will not parse refuses every read rather than being
 * skipped, because the line skipped could be the one that answers. The check-then-append is not locked: the one
 * writer is the seated session, and the automation's slot ledger seats one at a time.
 */
import { chmodSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import { appendLines } from "#lib/appendSeparator.js";
import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";
import { ensureDirectory } from "#lib/writeAtomic.js";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";

import { ASSIGNABLE_DATA_CLASSES } from "./dataClassRules.js";

/** One passage's verdict as the register holds it. */
const passageVerdictSchema = z.discriminatedUnion("kind", [
  z
    .object({
      dataClass: z.enum(ASSIGNABLE_DATA_CLASSES),
      kind: z.literal("classified"),
      reason: z.string().min(1),
      segmentId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("undecided"), reason: z.string().min(1), segmentId: z.string().min(1) }).strict(),
]);

/** The call's verdict as the register holds it. */
const callVerdictSchema = z.discriminatedUnion("kind", [
  z
    .object({ dataClass: z.enum(ASSIGNABLE_DATA_CLASSES), kind: z.literal("classified"), reason: z.string().min(1) })
    .strict(),
  z.object({ kind: z.literal("undecided"), reason: z.string().min(1) }).strict(),
]);

/** One line of the register, version 1. */
const recordedAssessmentSchema = z
  .object({
    callId: z.string().min(1),
    passageVerdicts: z.array(passageVerdictSchema).min(1),
    recordedAtIso: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "not an ISO instant" }),
    requestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    verdict: callVerdictSchema,
    version: z.literal(1),
  })
  .strict();

/** One assessed call, as the register holds it. */
export type RecordedCallAssessment = z.infer<typeof recordedAssessmentSchema>;

/** The register could not be read, or a line of it is not a recorded assessment. */
interface AssessmentRegisterUnreadableError {
  readonly code: "ASSESSMENT_REGISTER_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Different verdicts were offered for words that already have some. */
interface AssessmentConflictError {
  readonly code: "ASSESSMENT_CONFLICT";
  readonly message: string;
  readonly callId: string;
  readonly requestSha256: string;
}

/** The register could not be written. */
interface AssessmentRegisterUnwritableError {
  readonly code: "ASSESSMENT_REGISTER_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** Why recording or reading an assessment failed. */
export type RecordedAssessmentError =
  AssessmentRegisterUnreadableError | AssessmentConflictError | AssessmentRegisterUnwritableError;

/**
 * The factories every failure here is built through.
 *
 * @internal — exported so a test builds the same failures the register does.
 */
export const RecordedAssessmentErrors = {
  conflict: ({ callId, requestSha256 }: { callId: string; requestSha256: string }): AssessmentConflictError => ({
    callId,
    code: "ASSESSMENT_CONFLICT",
    message:
      `call ${callId} already has different verdicts recorded for these exact words (${requestSha256.slice(0, 12)}), ` +
      "so nothing was written: one answer per set of words",
    requestSha256,
  }),
  unreadable: ({ path, detail }: { path: string; detail: string }): AssessmentRegisterUnreadableError => ({
    code: "ASSESSMENT_REGISTER_UNREADABLE",
    message: `the assessment register at ${path} could not be read (${detail}), so no call reads as assessed`,
    path,
  }),
  unwritable: ({ path, detail }: { path: string; detail: string }): AssessmentRegisterUnwritableError => ({
    code: "ASSESSMENT_REGISTER_UNWRITABLE",
    message: `the assessment register at ${path} could not be written (${detail})`,
    path,
  }),
} as const;

/**
 * The register's path under a state home.
 *
 * @returns `$home/judgement/data-class-assessments.jsonl`
 * @internal — exported so a test finds the file it reads back.
 */
export function assessmentRegisterPath({ home }: { home: string }): string {
  return stateHomePaths({ home }).judgement.dataClassAssessmentsJsonl;
}

/**
 * Every assessment the register holds, in file order. An absent register is none; a line that will not parse refuses
 * the whole read.
 *
 * @returns the recorded assessments, or why the register could not be read
 */
export function readRecordedAssessments({
  home,
}: {
  home: string;
}): Result<readonly RecordedCallAssessment[], AssessmentRegisterUnreadableError> {
  const path = assessmentRegisterPath({ home });
  if (!existsSync(path)) {
    return ok([]);
  }
  const records: RecordedCallAssessment[] = [];
  const problems: string[] = [];
  try {
    readJsonlLines({
      noFollow: true,
      onLine: ({ line, index }) => {
        if (line.trim() === "") {
          return;
        }
        const parsed = parseRecordLine({ line });
        if (parsed === undefined) {
          problems.push(`line ${String(index + 1)} is not a recorded assessment`);
          return;
        }
        records.push(parsed);
      },
      path,
    });
  } catch (cause) {
    return err(RecordedAssessmentErrors.unreadable({ detail: String(cause), path }));
  }
  if (problems.length > 0) {
    return err(RecordedAssessmentErrors.unreadable({ detail: problems.join("; "), path }));
  }
  return ok(records);
}

/**
 * One register line decoded, or `undefined` when it is not a recorded assessment.
 *
 * @returns the record, or `undefined`
 */
function parseRecordLine({ line }: { line: string }): RecordedCallAssessment | undefined {
  const value = parseJson({ text: line });
  if (value.isErr()) {
    return undefined;
  }
  const parsed = recordedAssessmentSchema.safeParse(value.value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The assessment recorded for exactly these words of a call, if any.
 *
 * @param records the register's assessments
 * @param requestSha256 the digest of the call's current passages
 * @returns the recorded assessment, or `undefined` when these words have none
 */
export function recordedAssessmentFor({
  records,
  callId,
  requestSha256,
}: {
  records: readonly RecordedCallAssessment[];
  callId: string;
  requestSha256: string;
}): RecordedCallAssessment | undefined {
  return records.find((record) => record.callId === callId && record.requestSha256 === requestSha256);
}

/** Two recorded assessments say the same thing about the same words: same verdicts, in the same order. */
function sameVerdicts({ held, next }: { held: RecordedCallAssessment; next: RecordedCallAssessment }): boolean {
  return JSON.stringify([held.passageVerdicts, held.verdict]) === JSON.stringify([next.passageVerdicts, next.verdict]);
}

/**
 * Record one call's assessment: append it, answer the identical line already there, or refuse different verdicts
 * for words that already have some.
 *
 * @param assessment the assessment to record, its call verdict already derived from its passage verdicts
 * @returns the line the register now holds for these words, and whether this call wrote it
 */
export function recordCallAssessment({
  home,
  assessment,
}: {
  home: string;
  assessment: RecordedCallAssessment;
}): Result<{ readonly record: RecordedCallAssessment; readonly written: boolean }, RecordedAssessmentError> {
  const held = readRecordedAssessments({ home });
  if (held.isErr()) {
    return err(held.error);
  }
  const existing = recordedAssessmentFor({
    callId: assessment.callId,
    records: held.value,
    requestSha256: assessment.requestSha256,
  });
  if (existing !== undefined) {
    if (sameVerdicts({ held: existing, next: assessment })) {
      return ok({ record: existing, written: false });
    }
    return err(
      RecordedAssessmentErrors.conflict({ callId: assessment.callId, requestSha256: assessment.requestSha256 }),
    );
  }
  const path = assessmentRegisterPath({ home });
  try {
    ensureDirectory({ directory: dirname(path) });
    appendLines({ durable: true, mode: 0o600, path, text: JSON.stringify(assessment) });
    chmodSync(path, 0o600);
  } catch (cause) {
    return err(RecordedAssessmentErrors.unwritable({ detail: String(cause), path }));
  }
  return ok({ record: assessment, written: true });
}
