/**
 * The entrance gates of `slopweaver turn dispatch`: who is admitted, and what a `no-response` decision does.
 *
 * Depth 1 — it stands on the argument layer and on nothing else the verb owns.
 */
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import { type Result } from "../../../lib/result.js";
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import { IGNORED_ASK_SCHEMA_VERSION } from "../../../live/ask/ignore.js";
import { currentlyIgnoredConversations } from "../../../live/ask/ignoredConversationStore.js";
import { ignoredEntranceVerdict } from "../../../live/ask/ignoredEntrance.js";
import { appendIgnoredAsk, currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import type { AppendableAskLifecycleEvent } from "../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, ensureCapturedAskLifecycle, startedRefForAsk } from "../../../live/ask/store.js";
import type { TurnRoutingBrief } from "../../../live/turn/brief.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import {
  type RoutingDecision,
  type RoutingJudgementInput,
  validateNeedsAgainstRoster,
  validatePresentStateCheck,
  validateTierForExecutionContext,
} from "../../../live/turn/judgement.js";
import { deleteCapturedChecklist } from "../../../live/turn/poster.js";
import { DoorRecordingRefusedError } from "../../../live/turn/run.js";
import { turnErrorLines } from "../../../live/turn/turnErrors.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { refuse } from "./core.js";
import { readDecisionFile, responderRefused } from "./dispatchArgs.js";
import { turnCommandErrorLines } from "./errors.js";
import { settleTriagedAskIndicators } from "./triagedIndicators.js";

/**
 * Put this ask on the permanent exclusion registry when the judge asked for it, and say so.
 *
 * The owner's own shape for a burst: a later tag that needs no answer goes on the exclusion
 * list and never comes up again. Only a decision carrying `exclude` writes one — a plain `no-response`
 * records one judgement attempt and leaves nothing standing, which is the separation
 * `../../../live/ask/ignore.ts` exists to keep.
 *
 * @param askIdentity the ask being excluded
 * @param decision the `no-response` decision, whose rationale becomes the registry's reason
 * @param home the resolved state home
 */
function excludeIfAsked({
  askIdentity,
  decision,
  home,
}: {
  askIdentity: AskIdentity;
  decision: Extract<RoutingDecision, { readonly response: "no-response" }>;
  home: string;
}): void {
  if (decision.exclude !== true) {
    return;
  }
  appendIgnoredAsk({
    entry: {
      channel: askIdentity.channel,
      ignoredAtIso: new Date().toISOString(),
      messageTs: askIdentity.messageTs,
      reason: decision.rationale,
      schemaVersion: IGNORED_ASK_SCHEMA_VERSION,
    },
    home,
  });
  logger.out({
    line: `excluded for good — ${askIdentity.channel}/${askIdentity.messageTs} never reaches a turn again`,
  });
}

/**
 * The ref a triage cleanup should delete: the one this ask's own `started` card was written under, or the
 * brief's if no start was ever recorded for it.
 *
 * An `if` that returns rather than a coalesce, because the two arms answer different questions. The stored
 * ref is what this ask actually posted; `brief.started` is what the brief BELIEVES it posted, which is the
 * right answer only when there is no record to contradict it.
 *
 * @returns the ref whose card the cleanup deletes
 */
function checklistDeleteRef({
  askIdentity,
  brief,
  home,
}: {
  askIdentity: AskIdentity;
  brief: TurnRoutingBrief;
  home: string;
}): TurnRoutingBrief["started"] {
  const started = startedRefForAsk({ askIdentity, home });
  if (started !== undefined) {
    return started;
  }
  return brief.started;
}

/**
 * Delete the capture checklist a judged ask no longer needs, reporting why when it cannot be confirmed gone.
 *
 * @param cleanupKind the intent the lifecycle stays at when the delete is unconfirmed, named in the report
 * @returns whether the delete was confirmed — `false` has already been reported
 */
async function deleteChecklistOrReport({
  askIdentity,
  checklistDelete,
  cleanupKind,
  home,
}: {
  askIdentity: AskIdentity;
  checklistDelete: NonNullable<TurnRoutingBrief["started"]>;
  cleanupKind: "triage-cleanup-intended" | "handover-cleanup-intended";
  home: string;
}): Promise<boolean> {
  const token = slackBotToken({ home });
  if (token === undefined) {
    logger.error({ msg: "turn dispatch: no Slack bot token — run `slopweaver connect slack` first" });
    return false;
  }
  let deleted: boolean;
  try {
    deleted = await deleteCapturedChecklist({
      askIdentity,
      doorLedger: doorLedgerPort(),
      home,
      started: checklistDelete,
      transport: makeSlackWriteTransport({ home, token }),
    });
  } catch (error) {
    if (!(error instanceof DoorRecordingRefusedError)) {
      throw error;
    }
    // A store fault, not the door's verdict and not an unconfirmed delete: said as what it is, and the lifecycle
    // stays at the cleanup intent exactly as it does for any other unconfirmed delete.
    logger.error({
      msg: `turn dispatch: ${error.message}; lifecycle stays at ${cleanupKind} for a later retry`,
    });
    return false;
  }
  if (!deleted) {
    logger.error({
      msg: `turn dispatch: could not confirm the capture checklist was deleted — ${askIdentity.channel}/${askIdentity.messageTs}; lifecycle stays at ${cleanupKind} for a later retry`,
    });
  }
  return deleted;
}

