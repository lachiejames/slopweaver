/**
 * `slopweaver turn resume` — runs INSIDE a fresh visible session `turn dispatch` opened.
 *
 * Three calls, all from the SAME session — the worker's — never from the original loop:
 *
 * - `--dispatch <id>` alone: load the brief and decision this session was dispatched for, and print them
 *   with the numbered steps the worker owns from here to the ask's terminal outcome.
 * - `--dispatch <id> --answer <file>`: locally validate the answer against that decision and brief. A PASS
 *   prints the one stable `SLOPWEAVER_TURN_READY {...}` marker line — the worker's validation report, not the
 *   end of its work: the review and the send are still its own. A validate REFUSAL (malformed JSON, a
 *   grounding mismatch, an answer over a count/aggregate cap, …) is "not yet", never "not at all" — it writes
 *   no durable marker and prints none, so the loop's sweep keeps reading this ask as still-working while the
 *   SAME session fixes the SAME answer file and re-runs this exact command.
 * - `--dispatch <id> --failed <reason>`: the worker's own statement that no answer is coming, in its words —
 *   the ONLY thing that writes the durable FAILED marker. Records it so the loop's sweep finalises the
 *   thread's indicators from it — a worker that cannot answer and merely stops leaves a card that says
 *   "working" over nothing. Conflating this with a validate refusal above is the exact defect a validate
 *   refusal once caused: a fixable answer finalised the thread and told the owner to re-tag while the worker
 *   was still alive and about to fix it.
 *
 * This verb never posts to Slack. The worker itself runs `turn answer --dispatch <id> --verdict <file>` once
 * a reviewer it did not brief (`turn review`) has returned a verdict — see `../../../live/turn/dispatch.js`'s
 * header for why the marker is read live rather than trusted from any state this process could claim.
 */
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { currentlyIgnoredConversations } from "../../../live/ask/ignoredConversationStore.js";
import { ignoredEntranceVerdict } from "../../../live/ask/ignoredEntrance.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import { capturedAskFor } from "../../../live/ask/store.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import { checkpointResumeLines } from "../../../live/turn/checkpoint.js";
import { checkpointDir, checkpointDraftBestEffort, readCheckpointSet } from "../../../live/turn/checkpointStore.js";
import {
  askIdentityFromDispatchId,
  type FreshDispatchRecord,
  TURN_FAILED_MARKER,
  TURN_READY_MARKER,
} from "../../../live/turn/dispatch.js";
import { currentGenerationDispatchRecord, noDispatchRecordReason } from "../../../live/turn/dispatchStore.js";
import { answerDigestOf } from "../../../live/turn/poster.js";
import { firstDraftReviewLines } from "../../../live/turn/reviewObligations.js";
import { reviewPaths } from "../../../live/turn/reviewStore.js";
import { effectiveLeaseExpiresAt } from "../../../live/turn/tier.js";
import { writeTurnMarker } from "../../../live/turn/turnMarkerStore.js";
import { announceThisSession } from "../../../live/turn/workerSessionStore.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import { ownerUserIdFromProfile } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { refuse, str, TURN_RESUME_FLAG_SPEC, TURN_RESUME_USAGE } from "./core.js";
import { workerBudgetLines } from "./dispatchBudget.js";
import { cardForWorker } from "./liveCardWiring.js";
import { answerFreezeRefusal, refuseComposeTime, validatedAnswer } from "./resumeAnswerChecks.js";
import { cardlessResumeRefusal, freshResumeLines, ignoredResumeRefusal } from "./resumeLines.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, resume, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn resume`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnResumeArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_RESUME_FLAG_SPEC.boolean], string: [...TURN_RESUME_FLAG_SPEC.string] },
  });
}

/**
 * The owner `profile.json` names for this install, as the asker-tag preflight reads it: `undefined` when the
 * profile declares none, which that preflight treats as no owner to compare the asker with.
 *
 * @param home the resolved state home
 * @returns the owner's Slack user id, or `undefined` when none is configured
 */
