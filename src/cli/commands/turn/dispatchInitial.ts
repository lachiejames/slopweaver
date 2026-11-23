/**
 * The two ACTING modes of `slopweaver turn dispatch`: the initial dispatch, and the subagent report that is
 * the second call of the same two-call protocol.
 *
 * Depth 2 — it stands on the argument layer and the entrance gates. The tier handlers live here rather than
 * one layer down because each of them is what "executing the tier" MEANS, and splitting them off would put
 * a boundary in the middle of one decision.
 */
import { logger } from "../../../lib/logger.js";
import { bundledLauncherPath } from "../../../lib/pluginRoot.js";
import type { StartedChecklist } from "../../../live/ask/checklist.js";
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import { appendAskLifecycleEvent, capturedAskFor } from "../../../live/ask/store.js";
import type { TurnRoutingBrief } from "../../../live/turn/brief.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import type { ReadOnlyTask } from "../../../live/turn/subagent.js";
import { leaseExpiryFromNow, type RespondDecision } from "../../../live/turn/tier.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { refuse } from "./core.js";
import { admissibleRespondDecision, handleNoResponse, loadedAndAdmitted } from "./dispatchAdmit.js";
import { readDecisionFile } from "./dispatchArgs.js";
import { handleFreshVisibleSession } from "./dispatchFreshSession.js";
import { handleSubagentReport } from "./dispatchSubagentReport.js";
import { ensureLiveCard, liveCardLine } from "./ensureCard.js";
import { turnCommandErrorLines } from "./errors.js";
import { liveCardDeps } from "./liveCardWiring.js";
import { assertAskReaction, liveReactionAssertDeps, reactionAssertionLine } from "./reactionAssert.js";
import { tickerStartCommand } from "./tickerOwner.js";

/** Instructions for a bounded read-only subagent, synthesised from the question and the decision's needs. */
function subagentInstructionsFor({ question, decision }: { question: string; decision: RespondDecision }): string {
  const needs = decision.needs.map((need) => `${need.capabilityId} (${need.requirement}): ${need.reason}`).join("; ");
  return `Investigate: ${question}\n\nFocus on: ${needs.length === 0 ? "no specific live need was named" : needs}`;
}

/**
 * The FIRST step of an inline or read-only-subagent handoff: start this card's ticker, the same command a
 * fresh worker's step 0a prints. Pure.
 *
 * Measured (`src/__tests__/fixtures/replay/inline-turn-silent-card-19sep`): an inline turn
 * answered fifty minutes after it was dispatched, two review rounds in, and its card never moved once —
 * nothing on this path wrote it. The sweep's card push reads a fresh session's dispatch record, which an
 * inline turn never has, and no line here had ever asked for `turn watch`, which resolves an inline turn's
 * card from the calling session alone.
 *
 * @param briefPath the ask's brief
 * @param home the resolved state home
 * @param launcher the resolved absolute `bin/slopweaver`
 * @param tier which of the two handoffs is printing it
 * @returns the two lines, printed before the tier's own instruction
 */
export function cardClockLines({
  briefPath,
  home,
  launcher,
  tier,
}: {
  briefPath: string;
  home: string;
  launcher: string;
  tier: "inline" | "read-only-subagent";
}): readonly string[] {
  return [
    `${tier} — FIRST, start this card's clock ONCE, backgrounded with a bare & (it keeps the card saying how long the reader has waited, and stops itself once the ask is answered):`,
    `  ${tickerStartCommand({ briefPath, home, launcher })}`,
  ];
}

/** Every line of {@link cardClockLines}, written to stdout, with this build's own launcher. */
function printCardClock({
  briefPath,
  home,
  tier,
}: {
  briefPath: string;
  home: string;
  tier: "inline" | "read-only-subagent";
}): void {
  const launcher = bundledLauncherPath({ importMetaUrl: import.meta.url });
  for (const line of cardClockLines({ briefPath, home, launcher, tier })) {
    logger.out({ line });
  }
}

/** Handle the `inline` tier: record it, hand the next command straight back. */
function handleInline({
  askIdentity,
  briefPath,
  card,
  decision,
  decisionPath,
  home,
  leaseExpiresAt,
}: {
  askIdentity: AskIdentity;
  briefPath: string;
  card: StartedChecklist;
  decision: RespondDecision;
  decisionPath: string;
  home: string;
  leaseExpiresAt: string;
}): number {
  appendAskLifecycleEvent({
    event: {
      ...askIdentity,
      decision,
      kind: "dispatched",
      leaseExpiresAt,
      tier: "inline",
      tsIso: new Date().toISOString(),
    },
    home,
  });
  logger.out({ line: `the live progress card for this ask is ${askIdentity.channel}/${card.workingTs}` });
  printCardClock({ briefPath, home, tier: "inline" });
  logger.out({ line: "inline — compose the answer now, from context and judgement alone, then run:" });
  logger.out({
    line: `  slopweaver turn answer --brief ${briefPath} --decision ${decisionPath} --answer <answer-file.json>`,
  });
  return EXIT_OK;
}

