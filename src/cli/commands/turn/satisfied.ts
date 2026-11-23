/**
 * `slopweaver turn satisfied` — settle one ask whose content another turn's answer already covers, and say
 * nothing in the thread.
 *
 * The effectful shell over `./satisfiedCore.ts`, which carries the measurement and every
 * judgement this verb makes. What is here is the ORDER, and the order is the whole contract:
 *
 *  1. read the fold and the ask's own cards, and plan (pure);
 *  2. REAP every card this ask published — its working checklist, and the failure notice a broken turn left
 *     — through the same door-routed delete an answered turn uses (`../../../live/turn/posterWorking.ts`);
 *  3. only once every one of them is CONFIRMED gone, append the terminal `satisfied-elsewhere` event;
 *  4. settle the indicators through the shared seam, to `:white_check_mark:`;
 *  5. post nothing.
 *
 * **Step 3's guard is the lesson `./dispatchAdmit.ts`'s two-event triage split was written for**, arrived at
 * a cheaper way. A terminal appended over a card that is still standing can never be revisited — no later
 * event will look at a resolved ask — so the thread keeps a half-ticked card forever. Triage needs its
 * `triage-cleanup-intended` event because it runs inside a dispatch decision that must record its intent
 * even if the process dies mid-cleanup. A standalone operator verb has no such obligation: it is re-runnable
 * by construction, so writing NOTHING and exiting non-zero leaves the fold exactly where a later pass
 * retries from, which buys the same property at half the vocabulary.
 *
 * Runs no model and touches no corpus. It is emphatically NOT a router: nothing derives "this ask is
 * satisfied" on its own, and nothing should — a session decides it, names the answer, and says why.
 */

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import type { AskLifecycleEvent } from "../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, capturedAskFor } from "../../../live/ask/store.js";
import { earlierCardsForAsk } from "../../../live/turn/earlierCards.js";
import { finaliseIndicators } from "../../../live/turn/indicators.js";
import { liveIndicatorSeams } from "../../../live/turn/poster.js";
import { reapEarlierCardImpl } from "../../../live/turn/posterWorking.js";
import type { PostedRef } from "../../../live/turn/runContract.js";
import { supervisorModelLabel } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";
import { str } from "./core.js";
import {
  type SatisfiedAskArgs,
  type SatisfiedRefusedPlan,
  type SatisfiedSettlePlan,
  satisfiedArgsFrom,
  satisfiedElsewherePlan,
} from "./satisfiedCore.js";
import { TURN_SATISFIED_FLAG_SPEC, TURN_SATISFIED_USAGE } from "./satisfiedUsage.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, satisfied, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn satisfied`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnSatisfiedArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_SATISFIED_FLAG_SPEC.boolean], string: [...TURN_SATISFIED_FLAG_SPEC.string] },
  });
}

/**
 * Delete every card this ask published, oldest first, and name each one that would not go.
 *
 * Sequential rather than concurrent for the reason `../../../live/turn/earlierCards.ts` gives: a thread's
 * deletes are few, and one at a time keeps the door ledger in the order a reader scrolling the thread would
 * see them go.
 *
 * @param askIdentity the ask whose cards these are
 * @param cards what `earlierCardsForAsk` named
 * @param home the resolved state home, for the door ledger
 * @param transport the Slack write transport
 * @param turnId the correlation id this verb's door requests carry
 * @returns the cards that are still standing — empty when every one of them is confirmed gone
 */
async function reapAskCards({
  askIdentity,
  cards,
  home,
  transport,
  turnId,
}: {
  askIdentity: AskIdentity;
  cards: readonly PostedRef[];
  home: string;
  transport: ReturnType<typeof makeSlackWriteTransport>;
  turnId: string;
}): Promise<readonly PostedRef[]> {
  const stuck: PostedRef[] = [];
  for (const card of cards) {
    if (
      !(await reapEarlierCardImpl({ askIdentity, doorLedger: doorLedgerPort(), home, posted: card, transport, turnId }))
    ) {
      stuck.push(card);
    }
  }
  return stuck;
}

/**
 * The three arms that settle nothing, reported and turned into an exit code. Exhaustive over
 * {@link SatisfiedRefusedPlan}, so a fourth non-settling arm fails to compile rather than falling through.
 *
 * @param args the four required flag values, for the `channel/ts` the messages open on
 * @param plan the non-settling arm to report
 * @returns the exit code — "expected empty" for a no-op, "usage" for a pointer the operator must correct
 */
function reportNonSettling({ args, plan }: { args: SatisfiedAskArgs; plan: SatisfiedRefusedPlan }): number {
  const at = `${args.channel}/${args.messageTs}`;
  if (plan.kind === "nothing-raised") {
    logger.out({
      line: `${at} was never captured — it raised no indicator and posted no card, so there is nothing to settle`,
    });
    return EXIT_EXPECTED_EMPTY;
  }
  if (plan.kind === "already-satisfied") {
    logger.out({ line: `${at} is already recorded as answered at ts ${plan.answeredByTs} — nothing written` });
    return EXIT_EXPECTED_EMPTY;
  }
  logger.error({ msg: `--answered-by-ts ${args.answeredByTs} is not an answer to this ask: ${plan.why}` });
  return EXIT_USAGE;
}

