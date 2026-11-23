/**
 * `slopweaver turn answer` — every gate that must pass before an answer reaches Slack, and the post itself.
 *
 * Split out of {@link ./run.js} (the file-size ratchet, step 2). {@link postAnswer} is what `run.js`'s
 * `runTurnAnswer` calls once the brief/answer/decision have already been loaded and validated by
 * {@link ./loadInputs.js}, which this file imports {@link refuse} and {@link mentionFromBrief} from.
 */
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { whitelistJudgement } from "../../../admit/withhold.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { capturedAskFor } from "../../../live/ask/store.js";
import { responderHatchOpenNow } from "../../../live/listen/responderHatch.js";
import { admitResponder } from "../../../live/listen/whitelist.js";
import { loadResponderWhitelist } from "../../../live/listen/whitelistStore.js";
import { resolveAnswerMentionsFromSnapshot } from "../../../live/turn/answerMentions.js";
import type { AnswerableBrief } from "../../../live/turn/briefAnswerable.js";
import { followThroughAdmissible } from "../../../live/turn/firstAnswer.js";
import { answerMention } from "../../../live/turn/poster.js";
import type { TurnQuery } from "../../../live/turn/run.js";
import type { RespondDecision } from "../../../live/turn/tier.js";
import { turnErrorLines } from "../../../live/turn/turnErrors.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import type { ResolvedMentions } from "../../../outbound/slack/render.js";
import {
  type IdentityRosterPort,
  type IdentityRosterSnapshot,
  identityRosterPort,
} from "../../../silver/identityRoster.js";
import type { SupervisorSession } from "../../../supervisor/session.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { liveReadiness } from "../slack/uploadReadiness.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";
import { loadAnswerDocuments, loadAnswerImages } from "./answerAttachments.js";
import { closeWorkspaceAfterAnswer } from "./answerCleanup.js";
import { reportAnswerOutcome } from "./answerOutcome.js";
import { ignoredEntranceRefused } from "./answerRefusals.js";
import { cardEditSupervisor } from "./cardGates.js";
import { answerProvenanceLabel, str } from "./core.js";
import { turnCommandErrorLines } from "./errors.js";
import { type DispatchedWorker, mentionFromBrief, refuse } from "./loadInputs.js";
import { answerPreflight } from "./sendPreflight.js";

/** One completion line naming what actually produced the answer, whichever way it was grounded. */
function completionDetailFor({ answer }: { answer: AnswerFormAnswer }): string {
  switch (answer.grounding.kind) {
    case "verb":
      return `answered via \`slopweaver ${answer.grounding.capability.command.join(" ")}\``;
    case "unreachable":
      return `the required surface could not be reached — ${answer.grounding.surface.id}`;
    case "conversation":
      return `answered from context and judgement — ${answer.grounding.reason}`;
  }
}

/**
 * The turn's query seam, satisfied entirely by an `answer` form the SESSION already composed — no world
 * model is loaded for any tier, because a live turn never touches the corpus at all.
 *
 * @param answer the parsed, schema-valid answer form
 * @returns the query seam {@link TurnQuery} the turn runs
 */
export function sessionTurnQuery({ answer }: { answer: AnswerFormAnswer }): TurnQuery {
  return async ({ onPhase }) => {
    const completionDetail = completionDetailFor({ answer });
    await onPhase({ detail: completionDetail });
    return { answer, completionDetail };
  };
}

/**
 * The turn id this answer posts under: the one the listener minted at capture, so the door ledger's
 * capture-time entry and this process's correlate as one turn, or a fresh one when nothing was captured.
 *
 * @param started the capture-time checklist, `undefined` when the brief carries none
 * @returns the turn id
 */
function answerTurnId({ started }: { started: AnswerableBrief["started"] }): string {
  if (started === undefined) {
    return `turn-${String(Date.now())}`;
  }
  return started.turnId;
}

/**
 * Everything `postAnswer` needs before it can wire the poster: bot token, supervisor and matching model.
 *
 * @param answer the typed answer whose provenance must match the resolved model
 * @param values the parsed turn flags
 * @param worker the dispatched worker that composed this answer, or `undefined` for a direct answer this
 *   very session composed
 * @returns the live connection facts, or the exact refusal
 */
function resolveTurnConnection({
  answer,
  values,
  worker,
}: {
  answer: AnswerFormAnswer;
  values: Readonly<Record<string, string | boolean>>;
  worker: DispatchedWorker | undefined;
}): Result<
  {
    readonly home: string;
    readonly modelId: string;
    readonly supervisor: SupervisorSession;
    readonly token: string;
  },
  { readonly code: number; readonly errors: readonly string[] }