/**
 * Handle the `no-response` decision: record intent, delete any capture checklist, THEN record the terminal
 * truth — never the other order — and finally surface whatever was queued behind this ask.
 *
 * `triage-cleanup-intended` lands FIRST and is non-terminal on purpose (a found-and-fixed defect):
 * appending the genuinely terminal `triaged-no-response` before the checklist delete is CONFIRMED means a
 * crash, a door refusal, or an unconfirmed `deleteMessage` result would leave the lifecycle terminal while
 * the checklist stays visible forever, with no later event able to revisit it. Recording intent first, and
 * the terminal event only once cleanup is confirmed (or never needed at all, when no checklist exists),
 * means a stuck cleanup is a real, recoverable `triage-cleanup-intended` state rather than a silent lie.
 *
 * The delete target is the LIFECYCLE's own recorded `checklist-posted` ref, never `brief.started` directly
 * (another found-and-fixed defect): `brief.started` can come from caller-supplied `--turn-id`/
 * `--working-ts` flags that disagree with what was actually posted. Slack's delete treats a nonexistent
 * message as a successful no-op, so a wrong (stale or mistyped) reference would be "confirmed deleted" while
 * the real checklist stays stuck — exactly the false-terminal state this whole ordering exists to prevent.
 * `startedRefForAsk` is the durable ground truth; `brief.started` is trusted only when the lifecycle has no
 * record at all — see `skills/loop/SKILL.md` for why the hand-off alone was never sufficient.
 *
 * That fallback still means an ask whose `checklist-posted` was never durably recorded (the SAME accepted
 * crash-window gap `../../../live/ask/lifecycle.ts`'s `ChecklistPostedEvent` doc already names — Slack
 * accepted the post but the local append never happened) and whose brief carries an explicit but WRONG
 * `--turn-id`/`--working-ts` remains unverifiable by this process alone (residual): there is no
 * lifecycle record to catch the mismatch. This is not a new gap — it is the existing, documented precondition
 * ("requires a durably recorded checklist-posted event as its precondition") applying here too, not only to
 * recovery. Closing it fully would mean never trusting caller-supplied flags at all, which would break the
 * legitimate recovery flow (`../../../live/listen/recover.ts`) that reconstructs `started` from a live Slack
 * read specifically for asks the local lifecycle never captured.
 *
 * The Slack-visible follow-up once cleanup succeeds is the ACKNOWLEDGED reaction, and it closes what was a
 * deliberate `TODO(owner)` here: this path recorded the decision and deleted the checklist that decision
 * makes stale, and stopped — leaving the capture `:eyes:` standing over an ask that had been handled
 * correctly and would never be answered. Measured twice, in two different sessions on two
 * different asks. The owner settled the visible policy (`:ack:`, a third ending rather than a re-use of the
 * tick or the warning, neither of which is true of this outcome); `./triagedIndicators.ts` carries the
 * mechanism and the evidence.
 *
 * It runs AFTER the terminal event is appended, never before, for the same reason the delete runs before
 * it: the durable judgement is the thing that must survive, and a reaction is chrome the judgement can
 * afford to lose. A reaction that could not be settled is REPORTED and the verb still succeeds, because
 * exiting non-zero here would say the no-response decision failed when only its emoji did.
 *
 * A `for-a-human` decision takes this SAME path, because it is the same act — the bot stays out and posts
 * nothing — with the opposite claim about the asker's message. Only the intent (`handover-cleanup-intended`),
 * the terminal event (`left-for-a-human`) and the reaction it settles to (`:for-a-human:`) differ, and none
 * may fall back to triage's — not even the intent, or a stalled cleanup would read as "nothing owed": the
 * owner's rule is that a person should still answer, and a stalled cleanup never reads as anything else.
 *
 * @param brief the routing brief this decision answers, carrying the capture checklist when one exists
 * @param decision the parsed `no-response` or `for-a-human` decision
 * @param home the resolved state home
 * @returns the process exit code
 */