/** Handle the FIRST `read-only-subagent` call: record it, hand back the task to run natively. */
function handleReadOnlySubagentFirstCall({
  askIdentity,
  briefPath,
  card,
  decision,
  decisionPath,
  home,
  leaseExpiresAt,
  question,
}: {
  askIdentity: AskIdentity;
  briefPath: string;
  card: StartedChecklist;
  decision: RespondDecision;
  decisionPath: string;
  home: string;
  leaseExpiresAt: string;
  question: string;
}): number {
  appendAskLifecycleEvent({
    event: {
      ...askIdentity,
      decision,
      kind: "dispatched",
      leaseExpiresAt,
      tier: "read-only-subagent",
      tsIso: new Date().toISOString(),
    },
    home,
  });
  const task: ReadOnlyTask = { ask: askIdentity, instructions: subagentInstructionsFor({ decision, question }) };
  logger.out({ line: `the live progress card for this ask is ${askIdentity.channel}/${card.workingTs}` });
  printCardClock({ briefPath, home, tier: "read-only-subagent" });
  logger.out({ line: "read-only-subagent — run this via YOUR OWN native read-only subagent mechanism:" });
  logger.out({ line: JSON.stringify(task, null, 2) });
  logger.out({ line: "then write its evidence (an ExecutionEvidence JSON) to a file and run:" });
  logger.out({
    line: `  slopweaver turn dispatch --brief ${briefPath} --decision ${decisionPath} --subagent-report <evidence-file.json>`,
  });
  return EXIT_OK;
}

/**
 * Put the capture emoji back on the tagged message of an ask a worker has just picked up.
 *
 * Best-effort in every direction, exactly as every other indicator write on this path is: a reaction is a
 * courtesy, the dispatch has already happened and is already recorded, and a `turn dispatch` that failed
 * over an emoji would turn a landed worker into a reported failure. What it could not do is reported on
 * stderr rather than swallowed, so an operator watching the verb can still see it.
 *
 * It CONVERGES rather than adding, so the stale warning a previous attempt's failure earned comes off in the
 * same pass — see `../../../live/turn/lifecycleReactions.ts` for why an add-without-retire is the original
 * defect here.
 *
 * @param askIdentity the ask just dispatched
 * @param home the resolved state home
 */