> {
  const home = resolveHome({ named: str({ key: "home", values }) });
  const token = slackBotToken({ home });
  if (token === undefined) {
    return err({ code: EXIT_ERROR, errors: ["no Slack bot token — run `slopweaver connect slack` first"] });
  }
  const supervisor = cardEditSupervisor({ values, verb: "turn answer" });
  if (supervisor.isErr()) {
    return err({ code: EXIT_USAGE, errors: turnCommandErrorLines({ error: supervisor.error }) });
  }
  const modelId = answerProvenanceLabel({
    modelOverride: str({ key: "model", values }),
    supervisor: supervisor.value,
    worker,
  });
  if (answer.grounding.provenance.model !== modelId) {
    return err({
      code: EXIT_ERROR,
      errors: [
        `the answer's grounding.provenance.model is "${answer.grounding.provenance.model}", which does not ` +
          `match "${modelId}" — pass --model to match what actually produced this answer`,
      ],
    });
  }
  return ok({ home, modelId, supervisor: supervisor.value, token });
}

/**
 * Whether `brief.userId` is refused by the responder whitelist, logging why when it is.
 *
 * A brief file carries no signature: `--user` inside it is editable, and this verb has no way to prove it
 * came from an admitted `turn brief` run. So the SAME gate applies here too, before any door, transport,
 * queue, checklist, title, status or answer effect — an absent/unreadable/empty list must refuse everyone
 * reaching THIS verb, including the owner, exactly as it does at every other entrance.
 *
 * @param brief the parsed answer-form brief, carrying the userId to check
 * @param home the slopweaver home directory the whitelist file lives under
 * @returns true when the responder is refused (and already logged), false when admitted
 */
function responderRefused({ brief, home }: { brief: AnswerableBrief; home: string }): boolean {
  const responder = admitResponder({
    openOverride: responderHatchOpenNow({ home }),
    userId: brief.userId,
    whitelist: loadResponderWhitelist({ home }),
  });
  if (!responder.admitted) {
    logger.error({ msg: `turn answer: responder refused: ${responder.why}` });
  }
  return !responder.admitted;
}

/**
 * Every gate and every piece of live wiring `postAnswer` needs before it can call `answerMention`, or the
 * exit code a refusal already reported — folds the responder/ignore checks and the connection/mentions/
 * uploads resolution into one flat step so `postAnswer` stays a simple sequence rather than re-growing the
 * same nested complexity those five checks had here.
 */
async function gatedAnswerInputs({
  answer,
  brief,
  home,
  identityRoster,
  values,
  worker,
}: {
  answer: AnswerFormAnswer;
  brief: AnswerableBrief;
  home: string;
  identityRoster: IdentityRosterPort;
  values: Readonly<Record<string, string | boolean>>;
  worker: DispatchedWorker | undefined;
}): Promise<
  | {
      readonly modelId: string;
      readonly mentions: ResolvedMentions;
      readonly roster: IdentityRosterSnapshot;
      readonly supervisor: SupervisorSession;
      readonly token: string;
      readonly uploads: readonly SlackUpload[];
      readonly documents: readonly SlackUpload[];
    }
  | { readonly code: number }
> {
  if (responderRefused({ brief, home })) {
    return { code: EXIT_EXPECTED_EMPTY };
  }
  if (ignoredEntranceRefused({ askIdentity: brief, home })) {
    return { code: EXIT_EXPECTED_EMPTY };
  }
  const admissible = followThroughAdmissible({
    declaresFollowThrough: answer.followThrough !== undefined,
    standing: capturedAskFor({ channel: brief.channel, home, messageTs: brief.messageTs })?.firstAnswer,
  });
  if (admissible.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: turnErrorLines({ error: admissible.error }), usage: false }) };
  }
  const connection = resolveTurnConnection({ answer, values, worker });
  if (!connection.isOk()) {
    return { code: refuse({ code: connection.error.code, errors: connection.error.errors, usage: false }) };
  }
  const addressed = await addressedFromRoster({ answer, home, identityRoster });
  if ("code" in addressed) {
    return addressed;
  }
  const uploads = await loadAnswerImages({ answer });
  if (uploads.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: uploads.error, usage: false }) };
  }
  const documents = await loadAnswerDocuments({ answer });
  if (documents.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: documents.error, usage: false }) };
  }
  return { ...connection.value, ...addressed, documents: documents.value, uploads: uploads.value };
}

/**
 * The ONE roster read of this send, and the addresses resolved off it: the card's asker names render off the
 * same snapshot, so a replace landing mid-send cannot split who is tagged from who is named.
 */
