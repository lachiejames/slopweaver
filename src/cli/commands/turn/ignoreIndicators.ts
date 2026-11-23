/**
 * Settling the live indicators of an ask the operator has decided to IGNORE forever.
 *
 * The third caller of `../../../live/turn/indicators.ts`, beside a turn's own terminal path and the sweep's
 * `./abandoned.ts`. `slopweaver turn ignore` was the one terminal that never reached that seam at all: it
 * wrote the registry entry and stopped, so an ask ignored AFTER capture kept the capture reaction and the
 * half-ticked checklist card the listener had already raised — measured in the owner's own DM,
 * two asks still showing "seen, working on it" over a decision
 * that nothing would ever be worked on.
 *
 * Same shape as the module it calls: a pure {@link ignoredAskIndicatorPlan} deciding WHAT must be settled
 * from the ask-lifecycle fold, and a thin effectful shell that builds the live seams and runs it. The pure
 * half is where the one judgement lives — ignoring an ask BEFORE it was ever captured raises nothing, so it
 * stays local-only exactly as `turn ignore` always was, and putting a reaction on a message the bot never
 * touched would be inventing a signal rather than correcting one.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import type { AskLifecycle } from "../../../live/ask/lifecycle.js";
import { capturedAskFor } from "../../../live/ask/store.js";
import { PENDING_ROUTE_STEPS, turnStepsForTier } from "../../../live/turn/answer.js";
import { finaliseIndicators, type TurnTerminalState } from "../../../live/turn/indicators.js";
import { liveIndicatorSeams } from "../../../live/turn/poster.js";
import type { PostedRef } from "../../../live/turn/run.js";
import { supervisorModelLabel } from "../../../supervisor/session.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";

/**
 * What ignoring one ask must settle: nothing at all when the listener never captured it, or the exact
 * terminal state, checklist steps and card reference every other terminal path hands
 * `finaliseIndicators`.
 */
export type IgnoredAskIndicatorPlan =
  | { readonly kind: "nothing-raised" }
  | {
      readonly kind: "settle";
      readonly posted: PostedRef | undefined;
      readonly state: TurnTerminalState;
      readonly steps: readonly { readonly id: string; readonly title: string }[];
      readonly turnId: string;
    };

/**
 * What an ignore must settle, from the ask's folded lifecycle. Pure and total.
 *
 * Two decisions live here, and both are the kind that go wrong silently:
 *
 *  - an ask with NO fold entry raised no indicator, so there is nothing to correct — the verb stays the
 *    local-state registry write it has always been;
 *  - a DISPATCHED ask's card was re-rendered with its tier's own steps, while anything earlier is still
 *    wearing the capture-time `PENDING_ROUTE_STEPS` the listener posted. Settling against the wrong list
 *    writes the reason onto a step index the card does not have, which is the off-by-a-step
 *    `terminalChecklistProgress` already documents, reappearing one caller up.
 *
 * @param entry the folded ask, or `undefined` when it was never captured
 * @param messageTs the addressing message's own ts, for the fallback correlation id
 * @param reason the operator's own words, shown on the settled card
 * @returns what to settle, or that nothing was ever raised
 */
export function ignoredAskIndicatorPlan({
  entry,
  messageTs,
  reason,
}: {
  entry: AskLifecycle | undefined;
  messageTs: string;
  reason: string;
}): IgnoredAskIndicatorPlan {
  if (entry === undefined) {
    return { kind: "nothing-raised" };
  }
  const started = entry.started;
  return {
    kind: "settle",
    posted: started === undefined ? undefined : { channel: entry.channel, ts: started.workingTs },
    // The operator composed this knowing it lands on the card (see this function's own `@param reason`), so
    // it stays the same clause on both fields.
    state: { kind: "ignored", readerReason: reason, reason },
    steps:
      entry.lastEvent.kind === "dispatched" ? turnStepsForTier({ tier: entry.lastEvent.tier }) : PENDING_ROUTE_STEPS,
    turnId: ignoredTurnId({ entry, messageTs }),
  };
}

/**
 * The correlation id an ignore settles under: the turn id the listener minted at capture, or one named for the
 * ignore itself when no checklist was ever posted for the ask.
 *
 * @param entry the folded ask
 * @param messageTs the addressing message's own ts
 * @returns the turn id
 */