function configuredOwner({ home }: { home: string }): string | undefined {
  const owner = ownerUserIdFromProfile({ home });
  if (owner === null) {
    return undefined;
  }
  return owner;
}

/** The `--dispatch <id>` LOAD mode: print the brief and decision this session was dispatched for. */
function runLoad({ dispatchId, home }: { dispatchId: string; home: string }): number {
  const askIdentity = askIdentityFromDispatchId({ dispatchId });
  if (askIdentity === undefined) {
    return refuse({ code: EXIT_ERROR, errors: [`--dispatch "${dispatchId}" is not a token this build minted`] });
  }
  const loadVerdict = ignoredEntranceVerdict({
    askIdentity,
    ignoredAsks: currentlyIgnoredAsks({ home }),
    ignoredConversations: currentlyIgnoredConversations({ home }),
  });
  if (loadVerdict !== undefined) {
    return refuse({ code: EXIT_ERROR, errors: [ignoredResumeRefusal({ dispatchId, kind: loadVerdict.kind })] });
  }
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  if (record === undefined) {
    return refuse({
      code: EXIT_ERROR,
      errors: [`${noDispatchRecordReason({ askIdentity, home })} for --dispatch "${dispatchId}"`],
    });
  }
  const briefResult = readBrief({ path: record.briefPath });
  if (briefResult.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: [briefResult.error.message] });
  }
  const card = cardForWorker({ askIdentity, brief: briefResult.value, home });
  if (card === undefined) {
    return refuse({ code: EXIT_ERROR, errors: [cardlessResumeRefusal({ briefPath: record.briefPath, dispatchId })] });
  }
  // The worker announces itself HERE because this is the one command it cannot avoid running, so the sweep
  // can render its card from its own transcript whether or not it starts the ticker below.
  announceThisSession({ askIdentity, home });
  for (const line of freshResumeLines({
    askedBy: briefResult.value.userId,
    briefPath: record.briefPath,
    card,
    dispatchId,
    firstAnswer: capturedAskFor({ channel: askIdentity.channel, home, messageTs: askIdentity.messageTs })?.firstAnswer,
    home,
    ownerDirectives: briefResult.value.routingInput.ownerDirectives,
    ownerUserId: configuredOwner({ home }),
    profile: briefResult.value.routingInput.profile,
    question: briefResult.value.question,
    record,
    stoodDown: briefResult.value.stoodDown === true,
    surface: briefResult.value.surface,
    unprompted: briefResult.value.unprompted === true,
  })) {
    logger.out({ line });
  }
  printTrailingSections({ askIdentity, home });
  return EXIT_OK;
}