async function addressedFromRoster({
  answer,
  home,
  identityRoster,
}: {
  answer: AnswerFormAnswer;
  home: string;
  identityRoster: IdentityRosterPort;
}): Promise<
  { readonly mentions: ResolvedMentions; readonly roster: IdentityRosterSnapshot } | { readonly code: number }
> {
  const roster = await identityRoster.read({ home });
  if (roster.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: [roster.error.message], usage: false }) };
  }
  const mentions = resolveAnswerMentionsFromSnapshot({
    answer,
    askedAtIso: new Date().toISOString(),
    home,
    roster: roster.value,
  });
  if (mentions.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: turnErrorLines({ error: mentions.error }), usage: false }) };
  }
  return { mentions: mentions.value, roster: roster.value };
}

/**
 * Assemble the live wiring and run one turn: gate, wire the poster, post, report and close up.
 *
 * @param answer the typed, schema-valid answer form
 * @param brief the answerable brief this answer replies to
 * @param decision the respond decision this answer was dispatched (or hand-authored) under
 * @param home the resolved state home
 * @param values the parsed turn flags
 * @param worker the dispatched worker that composed this answer, or `undefined` for a direct answer
 * @returns the process exit code
 */
// max-lines-exempt: one answer effect shell; every validation, rendering, post, cleanup and report step is already decomposed.
export async function postAnswer({
  answer,
  brief,
  decision,
  home,
  values,
  worker,
}: {
  answer: AnswerFormAnswer;
  brief: AnswerableBrief;
  decision: RespondDecision;
  home: string;
  values: Readonly<Record<string, string | boolean>>;
  worker?: DispatchedWorker | undefined;
}): Promise<number> {
  // The composition root for the roster port, as it is for the door ledger below.
  const identityRoster = identityRosterPort();
  const prepared = await gatedAnswerInputs({ answer, brief, home, identityRoster, values, worker });
  if ("code" in prepared) {
    return prepared.code;
  }
  const { modelId, mentions, roster, supervisor, token, uploads, documents } = prepared;
  const cardChrome = chromeFromProfile({ home });
  const mention = mentionFromBrief({ brief });
  const preflight = await answerPreflight({ home, mention, nowIso: new Date().toISOString(), values });
  if ("code" in preflight) {
    return preflight.code;
  }
  const { freshnessNote, verdict } = preflight;
  const started = brief.started;
  const transport = makeSlackWriteTransport({ home, token });
  const outcome = await answerMention({
    ...(verdict !== undefined ? { verdict } : {}),
    ...(freshnessNote === undefined ? {} : { freshnessNote }),
    chrome: cardChrome,
    doorLedger: doorLedgerPort(),
    home,
    identityRoster: roster,
    judge: whitelistJudgement({
      openOverride: responderHatchOpenNow({ home }),
      whitelist: loadResponderWhitelist({ home }),
    }),
    mention,
    mentions,
    provenance: { modelId, supervisor },
    query: sessionTurnQuery({ answer }),
    readiness: liveReadiness({ token }),
    tier: decision.tier,
    transport,
    turnChrome: turnChromeFrom({ chrome: cardChrome }),
    // Re-uses the SAME turn id the listener minted at capture, when there is one — so the door ledger's
    // capture-time entry and this process's entries correlate as one turn rather than two.
    turnId: () => answerTurnId({ started }),
    uploads,
    documents,
    ...(started === undefined ? {} : { started }),
  });
  // BEFORE the lifecycle append, the reviewer reap and both workspace closes, and that order is the fix: a
  // warn-tier door refusal ended no turn, so appending a terminal event would supersede this ask's dispatch
  // record and closing the worker's workspace would destroy the session holding the answer. Everything the
  // verb does here is print what the door said and stop. `EXIT_EXPECTED_EMPTY`, never `EXIT_DEFERRED`: the
  // verb DID run its work and produced a legitimate non-success status, and re-running it unchanged would
  // be refused for exactly the same reason — the correction has to come first.
  if (outcome.isErr()) {
    logger.error({ msg: outcome.error.message });
    return EXIT_EXPECTED_EMPTY;
  }
  const completion = outcome.value;
  // Persist the ask-lifecycle terminal event before closing the workspace. `answerMention` has already
  // confirmed Slack accepted the answer and persisted its completion envelope; if this final local append
  // fails, leaving the workspace open is the recoverable failure mode.
  const code = reportAnswerOutcome({ completion, home, mention });
  return closeWorkspaceAfterAnswer({ askIdentity: mention, code, home, outcome: completion, worker });
}
