/**
 * `slopweaver turn resume --dispatch <id> --answer <file>` — the compose-time checks a worker's answer file
 * passes before the READY marker is written.
 *
 * Split out of `./resume.ts`, which owns the three modes and the marker. Every refusal here is "not yet",
 * never "not at all": it is decidable from the answer's own bytes, the decision and the review on disk, it
 * writes no durable marker, and the SAME session can fix the SAME file and re-run the same command.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { answerEditGate, answerEditRefusalLines } from "../../../live/turn/answerFreeze.js";
import { answerableProjectionOf, validateAnswerForDispatch } from "../../../live/turn/briefAnswerable.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import type { FreshDispatchRecord } from "../../../live/turn/dispatch.js";
import { readReviewRecord, readVerdictFile } from "../../../live/turn/reviewStore.js";
import { appendTurnJournalRow } from "../../../live/turn/turnJournalStore.js";
import { type AnswerFormAnswer, parseAnswerArm } from "../../../outbound/assistant/answerForm.js";
import { botAnswerBareRefContext } from "../../bareRefContext.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { readOrReport, refuse } from "./core.js";
import { type TurnCommandError, TurnCommandErrors } from "./errors.js";

/** Parse the answer file's text as JSON, turning a parse failure into a stated reason rather than a throw. */
function parseAnswerJson({ answerText }: { answerText: string }): Result<unknown, TurnCommandError> {
  try {
    return ok(JSON.parse(answerText));
  } catch (error) {
    return err(TurnCommandErrors.documentNotJson({ cause: error, what: "answer" }));
  }
}

/**
 * FINISH's non-terminal refusal path, once a current-generation record exists: a compose-time validate
 * refusal — malformed answer JSON, an answer over a count/aggregate cap, a grounding mismatch — is
 * decidable from this answer's own bytes (and, for grounding, the decision) alone, so it is "not yet",
 * never "not at all". It writes NO durable marker and prints none, so the sweep keeps reading this ask as
 * still-working and the SAME session can fix the SAME answer file and re-run this exact command. This is
 * the loop's other half of the worker contract: only the worker's OWN `--failed` report (`runFailed`, in
 * `./resume.ts`) is terminal.
 *
 * @param answerPath the answer file the worker wrote
 * @param dispatchId the dispatch this session was resumed for
 * @param home the resolved state home
 * @param reason why the answer is not yet sound
 * @returns the exit code the refusal earned
 */
export function refuseComposeTime({
  answerPath,
  dispatchId,
  home,
  reason,
}: {
  answerPath: string;
  dispatchId: string;
  home: string;
  reason: string;
}): number {
  return refuse({
    code: EXIT_ERROR,
    errors: [
      reason,
      `fix answer.json and re-run: slopweaver turn resume --dispatch ${dispatchId} --answer ` +
        `${answerPath} --home ${home} — this is not a terminal failure`,
    ],
  });
}

/**
 * The answer-freeze step: an answer already sent for review may not be replaced silently.
 *
 * Runs AFTER validation, deliberately — a malformed or over-cap answer is refused on its own bytes without
 * ever consulting the review, so an author fixing a validate refusal is never also told it needs a reason.
 * See `../../../live/turn/answerFreeze.ts` for the measured loss and for why this is not "a clean verdict is
 * terminal".
 *
 * A permitted edit is JOURNALLED rather than merely allowed: the reason an answer moved after a reviewer had
 * read it is the one fact nothing else on disk keeps, and the terminal it was typed into is gone by the time
 * anybody asks.
 *
 * @param answerDigest the digest of the bytes just validated
 * @param askIdentity the ask being answered
 * @param editReason the author's stated reason, when `--edit-reason` carried one
 * @param home the resolved state home
 * @param leaseExpiresAt the dispatch's effective lease — the clock that decides once no review holds it
 * @param postedDigest the digest of the first answer this dispatch already posted, whose verdict was spent
 * @returns the refusal lines when this edit needs a reason and has none, or `undefined` when it may proceed
 */
export function answerFreezeRefusal({
  answerDigest,
  askIdentity,
  editReason,
  home,
  leaseExpiresAt,
  postedDigest,
}: {
  answerDigest: string;
  askIdentity: AskIdentity;
  editReason: string | undefined;
  home: string;
  leaseExpiresAt: string;
  postedDigest: string | undefined;
}): readonly string[] | undefined {
  const record = readReviewRecord({ askIdentity, home });
  const gate = answerEditGate({
    answerDigest,
    postedDigest,
    record,
    verdictRead: record === undefined ? undefined : readVerdictFile({ record }),
  });
  if (gate.kind === "free") {
    return undefined;
  }
  const trimmed = editReason === undefined ? undefined : editReason.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return answerEditRefusalLines({ editReasonFlag: "--edit-reason", gate, leaseExpiresAt });
  }
  appendTurnJournalRow({
    askIdentity,
    home,
    row: {
      atIso: new Date().toISOString(),
      discardedSendableVerdict: gate.why === "discards-a-sendable-verdict",
      // `needs-reason` is unreachable without a record — `answerEditGate` answers `free` when there is
      // none — so this assertion states a fact the gate already established rather than hiding a default.
      fromDigest: record!.answerDigest,
      kind: "answer-edited",
      reason: trimmed,
      toDigest: answerDigest,
    },
  });
  return undefined;
}

/**
 * Read the answer file, parse it, and check it against this dispatch's brief and decision — every step whose
 * failure is a compose-time "not yet" rather than a terminal one.
 *
 * One function because every one of these refusals is the same refusal to the caller: fixable, by the SAME
 * session, in the SAME file, with no durable marker written. Splitting them out of `runFinish` keeps
 * that one outcome in one place instead of five identical early returns.
 *
 * @param answerPath the answer file the worker wrote
 * @param decision the dispatch's own routing decision
 * @param home the resolved state home
 * @param path the brief file to check against
 * @returns the parsed answer, its exact bytes and the brief's question (which the pre-review checklist names
 *   its artifacts from), or every reason it is not yet sound
 */
export function validatedAnswer({
  answerPath,
  decision,
  home,
  path,
}: {
  answerPath: string;
  decision: FreshDispatchRecord["decision"];
  home: string;
  path: string;
}): Result<
  { readonly answer: AnswerFormAnswer; readonly answerText: string; readonly question: string },
  TurnCommandError
> {
  const briefResult = readBrief({ path });
  if (briefResult.isErr()) {
    return err(TurnCommandErrors.upstreamRefused({ reasons: [briefResult.error.message] }));
  }
  const read = readOrReport({ path: answerPath, what: "answer" }).andThen((text) =>
    parseAnswerJson({ answerText: text }).map((raw) => ({ raw, text })),
  );
  if (read.isErr()) {
    return err(read.error);
  }
  const answer = parseAnswerArm({ context: botAnswerBareRefContext({ home }), home, raw: read.value.raw });
  if (answer.isErr()) {
    return err(TurnCommandErrors.upstreamRefused({ reasons: answer.error }));
  }
  const validated = validateAnswerForDispatch({
    answer: answer.value,
    brief: answerableProjectionOf({ brief: briefResult.value }),
    decision,
  });
  if (validated.isErr()) {
    return err(TurnCommandErrors.upstreamRefused({ reasons: [validated.error.message] }));
  }
  return ok({ answer: answer.value, answerText: read.value.text, question: briefResult.value.question });
}