/**
 * Perform the settle: reap, then record, then converge the indicators, then say nothing.
 *
 * The ORDER is this module's whole contract — see the file header. Nothing is written until every card is
 * CONFIRMED gone, because a terminal appended over a standing card can never be revisited.
 *
 * @param args the four required flag values
 * @param home the resolved state home, which the door ledger and the lifecycle log both live under
 * @param plan what {@link satisfiedElsewherePlan} decided
 * @returns the exit code — non-zero, with nothing written, whenever a card would not delete
 */
async function performSettle({
  args,
  home,
  plan,
}: {
  args: SatisfiedAskArgs;
  home: string;
  plan: SatisfiedSettlePlan;
}): Promise<number> {
  const botToken = slackBotToken({ home });
  if (botToken === undefined) {
    logger.error({ msg: "turn satisfied: no Slack bot token — run `slopweaver connect slack` first" });
    return EXIT_ERROR;
  }
  const transport = makeSlackWriteTransport({ home, token: botToken });
  const askIdentity = plan.askIdentity;
  const stuck = await reapAskCards({ askIdentity, cards: plan.cards, home, transport, turnId: plan.turnId });
  if (stuck.length > 0) {
    for (const card of stuck) {
      logger.error({
        msg: `turn satisfied: the card at ${card.channel}/${card.ts} could not be deleted — nothing was recorded, so re-run this once it is gone or delete it by hand`,
      });
    }
    return EXIT_ERROR;
  }
  const event: AskLifecycleEvent = {
    ...askIdentity,
    answeredByTs: args.answeredByTs,
    kind: "satisfied-elsewhere",
    reason: args.reason,
    tsIso: new Date().toISOString(),
  };
  appendAskLifecycleEvent({ event, home });
  // `explicit` rather than a model host, exactly as `./ignoreIndicators.ts` and `./triagedIndicators.ts`
  // reason: a session decided this, and stamping a model that composed nothing would put a false provenance
  // line on the very indicators being corrected.
  const supervisor = { host: "explicit" as const, id: "turn satisfied" };
  const finalisation = await finaliseIndicators({
    seams: liveIndicatorSeams({
      askIdentity,
      doorLedger: doorLedgerPort(),
      home,
      provenance: { modelId: supervisorModelLabel({ session: supervisor }), supervisor },
      steps: plan.steps,
      task: "answering",
      transport,
      turnChrome: turnChromeFrom({ chrome: chromeFromProfile({ home }) }),
      turnId: plan.turnId,
    }),
    state: plan.state,
  });
  for (const failure of finalisation.failures) {
    logger.error({ msg: `turn satisfied: ${args.channel}/${args.messageTs} — ${failure}` });
  }
  logger.out({
    line: `${args.channel}/${args.messageTs} is answered at ts ${args.answeredByTs} — ${String(plan.cards.length)} card(s) retracted, nothing posted`,
  });
  return EXIT_OK;
}

/**
 * Read the ask's own records, plan, and either report a no-op or perform the settle.
 *
 * @param args the four required flag values
 * @param home the resolved state home
 * @returns the exit code
 */
async function settleSatisfiedAsk({ args, home }: { args: SatisfiedAskArgs; home: string }): Promise<number> {
  const entry = capturedAskFor({ channel: args.channel, home, messageTs: args.messageTs });
  // An ask that was never captured published nothing, so there is no card read to make — and none is
  // possible either: `earlierCardsForAsk` wants the full identity, and `threadTs` lives on the fold.
  const cards = entry === undefined ? [] : earlierCardsForAsk({ askIdentity: askIdentityOf({ source: entry }), home });
  const plan = satisfiedElsewherePlan({ answeredByTs: args.answeredByTs, cards, entry, reason: args.reason });
  if (plan.kind !== "settle") {
    return reportNonSettling({ args, plan });
  }
  return performSettle({ args, home, plan });
}

/**
 * Run the satisfied verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnSatisfied(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_SATISFIED_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnSatisfiedArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: TURN_SATISFIED_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const args = satisfiedArgsFrom({
    answeredByTs: str({ key: "answered-by-ts", values }),
    channel: str({ key: "channel", values }),
    messageTs: str({ key: "message-ts", values }),
    reason: str({ key: "reason", values }),
  });
  if (args.kind === "missing") {
    for (const flag of args.flags) {
      logger.error({ msg: `${flag} is required` });
    }
    logger.error({ msg: TURN_SATISFIED_USAGE });
    return EXIT_USAGE;
  }
  return settleSatisfiedAsk({ args, home: resolveHome({ named: str({ key: "home", values }) }) });
}

export const turnSatisfiedCommand = defineCommand({ run: runTurnSatisfied });
