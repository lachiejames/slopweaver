/**
 * The gates every verb that EDITS a turn's already-posted checklist must pass, in one place.
 *
 * Three verbs now reach the same `chat.update` on the same message — `./status.ts` (the worker's own live
 * line), `./block.ts` (the hourglass step) and `./unblock.ts` (the resume line) — and each of them has to
 * clear exactly the same five things first: the brief is readable, the asker is on the responder whitelist
 * and this ask is not permanently ignored, a capture-time checklist actually exists to edit, a bot token is
 * configured, and a visible supervisor is running.
 *
 * They live here rather than being written out three times because a gate that exists in two copies is a
 * gate that will exist in one and a half. `./status.ts`'s own header already states why each is needed — a
 * brief file carries no signature, so a hand-edited or replayed one could name an ask this process has no
 * business posting into, and every one of these verbs reaches a real Slack write with nothing else standing
 * between the file and the channel.
 */

import { slackBotToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import { isIgnoredAsk } from "../../../live/ask/ignore.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import { responderHatchOpenNow } from "../../../live/listen/responderHatch.js";
import { admitResponder } from "../../../live/listen/whitelist.js";
import { loadResponderWhitelist } from "../../../live/listen/whitelistStore.js";
import type { TurnRoutingBrief } from "../../../live/turn/brief.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import { currentGenerationDispatchRecord } from "../../../live/turn/dispatchStore.js";
import { appendProgressLogEvent } from "../../../live/turn/progressLog.js";
import {
  detectSupervisorSession,
  type SupervisorSession,
  supervisorSessionProblem,
} from "../../../supervisor/session.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { answerProvenanceLabel, str } from "./core.js";
import { type TurnCommandError, TurnCommandErrors } from "./errors.js";

/**
 * Print every reason and hand back the code, so one refusal is one line at the call site rather than a
 * block. `usage` is the verb's own usage text, printed after the reasons when the refusal is a usage error.
 *
 * @param code the exit code to return
 * @param errors every reason, printed in order
 * @param usage the verb's usage text to print after them, when this refusal earns one
 * @returns the same `code`, so a caller can `return refuseWith({...})`
 */
export function refuseWith({
  code,
  errors,
  usage,
}: {
  code: number;
  errors: readonly string[];
  usage?: string | undefined;
}): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  if (usage !== undefined) {
    logger.error({ msg: usage });
  }
  return code;
}

/**
 * The brief a card edit targets, read and validated.
 *
 * @param usage the verb's own usage text, printed when `--brief` was not given at all
 * @param values the parsed flag values
 * @returns the brief, or the exact exit code a refusal already reported
 */
function loadTargetBrief({
  usage,
  values,
}: {
  usage: string;
  values: Readonly<Record<string, string | boolean>>;
}): { readonly brief: TurnRoutingBrief } | { readonly code: number } {
  const briefPath = str({ key: "brief", values });
  if (briefPath === undefined) {
    return { code: refuseWith({ code: EXIT_USAGE, errors: ["--brief is required"], usage }) };
  }
  const briefResult = readBrief({ path: briefPath });
  if (briefResult.isErr()) {
    return { code: refuseWith({ code: EXIT_ERROR, errors: [briefResult.error.message] }) };
  }
  return { brief: briefResult.value };
}

/**
 * Whether the brief's asker is refused by the responder whitelist, or this ask is permanently ignored.
 *
 * @param brief the brief being acted on
 * @param home the resolved state home
 * @param verb the verb's own name, so the refusal names who refused
 * @returns `true` when this ask must not be touched, having already said why
 */
