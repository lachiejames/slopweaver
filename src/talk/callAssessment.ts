/**
 * What the daily call reader is asked to classify about one call, and how its answers become the call's class — the
 * pure half. The disk read is `./callAssessmentRead.ts`; the register the verdicts land in is
 * `../store/recordedDataClassAssessment.ts`.
 *
 * ## The unit is one call, and the call carries its highest passage
 *
 * A data class belongs to one stored record (`docs/store/data-classification.md`), and a call file is one record. The
 * owner's scheme classes by passage, so the session classes every passage the owner spoke and the call carries the
 * HIGHEST of them. That maximum is computed HERE, never handed in: a session submits one verdict per passage and
 * this module refuses a missing, duplicate or extra one, so a call can never read lower than the most private thing
 * the owner said on it.
 *
 * ## The owner's words go through unchanged
 *
 * A passage is a folded segment whose speaker is the owner, its text byte for byte as the call file keeps it. Every
 * owner segment counts, a dropped call's unfinished last stretch included: it is still something the owner said, and
 * leaving it out would let a call read classified while one of its passages was never looked at. The voice's own
 * words are not the owner's and are never asked about.
 *
 * ## A digest binds a verdict to the exact words
 *
 * The request digest is a SHA-256 over the call id and each passage's segment id and text, in order. A snapshot time
 * is left out on purpose: the grouper re-stamps a stretch as it grows, and a verdict on unchanged words must not go
 * stale because the clock moved. Words added or changed after a verdict change the digest, so the call is due again.
 *
 * Pure: no filesystem, no clock.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";

import {
  ASSIGNABLE_DATA_CLASSES,
  type AssignedDataClass,
  type DataClassAssessmentVerdict,
} from "../store/dataClassRules.js";
import { type CallRecord, OWNER_SPEAKER } from "./callRecord.js";

/** One passage the owner spoke, exactly as the call file keeps it. */
interface CallAssessmentPassage {
  readonly segmentId: string;
  readonly text: string;
}

/** What the session is asked to classify about one call. */
export interface CallAssessmentRequest {
  readonly callId: string;
  readonly requestSha256: string;
  readonly passages: readonly CallAssessmentPassage[];
}

/**
 * The session's verdict on one passage: a class with its reason, or that it could not decide.
 *
 * @internal — the type a test builds verdicts as; the verb reaches it only through {@link parseVerdictsFile}.
 */
export type PassageAssessmentVerdict =
  | {
      readonly kind: "classified";
      readonly segmentId: string;
      readonly dataClass: AssignedDataClass;
      readonly reason: string;
    }
  | { readonly kind: "undecided"; readonly segmentId: string; readonly reason: string };

/**
 * The classes from the widest reach to the narrowest — the assignable list's own declared order — so the call carries
 * the last one any passage holds.
 */
const CLASS_ORDER: readonly AssignedDataClass[] = ASSIGNABLE_DATA_CLASSES;

/**
 * The most characters one passage verdict's reason may carry.
 *
 * @internal — exported so the test judges the bound's edge.
 */
export const PASSAGE_REASON_MAX_CHARS = 300;

/** A passage's verdict was refused before anything was recorded. */
interface CallAssessmentValidationError {
  readonly code: "CALL_ASSESSMENT_VERDICTS_INVALID";
  readonly message: string;
  readonly callId: string;
  readonly problems: readonly string[];
}

/** The factories this module's refusals are built through. */
const CallAssessmentErrors = {
  verdictsInvalid: ({
    callId,
    problems,
  }: {
    callId: string;
    problems: readonly string[];
  }): CallAssessmentValidationError => ({
    callId,
    code: "CALL_ASSESSMENT_VERDICTS_INVALID",
    message: `call ${callId}'s passage verdicts were refused, so nothing was recorded: ${problems.join("; ")}`,
    problems,
  }),
} as const;

/**
 * The digest of one call's passages: SHA-256 over the call id and each passage's segment id and text, in order.
 *
 * @param passages the owner's passages, in call order
 * @returns the hex digest
 * @internal — exported so a test names the digest a call's words should carry.
 */