function ignoredTurnId({ entry, messageTs }: { entry: AskLifecycle; messageTs: string }): string {
  const started = unsetFieldAsNull({ key: "started", record: entry });
  if (started === null) {
    return `ignore-${messageTs}`;
  }
  return started.turnId;
}

/**
 * Settle one already-PLANNED ask indicator against a resolved bot token — the actual Slack write both
 * `settleIgnoredAskIndicators` and its conversation-keyed sibling (`./ignoreConversationIndicators.ts`)
 * perform, extracted so neither duplicates the `finaliseIndicators`/`liveIndicatorSeams` wiring.
 *
 * @param botToken the resolved Slack bot token
 * @param entry the ask's own identity — its `channel`/`messageTs` name what `liveIndicatorSeams` settles
 * @param home the resolved state home
 * @param operatorId the verb name stamped as the provenance id (`turn ignore` or `turn ignore-conversation`)
 * @param plan the settle plan already computed for this ask
 * @returns every failure this settle reported, if any
 */
export async function settleOneAskIndicatorPlan({
  botToken,
  entry,
  home,
  operatorId,
  plan,
}: {
  botToken: string;
  entry: AskLifecycle;
  home: string;
  operatorId: string;
  plan: Extract<IgnoredAskIndicatorPlan, { kind: "settle" }>;
}): Promise<readonly string[]> {
  // `explicit` rather than a model host: the operator typed this, so stamping a model that never ran would
  // put a false provenance line on the very card being corrected — `./abandoned.ts`'s own reasoning.
  const supervisor = { host: "explicit" as const, id: operatorId };
  const finalisation = await finaliseIndicators({
    seams: liveIndicatorSeams({
      askIdentity: entry,
      doorLedger: doorLedgerPort(),
      home,
      ...(plan.posted === undefined ? {} : { posted: plan.posted }),
      provenance: { modelId: supervisorModelLabel({ session: supervisor }), supervisor },
      steps: plan.steps,
      task: "answering",
      transport: makeSlackWriteTransport({ home, token: botToken }),
      turnChrome: turnChromeFrom({ chrome: chromeFromProfile({ home }) }),
      turnId: plan.turnId,
    }),
    state: plan.state,
  });
  return finalisation.checklistSettled
    ? finalisation.failures
    : [...finalisation.failures, "the working checklist could not be settled — it may still show unfinished steps"];
}

/**
 * Settle every indicator a now-ignored ask raised, through the SAME seam every other terminal uses.
 *
 * Best-effort in every direction and never a throw, exactly like `./abandoned.ts`: an ask that was never
 * captured, or a home with no Slack bot token, means there is nothing this can correct and the registry
 * write still stands on its own. What it must never do is fail the verb — the ignore itself has already
 * been recorded by the time this runs.
 *
 * @param channel the ask's channel
 * @param home the resolved state home
 * @param messageTs the addressing message's own ts
 * @param reason the operator's own words, shown on the settled card
 * @param report where an indicator that could not be settled is named, one line each
 * @param env the environment to resolve the bot token from — a test asserting "no bot token configured"
 *   injects `{}` here instead of relying on the ambient shell (defaults to `process.env`)
 */
export async function settleIgnoredAskIndicators({
  channel,
  home,
  messageTs,
  reason,
  report,
  env,
}: {
  channel: string;
  home: string;
  messageTs: string;
  reason: string;
  report: (input: { failure: string }) => void;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  const entry = capturedAskFor({ channel, home, messageTs });
  const plan = ignoredAskIndicatorPlan({ entry, messageTs, reason });
  if (plan.kind === "nothing-raised" || entry === undefined) {
    return;
  }
  const botToken = slackBotToken({ home, ...(env !== undefined ? { env } : {}) });
  if (botToken === undefined) {
    report({ failure: "could not settle its indicators — no Slack bot token is configured" });
    return;
  }
  const failures = await settleOneAskIndicatorPlan({ botToken, entry, home, operatorId: "turn ignore", plan });
  for (const failure of failures) {
    report({ failure });
  }
}