/**
 * The two blocks that print AFTER the numbered steps: the budget warn this worker plans against, and what a
 * previous session on this ask already paid for.
 *
 * Both sit after the steps rather than before them because each changes how a worker executes those steps,
 * not which steps it owns. The checkpoint block is ABSENT rather than empty when there is nothing to resume
 * from, so an ordinary first dispatch reads an identical brief.
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 */
function printTrailingSections({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): void {
  for (const line of workerBudgetLines({ askIdentity, home, nowIso: new Date().toISOString() })) {
    logger.out({ line });
  }
  for (const line of checkpointResumeLines({
    checkpointDir: checkpointDir({ askIdentity, home }),
    reviewDir: reviewPaths({ askIdentity, home }).dir,
    set: readCheckpointSet({ askIdentity, home }),
  })) {
    logger.out({ line });
  }
}

/**
 * The `--dispatch <id> --failed <reason>` mode: the worker's own statement that no answer is coming. Records
 * the FAILED marker (durably, then printed) so the loop's sweep finalises every indicator the ask raised —
 * the reaction, the card, the thinking state — with this reason on it. Exits OK: reporting a failure is the
 * verb doing exactly what it was asked, and a non-zero exit here would train a worker to read its own honest
 * report as the tool breaking.
 */
function runFailed({ dispatchId, home, reason }: { dispatchId: string; home: string; reason: string }): number {
  const askIdentity = askIdentityFromDispatchId({ dispatchId });
  if (askIdentity === undefined) {
    return refuse({ code: EXIT_ERROR, errors: [`--dispatch "${dispatchId}" is not a token this build minted`] });
  }
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  if (record === undefined) {
    return refuse({
      code: EXIT_ERROR,
      errors: [`${noDispatchRecordReason({ askIdentity, home })} for --dispatch "${dispatchId}"`],
    });
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return refuse({
      code: EXIT_USAGE,
      errors: ["--failed needs a reason — say why no answer is coming", TURN_RESUME_USAGE],
    });
  }
  writeTurnMarker({
    askIdentity,
    home,
    marker: { dispatchId, kind: "failed", leaseExpiresAt: record.leaseExpiresAt, reason: trimmed },
  });
  logger.out({ line: `${TURN_FAILED_MARKER} ${JSON.stringify({ dispatchId, reason: trimmed })}` });
  logger.out({ line: "recorded — the loop's next sweep finalises this ask's indicators with that reason" });
  return EXIT_OK;
}

/**
 * Why a FINISH cannot even begin — the token, the ignore lists and the dispatch record, each a terminal
 * refusal printed as a `TURN_FAILED` marker line rather than a compose-time "not yet".
 *
 * @param dispatchId the dispatch token as typed
 * @param home the resolved state home
 * @returns the ask and its current-generation record, or `undefined` once the marker line has been printed
 */
function finishEntrance({
  dispatchId,
  home,
}: {
  dispatchId: string;
  home: string;
}): { readonly askIdentity: AskIdentity; readonly record: FreshDispatchRecord } | undefined {
  const askIdentity = askIdentityFromDispatchId({ dispatchId });
  if (askIdentity === undefined) {
    logger.out({
      line: `${TURN_FAILED_MARKER} ${JSON.stringify({ dispatchId, reason: "not a token this build minted" })}`,
    });
    return undefined;
  }
  const finishVerdict = ignoredEntranceVerdict({
    askIdentity,
    ignoredAsks: currentlyIgnoredAsks({ home }),
    ignoredConversations: currentlyIgnoredConversations({ home }),
  });
  if (finishVerdict !== undefined) {
    const reason =
      finishVerdict.kind === "ask"
        ? "this exact ask is now permanently ignored"
        : "this conversation is now permanently ignored";
    logger.out({ line: `${TURN_FAILED_MARKER} ${JSON.stringify({ dispatchId, reason })}` });
    return undefined;
  }
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  if (record === undefined) {
    const reason = noDispatchRecordReason({ askIdentity, home });
    logger.out({ line: `${TURN_FAILED_MARKER} ${JSON.stringify({ dispatchId, reason })}` });
    return undefined;
  }
  return { askIdentity, record };
}

/** The `--dispatch <id> --answer <file>` FINISH mode: validate, print one marker line, stop. */
function runFinish({
  answerPath,
  dispatchId,
  editReason,
  home,
}: {
  answerPath: string;
  dispatchId: string;
  editReason: string | undefined;
  home: string;
}): number {
  const entrance = finishEntrance({ dispatchId, home });
  if (entrance === undefined) {
    return EXIT_ERROR;
  }
  const { askIdentity, record } = entrance;
  const leaseExpiresAt = record.leaseExpiresAt;
  const checked = validatedAnswer({ answerPath, decision: record.decision, home, path: record.briefPath });
  if (checked.isErr()) {
    return refuseComposeTime({ answerPath, dispatchId, home, reason: checked.error.message });
  }
  const { answer, answerText, question } = checked.value;
  const firstAnswer = capturedAskFor({
    channel: askIdentity.channel,
    home,
    messageTs: askIdentity.messageTs,
  })?.firstAnswer;
  const frozen = answerFreezeRefusal({
    answerDigest: answerDigestOf({ answer }),
    askIdentity,
    editReason,
    home,
    leaseExpiresAt: effectiveLeaseExpiresAt({ activeDispatch: record, firstAnswer }),
    postedDigest: firstAnswer?.answerDigest,
  });
  if (frozen !== undefined) {
    return refuse({ code: EXIT_ERROR, errors: frozen });
  }
  return recordValidated({
    answer,
    answerPath,
    answerText,
    askIdentity,
    dispatchId,
    home,
    leaseExpiresAt,
    question,
  });
}

/**
 * What a PASSING validate leaves behind: the draft's own bytes in the ask's record set, the durable READY
 * marker, and the printed marker line.
 *
 * The two records are not the same insurance and both are written. The marker records WHERE the worker put
 * its answer; the checkpoint records WHAT it said. Measured on one ask:
 * `answerPath` was a session scratchpad that no longer exists, so a turn that died with two
 * reviewer rounds behind it left a marker pointing at nothing. See `../../../live/turn/checkpoint.ts`.
 *
 * The checkpoint goes FIRST and cannot fail this verb — see `../../../live/turn/checkpointStore.ts`'s header
 * for why refusing a valid answer over its own insurance would cause the outcome it exists to prevent.
 *
 * @param answer the parsed answer, for the digest a review round will bind to
 * @param answerPath the worker's own path, which the marker records
 * @param answerText the bytes exactly as the worker wrote them
 * @param askIdentity the exact ask
 * @param dispatchId the dispatch this session was resumed for
 * @param home the resolved state home
 * @param leaseExpiresAt this dispatch generation's own token
 * @param question the brief's question, which the pre-review checklist names its artifacts from
 * @returns the process exit code
 */
function recordValidated({
  answer,
  answerPath,
  answerText,
  askIdentity,
  dispatchId,
  home,
  leaseExpiresAt,
  question,
}: {
  answer: AnswerFormAnswer;
  answerPath: string;
  answerText: string;
  askIdentity: AskIdentity;
  dispatchId: string;
  home: string;
  leaseExpiresAt: string;
  question: string;
}): number {
  const acceptedAtIso = new Date().toISOString();
  checkpointDraftBestEffort({
    answerText,
    askIdentity,
    atIso: acceptedAtIso,
    digest: answerDigestOf({ answer }),
    dispatchId,
    home,
    leaseExpiresAt,
  });
  writeTurnMarker({
    askIdentity,
    home,
    marker: { answerPath, dispatchId, kind: "ready", leaseExpiresAt, recordedAtIso: acceptedAtIso },
  });
  // The reviewer's standing checks, at the one moment the worker holds a draft and has not yet spent a round
  // on it (`../../../live/turn/reviewObligations.ts`). BEFORE the marker, so the marker stays the last line a
  // screen read finds (`../../../live/turn/dispatch.ts`'s `lastMarkerPayload`).
  for (const line of firstDraftReviewLines({ question })) {
    logger.out({ line });
  }
  logger.out({ line: `${TURN_READY_MARKER} ${JSON.stringify({ answerPath, dispatchId })}` });
  return EXIT_OK;
}

/**
 * Run the resume verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export function runTurnResume(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_RESUME_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnResumeArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, errors: [...parsed.error, TURN_RESUME_USAGE] });
  }
  const values = parsed.value.values;
  const home = resolveHome({ named: str({ key: "home", values }) });
  const dispatchId = str({ key: "dispatch", values });
  if (dispatchId === undefined) {
    return refuse({ code: EXIT_USAGE, errors: ["--dispatch is required", TURN_RESUME_USAGE] });
  }
  const answerPath = str({ key: "answer", values });
  const failedReason = str({ key: "failed", values });
  if (answerPath !== undefined && failedReason !== undefined) {
    return refuse({
      code: EXIT_USAGE,
      errors: ["--answer and --failed are two different endings — pass one", TURN_RESUME_USAGE],
    });
  }
  if (failedReason !== undefined) {
    return runFailed({ dispatchId, home, reason: failedReason });
  }
  return answerPath === undefined
    ? runLoad({ dispatchId, home })
    : runFinish({ answerPath, dispatchId, editReason: str({ key: "edit-reason", values }), home });
}

export const turnResumeCommand = defineCommand({ run: runTurnResume });