export function callAssessmentDigest({
  callId,
  passages,
}: {
  callId: string;
  passages: readonly CallAssessmentPassage[];
}): string {
  const canonical = JSON.stringify({
    callId,
    passages: passages.map((passage) => [passage.segmentId, passage.text]),
    version: 1,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * What the session is asked about one folded call: every segment the owner spoke, in order, verbatim.
 *
 * @param record the call, folded whole
 * @returns the request, or `undefined` when the owner said nothing on it
 */
export function callAssessmentRequest({ record }: { record: CallRecord }): CallAssessmentRequest | undefined {
  const passages = record.segments
    .filter((segment) => segment.who === OWNER_SPEAKER)
    .map((segment): CallAssessmentPassage => ({ segmentId: segment.id, text: segment.text }));
  if (passages.length === 0) {
    return undefined;
  }
  return {
    callId: record.callId,
    passages,
    requestSha256: callAssessmentDigest({ callId: record.callId, passages }),
  };
}

/** The verdicts file `talk assessment-record` reads: one entry per passage. */
const verdictsFileSchema = z
  .object({
    verdicts: z
      .array(
        z
          .object({
            class: z.enum([...ASSIGNABLE_DATA_CLASSES, "undecided"]),
            reason: z.string(),
            segmentId: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/**
 * A verdicts file decoded into passage verdicts: `{"verdicts":[{"segmentId","class","reason"}]}`, where `class` is
 * one of the four assignable classes or `undecided`.
 *
 * @param callId the call the file answers, named in a refusal
 * @param text the file's text
 * @returns the passage verdicts, or every problem with the file
 */
export function parseVerdictsFile({
  callId,
  text,
}: {
  callId: string;
  text: string;
}): Result<readonly PassageAssessmentVerdict[], CallAssessmentValidationError> {
  const json = parseJson({ text });
  if (json.isErr()) {
    return err(
      CallAssessmentErrors.verdictsInvalid({
        callId,
        problems: [`the verdicts file is not JSON (${json.error.message})`],
      }),
    );
  }
  const parsed = verdictsFileSchema.safeParse(json.value);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return err(CallAssessmentErrors.verdictsInvalid({ callId, problems }));
  }
  return ok(
    parsed.data.verdicts.map((entry): PassageAssessmentVerdict => {
      if (entry.class === "undecided") {
        return { kind: "undecided", reason: entry.reason, segmentId: entry.segmentId };
      }
      return { dataClass: entry.class, kind: "classified", reason: entry.reason, segmentId: entry.segmentId };
    }),
  );
}

/**
 * The problems with a set of passage verdicts against the request they answer: each passage answered exactly once,
 * nothing answered that is not a passage, and every reason present and bounded.
 *
 * @param request the request the verdicts answer
 * @param verdicts the session's verdicts
 * @returns every problem found, empty when the set is whole
 */
function verdictProblems({
  request,
  verdicts,
}: {
  request: CallAssessmentRequest;
  verdicts: readonly PassageAssessmentVerdict[];
}): readonly string[] {
  const problems: string[] = [];
  const wanted = new Set(request.passages.map((passage) => passage.segmentId));
  const seen = new Set<string>();
  for (const verdict of verdicts) {
    if (!wanted.has(verdict.segmentId)) {
      problems.push(`segment ${verdict.segmentId} is not one of the owner's passages on this call`);
    }
    if (seen.has(verdict.segmentId)) {
      problems.push(`segment ${verdict.segmentId} is answered more than once`);
    }
    seen.add(verdict.segmentId);
    const reason = verdict.reason.trim();
    if (reason.length === 0) {
      problems.push(`segment ${verdict.segmentId} carries no reason`);
    }
    if (verdict.reason.length > PASSAGE_REASON_MAX_CHARS) {
      problems.push(
        `segment ${verdict.segmentId}'s reason is past ${String(PASSAGE_REASON_MAX_CHARS)} characters; say why in one sentence`,
      );
    }
  }
  for (const passage of request.passages) {
    if (!seen.has(passage.segmentId)) {
      problems.push(`segment ${passage.segmentId} has no verdict`);
    }
  }
  return problems;
}

/**
 * The call's class from one verdict per passage: the highest class any passage holds, or `undecided` when any passage
 * is undecided — a call is never classified on part of what the owner said.
 *
 * @param request the request the verdicts answer
 * @param verdicts the session's verdicts, one per passage
 * @returns the call's verdict, or why the set was refused
 */
export function aggregatePassageVerdicts({
  request,
  verdicts,
}: {
  request: CallAssessmentRequest;
  verdicts: readonly PassageAssessmentVerdict[];
}): Result<DataClassAssessmentVerdict, CallAssessmentValidationError> {
  const problems = verdictProblems({ request, verdicts });
  if (problems.length > 0) {
    return err(CallAssessmentErrors.verdictsInvalid({ callId: request.callId, problems }));
  }
  const undecided = verdicts.filter((verdict) => verdict.kind === "undecided");
  if (undecided.length > 0) {
    return ok({
      kind: "undecided",
      reason: `${String(undecided.length)} of ${String(verdicts.length)} passage(s) undecided, so the call stays unknown`,
    });
  }
  let decided: { readonly rank: number; readonly segmentId: string } | undefined;
  for (const verdict of verdicts) {
    if (verdict.kind !== "classified") {
      continue;
    }
    const rank = CLASS_ORDER.indexOf(verdict.dataClass);
    if (decided === undefined || rank > decided.rank) {
      decided = { rank, segmentId: verdict.segmentId };
    }
  }
  // Every passage holds a classified verdict here and a request has at least one passage, so one was decided.
  const highest = decided!;
  return ok({
    dataClass: CLASS_ORDER[highest.rank]!,
    kind: "classified",
    reason: `the highest class of ${String(verdicts.length)} passage(s), set by segment ${highest.segmentId}`,
  });
}