export async function handleNoResponse({
  brief,
  decision,
  home,
}: {
  brief: TurnRoutingBrief;
  decision: Extract<RoutingDecision, { readonly response: "no-response" | "for-a-human" }>;
  home: string;
}): Promise<number> {
  const askIdentity = askIdentityOf({ source: brief });
  const checklistDelete = checklistDeleteRef({ askIdentity, brief, home });
  const forAHuman = decision.response === "for-a-human";
  const cleanupKind = forAHuman ? "handover-cleanup-intended" : "triage-cleanup-intended";
  appendAskLifecycleEvent({
    event: {
      ...askIdentity,
      checklistDelete,
      kind: cleanupKind,
      reason: decision.rationale,
      tsIso: new Date().toISOString(),
    },
    home,
  });
  if (
    checklistDelete !== undefined &&
    !(await deleteChecklistOrReport({ askIdentity, checklistDelete, cleanupKind, home }))
  ) {
    return EXIT_ERROR;
  }
  const terminal: AppendableAskLifecycleEvent = {
    ...askIdentity,
    kind: forAHuman ? "left-for-a-human" : "triaged-no-response",
    reason: decision.rationale,
    tsIso: new Date().toISOString(),
  };
  appendAskLifecycleEvent({ event: terminal, home });
  await settleTriagedAskIndicators({
    channel: askIdentity.channel,
    ending: forAHuman ? "left-for-a-human" : "triaged",
    home,
    messageTs: askIdentity.messageTs,
    reason: decision.rationale,
    report: ({ failure }) => {
      logger.error({ msg: `turn dispatch: ${failure}` });
    },
  });
  if (decision.response === "for-a-human") {
    logger.out({ line: `left for a person to answer — recorded: ${decision.rationale}` });
    return EXIT_OK;
  }
  logger.out({ line: `no response owed — recorded: ${decision.rationale}` });
  excludeIfAsked({ askIdentity, decision, home });
  return EXIT_OK;
}

/**
 * The brief and decision, both loaded and every entrance gate passed, or the exit code a refusal already reported.
 *
 * @returns the loaded pair, or the exit code to return unchanged
 */
export function loadedAndAdmitted({
  briefPath,
  decisionPath,
  home,
}: {
  briefPath: string;
  decisionPath: string;
  home: string;
}): { readonly brief: TurnRoutingBrief; readonly decision: RoutingDecision } | { readonly code: number } {
  const briefResult = readBrief({ path: briefPath });
  if (briefResult.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: [briefResult.error.message] }) };
  }
  const brief = briefResult.value;
  if (responderRefused({ home, userId: brief.userId })) {
    return { code: EXIT_EXPECTED_EMPTY };
  }
  const ignoredVerdict = ignoredEntranceVerdict({
    askIdentity: brief,
    ignoredAsks: currentlyIgnoredAsks({ home }),
    ignoredConversations: currentlyIgnoredConversations({ home }),
  });
  if (ignoredVerdict !== undefined) {
    logger.error({
      msg:
        ignoredVerdict.kind === "ask"
          ? `turn dispatch: this exact ask is permanently ignored — ${brief.channel}/${brief.messageTs}; lift it ` +
            `with slopweaver turn ignore --remove --channel ${brief.channel} --message-ts ${brief.messageTs} --reason "<why>"`
          : `turn dispatch: this conversation is permanently ignored — ${brief.channel}/${brief.messageTs}`,
    });
    return { code: EXIT_EXPECTED_EMPTY };
  }
  // A brief that never went through `turn brief` (or a hand-driven one that did) may have no `captured`
  // event on the log yet — without one, `foldAskLifecycle` would silently ignore the `dispatched` event
  // this call is about to append. Idempotent: a no-op when the listener or `turn brief` already captured it.
  // Deliberately NO `text`: the only text this entrance holds is the brief's `question`, which is
  // TAGS-STRIPPED, and the ledger's `text` is the addressing message verbatim — a value a later re-route
  // hands back to `turn brief --text`, where a stripped copy would fail the address test
  // `../../../live/listen/strandedSurvivors.ts` rejected a two-source lane over. Absent is honest; wrong is
  // not. In practice the listener's own row is already there and this call is a no-op.
  ensureCapturedAskLifecycle({ askIdentity: brief, home, surface: brief.surface, userId: brief.userId });
  const decisionResult = readDecisionFile({ path: decisionPath });
  if (decisionResult.isErr()) {
    return { code: refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: decisionResult.error }) }) };
  }
  return { brief, decision: decisionResult.value };
}

/**
 * Every check a `respond` decision must pass before `turn dispatch` acts on it, in the order they refuse.
 *
 * They run HERE and not only inside `judgeRouting`, because nothing on the live path calls `judgeRouting` at
 * all — `turn dispatch` reads a decision the visible session composed and validates it against the brief
 * itself. A rule wired only into the judging shell is dead code on the one path that matters: the premise
 * check learned that from `../../../live/turn/proposalAsk.ts`'s incident, and the roster needs check learned
 * it again when the brief started offering a HISTORICAL leg that nothing on this path stopped
 * a `current` answer being built from alone.
 *
 * @param decision the validated `respond` decision
 * @param routingInput the brief's routing input the decision was judged against
 * @returns `ok` when the decision is admissible, or the first failing check's reasons
 */
export function admissibleRespondDecision({
  decision,
  routingInput,
}: {
  decision: Extract<RoutingDecision, { readonly response: "respond" }>;
  routingInput: RoutingJudgementInput;
}): Result<void> {
  return validateTierForExecutionContext({ decision, execution: routingInput.execution })
    .andThen(() => validatePresentStateCheck({ context: routingInput, decision }))
    .mapErr((error) => turnErrorLines({ error }))
    .andThen(() => validateNeedsAgainstRoster({ context: routingInput, decision }));
}