async function convergeDispatchedReaction({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): Promise<void> {
  const entry = capturedAskFor({ channel: askIdentity.channel, home, messageTs: askIdentity.messageTs });
  if (entry === undefined) {
    return;
  }
  const assertion = await assertAskReaction({ deps: liveReactionAssertDeps({ home }), entry, home });
  const line = reactionAssertionLine({ askIdentity, assertion });
  if (line !== undefined) {
    logger.error({ msg: `turn dispatch: ${line}` });
  }
}

/**
 * Execute the tier this decision named. Split out of {@link runInitial} so the reaction convergence has one
 * exit to hang off rather than three returns.
 *
 * `card` is a REQUIRED parameter of this function and of all three handlers below, and that is the whole
 * structural half of the owner's ruling rather than a convenience: a dispatch that has not
 * already proved a live progress card has nothing to pass here, so it does not compile. There is no ordering
 * to get wrong and no branch to forget — see `./ensureCard.ts` for the incident that made a convention
 * insufficient.
 *
 * @param askIdentity the ask being dispatched
 * @param brief the loaded routing brief, for the question, routing input and asker
 * @param briefPath the brief file path a handed-back tier points its next command at
 * @param card the live progress card this ask already has standing in its thread
 * @param decision the validated `respond` decision
 * @param decisionPath the decision file path a handed-back tier points its next command at
 * @param home the resolved state home
 * @param leaseExpiresAt the freshly minted lease this dispatch is recorded under
 * @returns the process exit code
 */
async function runTier({
  askIdentity,
  brief,
  briefPath,
  card,
  decision,
  decisionPath,
  home,
  leaseExpiresAt,
}: {
  askIdentity: AskIdentity;
  brief: TurnRoutingBrief;
  briefPath: string;
  card: StartedChecklist;
  decision: RespondDecision;
  decisionPath: string;
  home: string;
  leaseExpiresAt: string;
}): Promise<number> {
  if (decision.tier === "inline") {
    return handleInline({ askIdentity, briefPath, card, decision, decisionPath, home, leaseExpiresAt });
  }
  if (decision.tier === "read-only-subagent") {
    return handleReadOnlySubagentFirstCall({
      askIdentity,
      briefPath,
      card,
      decision,
      decisionPath,
      home,
      leaseExpiresAt,
      question: brief.question,
    });
  }
  return handleFreshVisibleSession({
    askIdentity,
    briefPath,
    card,
    decision,
    home,
    leaseExpiresAt,
    question: brief.question,
    routingInput: brief.routingInput,
    userId: brief.userId,
  });
}

/**
 * The initial (`--brief --decision`, no `--subagent-report`) mode: judge, then execute or hand back.
 *
 * @returns the process exit code
 */
export async function runInitial({
  briefPath,
  decisionPath,
  home,
}: {
  briefPath: string;
  decisionPath: string;
  home: string;
}): Promise<number> {
  const loaded = loadedAndAdmitted({ briefPath, decisionPath, home });
  if ("code" in loaded) {
    return loaded.code;
  }
  const { brief } = loaded;
  const askIdentity = askIdentityOf({ source: brief });
  const parsed = loaded.decision;
  if (parsed.response === "no-response" || parsed.response === "for-a-human") {
    return handleNoResponse({ brief, decision: parsed, home });
  }
  const admissible = admissibleRespondDecision({ decision: parsed, routingInput: brief.routingInput });
  if (admissible.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: admissible.error });
  }
  // BEFORE the lease is minted and before any worker is handed anything: an ask that cannot be shown live
  // progress is not dispatched at all. `./ensureCard.ts` carries the measured incident this closes.
  const card = await ensureLiveCard({ brief, deps: liveCardDeps({ brief, briefPath, home }) });
  if (card.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: [card.error.message] });
  }
  logger.out({ line: liveCardLine({ card: card.value }) });
  const leaseExpiresAt = leaseExpiryFromNow({ nowIso: new Date().toISOString() });
  const code = await runTier({
    askIdentity,
    brief,
    briefPath,
    card: card.value.started,
    decision: parsed,
    decisionPath,
    home,
    leaseExpiresAt,
  });
  // The SELF-RECOVERY half of the phantom-reaction fix, and the one call site that covers all three tiers.
  //
  // Gated on `EXIT_OK` because that is this verb's own definition of "the dispatch landed": on the fresh
  // tier a pickup that could not be sent, or a workspace holding no session, has ALREADY been recorded
  // `dispatch-failed` and settled to the warning emoji by `./dispatchFreshSession.ts`, and converging over
  // that would claim a worker exists. Placed after the `no-response` return above for the same reason in the
  // other direction — `handleNoResponse` has just settled the tag to the acknowledged emoji.
  //
  // Measured on one ask: without this, a re-dispatch left the warning a phantom finding had correctly raised
  // standing over a live worker for 43 minutes. See `../../../live/turn/reactionState.ts`.
  if (code === EXIT_OK) {
    await convergeDispatchedReaction({ askIdentity, home });
  }
  return code;
}

/**
 * Load the brief and decision for `--subagent-report` mode, then dispatch to {@link handleSubagentReport}.
 *
 * @returns the process exit code
 */
export async function runSubagentReportMode({
  briefPath,
  decisionPath,
  home,
  reportPath,
}: {
  briefPath: string;
  decisionPath: string;
  home: string;
  reportPath: string;
}): Promise<number> {
  const briefResult = readBrief({ path: briefPath });
  if (briefResult.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: [briefResult.error.message] });
  }
  const decisionResult = readDecisionFile({ path: decisionPath });
  if (decisionResult.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: decisionResult.error }) });
  }
  if (decisionResult.value.response !== "respond") {
    return refuse({
      code: EXIT_ERROR,
      errors: [`the decision is \`${decisionResult.value.response}\` — there is no subagent report to accept`],
    });
  }
  // Re-checked here, not just in `runInitial`: the brief on disk can be rebuilt for the same ask between
  // the first dispatch call and this one, so a continuous-drain rebuild must refuse a report just as loudly
  // as it would have refused the initial dispatch — this path is a second way to REACH the same tier.
  const admissible = admissibleRespondDecision({
    decision: decisionResult.value,
    routingInput: briefResult.value.routingInput,
  });
  if (admissible.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: admissible.error });
  }
  return handleSubagentReport({
    askIdentity: askIdentityOf({ source: briefResult.value }),
    briefPath,
    decision: decisionResult.value,
    decisionPath,
    home,
    reportPath,
  });
}
