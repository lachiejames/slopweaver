/**
 * `slopweaver turn answer` — resolving the DIRECT (`--brief`/`--answer`/`--decision`) and DISPATCH
 * (`--dispatch <id>`) invocation modes into validated inputs, and `--print-digest`.
 *
 * Split out of {@link ./run.js} (the file-size ratchet, step 2). Nothing here posts to Slack — that is
 * {@link ./postAnswer.js}'s job, which imports {@link refuse} and {@link mentionFromBrief} from here.
 */
import { dispatchSessionName } from "../../../cmux/planNames.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import { capturedAskFor } from "../../../live/ask/store.js";
import type { Mention } from "../../../live/listen/mention.js";
import { type AnswerableBrief, answerableProjectionOf } from "../../../live/turn/briefAnswerable.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import { askIdentityFromDispatchId } from "../../../live/turn/dispatch.js";
import { currentGenerationDispatchRecord } from "../../../live/turn/dispatchStore.js";
import { parseRoutingDecision } from "../../../live/turn/judgement.js";
import { answerDigestOf } from "../../../live/turn/poster.js";
import type { RespondDecision } from "../../../live/turn/tier.js";
import { type AnswerFormAnswer, parseAnswerArm } from "../../../outbound/assistant/answerForm.js";
import type { VisibleSessionHost } from "../../../supervisor/session.js";
import { botAnswerBareRefContext } from "../../bareRefContext.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { refusalForBlockedOnHuman, refusalForStaleDecision } from "./answerRefusals.js";
import { readOrReport, str, TURN_FLAG_SPEC, TURN_USAGE } from "./core.js";
import { type TurnCommandError, TurnCommandErrors, turnCommandErrorLines } from "./errors.js";
import { liveScreenRead, type SurfaceReader } from "./liveScreenRead.js";

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn answer`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: { boolean: [...TURN_FLAG_SPEC.boolean], string: [...TURN_FLAG_SPEC.string] } });
}

/**
 * The mention the brief describes — the same value the transport would have built from a live event.
 *
 * @param brief the brief this verb read back
 * @returns the mention `answerMention` posts against
 */
export function mentionFromBrief({ brief }: { brief: AnswerableBrief }): Mention {
  return {
    channel: brief.channel,
    messageTs: brief.messageTs,
    surface: brief.surface,
    text: brief.question,
    threadTs: brief.threadTs,
    userId: brief.userId,
  };
}

/**
 * Print every reason and return the code, so each refusal below is one line rather than a block.
 *
 * @param code the exit code to return
 * @param errors every reason line to print
 * @param usage whether to also print the verb's usage line
 * @returns `code`, unchanged — so a caller can `return refuse({ ... })` directly
 */
export function refuse({ code, errors, usage }: { code: number; errors: readonly string[]; usage: boolean }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  if (usage) {
    logger.error({ msg: TURN_USAGE });
  }
  return code;
}

/** Read and parse a RoutingDecision file, refusing anything that is not the `respond` arm by name. */
function readRespondDecision({ path }: { path: string }): Result<RespondDecision, TurnCommandError> {
  const text = readOrReport({ path, what: "decision" });
  if (text.isErr()) {
    return err(text.error);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.value);
  } catch (error) {
    return err(TurnCommandErrors.documentNotJson({ cause: error, what: "decision" }));
  }
  const parsed = parseRoutingDecision({ value: raw });
  if (parsed.isErr()) {
    return err(TurnCommandErrors.upstreamRefused({ reasons: parsed.error }));
  }
  if (parsed.value.response !== "respond") {
    return err(TurnCommandErrors.decisionNotRespondable({ purpose: "answer" }));
  }
  return ok(parsed.value);
}

/** Read and parse one answer file, through the ONE shared decoder both invocation modes read through. */
function readAnswerFile({
  answerPath,
  home,
}: {
  answerPath: string;
  home: string;
}): Result<AnswerFormAnswer, TurnCommandError> {
  const answerText = readOrReport({ path: answerPath, what: "answer" });
  if (answerText.isErr()) {
    return err(answerText.error);
  }
  let rawAnswer: unknown;
  try {
    rawAnswer = JSON.parse(answerText.value);
  } catch (error) {
    return err(TurnCommandErrors.documentNotJson({ cause: error, what: "answer" }));
  }
  return parseAnswerArm({ context: botAnswerBareRefContext({ home }), home, raw: rawAnswer }).mapErr((reasons) =>
    TurnCommandErrors.upstreamRefused({ reasons }),
  );
}

/**
 * The brief, answer and decision, all read and validated, for the DIRECT (`--brief`/`--answer`/`--decision`) mode.
 *
 * A `--decision` FILE carries no proof it is the one `turn dispatch` actually dispatched — the same "a
 * hand-editable local file is not proof" reasoning the responder whitelist already applies to a
 * hand-authored brief. When this ask HAS a recorded dispatch, the supplied decision must match it exactly.
 *
 * @param home the resolved state home
 * @param values the parsed flags
 * @returns the validated brief, answer and decision, or every rejection
 */
export function loadDirectInputs({
  home,
  values,
}: {
  home: string;
  values: Readonly<Record<string, string | boolean>>;
}): Result<{ brief: AnswerableBrief; answer: AnswerFormAnswer; decision: RespondDecision }, TurnCommandError> {
  const briefPath = str({ key: "brief", values });
  const answerPath = str({ key: "answer", values });
  const decisionPath = str({ key: "decision", values });
  if (briefPath === undefined || answerPath === undefined || decisionPath === undefined) {
    return err(
      TurnCommandErrors.inputsMissing({
        flags: [
          ...(briefPath === undefined ? ["--brief"] : []),
          ...(answerPath === undefined ? ["--answer"] : []),
          ...(decisionPath === undefined ? ["--decision"] : []),
        ],
      }),
    );
  }
  const briefResult = readBrief({ path: briefPath });
  if (briefResult.isErr()) {
    return err(TurnCommandErrors.upstreamRefused({ reasons: [briefResult.error.message] }));
  }
  const waiting = refusalForBlockedOnHuman({ askIdentity: askIdentityOf({ source: briefResult.value }), home });
  if (waiting !== undefined) {
    return err(waiting);
  }
  const answer = readAnswerFile({ answerPath, home });
  if (answer.isErr()) {
    return err(answer.error);
  }
  const decision = readRespondDecision({ path: decisionPath });
  if (decision.isErr()) {
    return err(decision.error);
  }
  const staleness = refusalForStaleDecision({
    askIdentity: askIdentityOf({ source: briefResult.value }),
    home,
    supplied: decision.value,
  });
  if (staleness !== undefined) {
    return err(staleness);
  }
  return ok({
    answer: answer.value,
    brief: answerableProjectionOf({ brief: briefResult.value }),
    decision: decision.value,
  });
}

/**
 * What the fresh workspace must say before `--dispatch` mode may proceed — the durable turn-marker file
 * checked FIRST (see `liveScreenRead.ts`'s own header), falling back to the live screen scrape.
 *
 * @param askIdentity the ask this dispatch is for — resolves the durable marker file
 * @param dispatchId the dispatch being finished — a marker naming a different id is ignored, not accepted
 * @param home the resolved state home
 * @param surfaceId the workspace surface to read when no durable marker is found
 * @param workspaceId the workspace to read when no durable marker is found
 * @param readSurface the surface reader, defaulting to a real cmux client
 * @returns the ready answer's path, or every reason it is not ready yet
 */
export async function readyAnswerPathFromLiveScreen({
  askIdentity,
  dispatchId,
  home,
  surfaceId,
  workspaceId,
  readSurface,
}: {
  askIdentity: AskIdentity;
  dispatchId: string;
  home: string;
  surfaceId: string;
  workspaceId: string;
  readSurface?: SurfaceReader;
}): Promise<Result<string, TurnCommandError>> {
  const { truth } = await liveScreenRead({
    askIdentity,
    dispatchId,
    home,
    notBeforeIso: capturedAskFor({ channel: askIdentity.channel, home, messageTs: askIdentity.messageTs })?.firstAnswer
      ?.tsIso,
    ...(readSurface === undefined ? {} : { readSurface }),
    surfaceId,
    workspaceId,
  });
  if (truth.kind === "ready") {
    return ok(truth.answerPath);
  }
  if (truth.kind === "failed") {
    return err(TurnCommandErrors.liveAnswerUnavailable({ reason: truth.reason, state: "failed" }));
  }
  if (truth.kind === "unreachable") {
    return err(TurnCommandErrors.liveAnswerUnavailable({ reason: truth.reason, state: "unreachable" }));
  }
  if (truth.kind === "phantom") {
    return err(TurnCommandErrors.liveAnswerUnavailable({ reason: truth.reason, state: "phantom" }));
  }
  return err(TurnCommandErrors.liveAnswerWorking());
}

/**
 * The session that actually composed a dispatched answer, as its own record's `session` locator says — never
 * as the current process's environment guesses. Three uses, one source: the card's provenance label names it,
 * the workspace close acts on it, and the session ledger's entry is closed under `sessionKey`.
 */
export interface DispatchedWorker {
  readonly host: VisibleSessionHost;
  /** The worker's session-ledger key — `cmux/plan.ts`'s `dispatchSessionName`, the same name `claude --name` gave it. */
  readonly sessionKey: string;
  readonly workspaceId: string;
  readonly workspaceRef: string;
}

/**
 * The brief, answer and decision, all read and validated, for the DISPATCH (`--dispatch <id>`) mode — plus
 * the {@link DispatchedWorker} that composed the answer, which is what the card's provenance names and what
 * the workspace close and the ledger close both act on.
 *
 * @param dispatchId the dispatch token `turn dispatch` minted
 * @param home the resolved state home
 * @returns the validated brief, answer, decision and worker, or every rejection
 */
export async function loadDispatchInputs({ dispatchId, home }: { dispatchId: string; home: string }): Promise<
  Result<
    {
      brief: AnswerableBrief;
      answer: AnswerFormAnswer;
      decision: RespondDecision;
      worker: DispatchedWorker;
    },
    TurnCommandError
  >
> {
  const askIdentity = askIdentityFromDispatchId({ dispatchId });
  if (askIdentity === undefined) {
    return err(TurnCommandErrors.dispatchTokenInvalid({ dispatchId }));
  }
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  if (record === undefined) {
    return err(TurnCommandErrors.dispatchRecordMissing({ dispatchId }));
  }
  const briefResult = readBrief({ path: record.briefPath });
  if (briefResult.isErr()) {
    return err(TurnCommandErrors.upstreamRefused({ reasons: [briefResult.error.message] }));
  }
  const answerPath = await readyAnswerPathFromLiveScreen({
    askIdentity: record,
    dispatchId,
    home,
    surfaceId: record.session.surfaceId,
    workspaceId: record.session.workspaceId,
  });
  if (answerPath.isErr()) {
    return err(answerPath.error);
  }
  const answer = readAnswerFile({ answerPath: answerPath.value, home });
  if (answer.isErr()) {
    return err(answer.error);
  }
  return ok({
    answer: answer.value,
    brief: answerableProjectionOf({ brief: briefResult.value }),
    decision: record.decision,
    worker: {
      host: record.session.host,
      sessionKey: dispatchSessionName({
        askChannel: record.channel,
        askMessageTs: record.messageTs,
        role: "ask",
      }),
      workspaceId: record.session.workspaceId,
      workspaceRef: record.session.workspaceRef,
    },
  });
}

/**
 * Print the digest the admit door will bind a verdict to, and send nothing.
 *
 * This exists because the digest is NOT the hash of the answer file. `answerDigestOf` hashes the answer
 * after it has been parsed, so whitespace and key order are normalised away — a reviewer running `sha256sum`
 * on the file computes a different number, and the send is then refused as stale for a review that was
 * actually sound. Without a verb that reports it, the only way to produce a valid verdict is to
 * hand-replicate the parser's key order, which drifts silently the first time a field is added.
 *
 * Needs only `--answer`: no brief, no decision, no token, no network, nothing posted.
 *
 * @param values the parsed flags
 * @returns the exit code
 */
export function printAnswerDigest({ values }: { values: Readonly<Record<string, string | boolean>> }): number {
  const answerPath = str({ key: "answer", values });
  if (answerPath === undefined) {
    return refuse({ code: EXIT_USAGE, errors: ["--answer is required with --print-digest"], usage: true });
  }
  const home = resolveHome({ named: str({ key: "home", values }) });
  const answer = readAnswerFile({ answerPath, home });
  if (answer.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: answer.error }), usage: false });
  }
  logger.out({ line: answerDigestOf({ answer: answer.value }) });
  return EXIT_OK;
}