function askRefused({ brief, home, verb }: { brief: TurnRoutingBrief; home: string; verb: string }): boolean {
  const responder = admitResponder({
    openOverride: responderHatchOpenNow({ home }),
    userId: brief.userId,
    whitelist: loadResponderWhitelist({ home }),
  });
  if (!responder.admitted) {
    logger.error({ msg: `${verb}: responder refused: ${responder.why}` });
    return true;
  }
  if (isIgnoredAsk({ askIdentity: brief, ignored: currentlyIgnoredAsks({ home }) })) {
    logger.error({
      msg:
        `${verb}: this exact ask is permanently ignored — ${brief.channel}/${brief.messageTs}; lift it with ` +
        `slopweaver turn ignore --remove --channel ${brief.channel} --message-ts ${brief.messageTs} --reason "<why>"`,
    });
    return true;
  }
  return false;
}

/**
 * The brief's capture-time checklist ref, or the exact refusal naming why there is nothing to edit.
 *
 * @param brief the brief being acted on
 * @param verb the verb's own name, so the refusal names who refused
 * @returns the ref, or the exit code a refusal already reported
 */
function startedRefOrRefusal({
  brief,
  verb,
}: {
  brief: TurnRoutingBrief;
  verb: string;
}): { readonly turnId: string; readonly workingTs: string } | { readonly code: number } {
  if (brief.started !== undefined) {
    return brief.started;
  }
  return {
    code: refuseWith({
      code: EXIT_ERROR,
      errors: [
        `${verb}: this ask has no capture-time checklist recorded — nothing to advance. Only ` +
          "`slopweaver listen`'s capture posts one; a hand-authored brief with no --turn-id/--working-ts " +
          "posts its working message for the first time when `turn answer` runs.",
      ],
    }),
  };
}

/**
 * What a card edit with no bot token is refused with: what the absence likely means, and the store read that
 * settles it, so the session reads the secrets store instead of guessing.
 *
 * @internal exported for its own tests; {@link botTokenOrRefusal} is its one caller.
 * @param home the resolved state home the token was looked for under
 * @returns the refusal line
 */
export function missingBotTokenRefusal({ home }: { home: string }): string {
  return (
    `no Slack bot token: SLACK_BOT_TOKEN is unset and the secrets store under ${home} holds no slack-bot-token, ` +
    "so Slack was never connected for this home or this is the wrong home — run " +
    `\`slopweaver secrets status --home ${home}\` to read what the store holds, then \`slopweaver connect slack\` ` +
    "if the token is missing"
  );
}

/**
 * The configured bot token, or the exact refusal naming why there is none.
 *
 * @param home the resolved state home
 * @returns the token, or the exit code a refusal already reported
 */
export function botTokenOrRefusal({ home }: { home: string }): string | { readonly code: number } {
  const token = slackBotToken({ home });
  if (token == null) {
    // Required: a card edit cannot post without it, so refuse here rather than carry an absent token on.
    return { code: refuseWith({ code: EXIT_ERROR, errors: [missingBotTokenRefusal({ home })] }) };
  }
  return token;
}

/**
 * The explicit or host-provided visible supervisor a card edit is attributed to.
 *
 * @param values the parsed flag values
 * @param verb the verb's own name, so the refusal names who refused
 * @returns the session, or the reason none could be resolved
 */
export function cardEditSupervisor({
  values,
  verb,
}: {
  values: Readonly<Record<string, string | boolean>>;
  verb: string;
}): Result<SupervisorSession, TurnCommandError> {
  const explicitSession = str({ key: "session-url", values });
  if (explicitSession !== undefined) {
    return ok({ host: "explicit", id: explicitSession });
  }
  const detection = detectSupervisorSession({ env: process.env });
  return detection.kind === "active"
    ? ok(detection.session)
    : err(TurnCommandErrors.supervisorUnavailable({ problem: supervisorSessionProblem({ detection }), verb }));
}

/**
 * The home a card-editing verb runs against.
 *
 * @param values the parsed flag values
 * @returns `--home` when the caller gave one, else the resolved state home
 */
export function cardEditHome({ values }: { values: Readonly<Record<string, string | boolean>> }): string {
  return resolveHome({ named: str({ key: "home", values }) });
}

/** Everything the shared gates resolve for one card edit, once all three have passed. */
export interface CardEditContext {
  readonly askIdentity: AskIdentity;
  readonly brief: TurnRoutingBrief;
  readonly home: string;
  readonly started: { readonly turnId: string; readonly workingTs: string };
}

/**
 * Run the whole gate sequence for a verb that edits a turn's card, in one call.
 *
 * The ORDER is the contract, not an implementation detail: home, then the brief, then the responder/ignore
 * checks, then the capture-time checklist ref. Each refusal has already printed its own reason by the time
 * this returns a code.
 *
 * The BOT TOKEN and the VISIBLE SUPERVISOR are deliberately NOT part of it, and that is the same call twice.
 * `./status.ts` and `./unblock.ts` cannot do their job without a token while `./block.ts` must record its
 * durable event whether or not Slack is reachable; and the two checks are ordered differently per verb, with
 * `./status.ts`'s own suite asserting that it reaches the token gate rather than the supervisor one. Folding
 * either in here would silently reorder a refusal a caller's tests already pin.
 *
 * @param usage the verb's own usage text, printed when `--brief` was not given at all
 * @param values the parsed flag values
 * @param verb the verb's own name, so each refusal names who refused
 * @returns the brief, its ask identity, the home and the checklist ref, or the exit code a refusal reported
 */
export function cardEditContext({
  usage,
  values,
  verb,
}: {
  usage: string;
  values: Readonly<Record<string, string | boolean>>;
  verb: string;
}): CardEditContext | { readonly code: number } {
  const home = cardEditHome({ values });
  const loaded = loadTargetBrief({ usage, values });
  if ("code" in loaded) {
    return { code: loaded.code };
  }
  const { brief } = loaded;
  if (askRefused({ brief, home, verb })) {
    return { code: EXIT_EXPECTED_EMPTY };
  }
  const started = startedRefOrRefusal({ brief, verb });
  if ("code" in started) {
    return started;
  }
  return { askIdentity: askIdentityOf({ source: brief }), brief, home, started };
}

/**
 * Who the card names as its author — the session DOING the work, which on a dispatched turn is the worker
 * and not this process.
 *
 * Shared by every verb that writes a frame, because reading this process's own host instead is a MEASURED
 * mislabel rather than a style question: it says "the supervisor session" on every dispatched turn's card,
 * and the owner read one off a live card.
 *
 * @param askIdentity the ask whose dispatch record names the worker
 * @param home the resolved state home
 * @param modelOverride the caller's own `--model`, when passed
 * @param supervisor the visible session this process is running under
 * @returns the provenance label to stamp on the card
 */
export function cardAuthorLabel({
  askIdentity,
  home,
  modelOverride,
  supervisor,
}: {
  askIdentity: AskIdentity;
  home: string;
  modelOverride: string | undefined;
  supervisor: SupervisorSession;
}): string {
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  return answerProvenanceLabel({
    modelOverride,
    supervisor,
    worker: record === undefined ? undefined : { host: record.session.host, workspaceRef: record.session.workspaceRef },
  });
}

/**
 * Record a card write that actually reached Slack, so the staleness probe can measure the gap it closed.
 *
 * Appended AFTER the edit landed, never before: a write recorded ahead of a failed `chat.update` would let a
 * refused edit masquerade as a fresh card — see `../../../live/turn/progressLog.ts`.
 *
 * @param askIdentity the ask whose log this is
 * @param detail what the in-flight step said at that instant
 * @param home the resolved state home
 * @param stageCount how many stages stood behind it
 */
export function recordCardWrite({
  askIdentity,
  detail,
  home,
  stageCount,
}: {
  askIdentity: AskIdentity;
  detail: string;
  home: string;
  stageCount: number;
}): void {
  appendProgressLogEvent({
    askIdentity,
    event: { detail, kind: "card-write", stageCount, tsIso: new Date().toISOString() },
    home,
  });
}
