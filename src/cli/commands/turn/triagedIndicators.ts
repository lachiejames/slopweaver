/**
 * Settling the live indicators of an ask a turn JUDGED and owed no reply.
 *
 * The fourth caller of `../../../live/turn/indicators.ts`, beside a turn's own terminal path, the sweep's
 * `./abandoned.ts` and `./ignoreIndicators.ts`. `no-response` was the last terminal that reached that seam
 * at all: `./dispatch.ts`'s `handleNoResponse` recorded its intent, deleted the capture checklist and
 * appended the terminal `triaged-no-response` — and never touched the capture REACTION, so a correctly
 * handled ask went on wearing `:eyes:` forever. Its own docstring named the gap as a deliberate
 * `TODO(owner)`; this is that TODO, answered.
 *
 * Measured twice, and the second sighting is why this is code rather than a convention:
 *
 *  - The owner spotted a stale reaction on one of their own asks that had been fulfilled, and had to
 *    hand-settle it.
 *  - Later, a DIFFERENT session on a DIFFERENT ask reproduced it
 *    exactly. That session believed in good faith that it had retired its indicators. The defect is
 *    INVISIBLE FROM THE INSIDE, so no amount of asking a session to remember could have fixed it.
 *
 * ## Why this settles only the reaction in practice
 *
 * It hands `finaliseIndicators` no `posted` ref, and that is correct rather than lazy. `handleNoResponse`
 * DELETES the capture checklist before it ever gets here — that ordering is load-bearing and documented
 * where it lives — so by the time this runs there is no card to correct. `liveIndicatorSeams` already
 * treats an absent `posted` as "settled, nothing standing", so the whole seam is still the one every other
 * terminal uses; it simply finds one of the three indicators already gone.
 *
 * Going through the shared seam anyway, rather than reaching for `settleLifecycleReaction` directly, is the
 * point: the assistant status and its re-assert timer are cleared by the same call, and a fifth indicator
 * added to `TurnIndicatorSeams` later is settled here without this file being edited. A path that settles
 * "the one indicator I know about" is the exact per-call-site shape `../../../live/turn/lifecycleReactions.ts`
 * records as the original defect.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import type { AskLifecycle } from "../../../live/ask/lifecycle.js";
import { capturedAskFor } from "../../../live/ask/store.js";
import { PENDING_ROUTE_STEPS, turnStepsForTier } from "../../../live/turn/answer.js";
import { finaliseIndicators, type TurnTerminalKind, type TurnTerminalState } from "../../../live/turn/indicators.js";
import { liveIndicatorSeams } from "../../../live/turn/poster.js";
import { supervisorModelLabel } from "../../../supervisor/session.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";

/** The two endings a judging session can settle an ask to without posting anything. */
export type JudgedEnding = Extract<TurnTerminalKind, "triaged" | "left-for-a-human">;

/**
 * What settling one triaged ask must do: nothing at all when the listener never captured it, or the exact
 * terminal state and checklist steps every other terminal path hands `finaliseIndicators`.
 */
export type TriagedAskIndicatorPlan =
  | { readonly kind: "nothing-raised" }
  | {
      readonly kind: "settle";
      readonly state: TurnTerminalState;
      readonly steps: readonly { readonly id: string; readonly title: string }[];
      readonly turnId: string;
    };

/**
 * What a `no-response` terminal must settle, from the ask's folded lifecycle. Pure and total.
 *
 * The same two decisions `./ignoreIndicators.ts` makes, for the same reasons, and deliberately NOT shared
 * with it: an ask with no fold entry raised no indicator, so there is nothing to correct and inventing a
 * reaction on a message the bot never touched would be manufacturing a signal rather than correcting one;
 * and a DISPATCHED ask's card was re-rendered with its tier's own steps while anything earlier still wears
 * the capture-time `PENDING_ROUTE_STEPS`.
 *
 * The step list still matters even though this path normally finds the card already deleted. A delete that
 * Slack declined leaves `handleNoResponse` at the non-terminal `triage-cleanup-intended` and this is never
 * reached — but a fold whose `started` was never durably recorded reaches here with a card that may still
 * be standing, and settling against the wrong list writes the reason onto a step index the card does not
 * have.
 *
 * `ending` is the judged ending this settles to — `triaged` (nothing owed, `:ack:`) or `left-for-a-human`
 * (a person should answer, `:for-a-human:`). Required rather than defaulted: a default would settle a
 * for-a-human ask to "nothing owed" whenever a caller forgot it, the one misreading that ending exists to stop.
 *
 * @param entry the folded ask, or `undefined` when it was never captured
 * @param messageTs the addressing message's own ts, for the fallback correlation id
 * @param reason the turn's own rationale for its judgement, shown wherever the card survived
 * @returns what to settle, or that nothing was ever raised
 */
export function triagedAskIndicatorPlan({
  ending,
  entry,
  messageTs,
  reason,
}: {
  ending: JudgedEnding;
  entry: AskLifecycle | undefined;
  messageTs: string;
  reason: string;
}): TriagedAskIndicatorPlan {
  if (entry === undefined) {
    return { kind: "nothing-raised" };
  }
  return {
    kind: "settle",
    // The turn composed this rationale knowing it is card-facing (see this function's own `@param reason`),
    // so it stays the same clause on both fields.
    state: { kind: ending, readerReason: reason, reason },
    steps:
      entry.lastEvent.kind === "dispatched" ? turnStepsForTier({ tier: entry.lastEvent.tier }) : PENDING_ROUTE_STEPS,
    turnId: triagedTurnId({ entry, messageTs }),
  };
}

/**
 * The correlation id a judged ending settles under: the turn id the listener minted at capture, or one named
 * for the triage itself when no checklist was ever posted for the ask.
 *
 * @param entry the folded ask
 * @param messageTs the addressing message's own ts
 * @returns the turn id
 */
function triagedTurnId({ entry, messageTs }: { entry: AskLifecycle; messageTs: string }): string {
  const started = unsetFieldAsNull({ key: "started", record: entry });
  if (started === null) {
    return `triaged-${messageTs}`;
  }
  return started.turnId;
}

/**
 * Settle every indicator a now-triaged ask raised, through the SAME seam every other terminal uses.
 *
 * Best-effort in every direction and never a throw, exactly like `./ignoreIndicators.ts` and
 * `./abandoned.ts`: an ask that was never captured, or a home with no Slack bot token, means there is
 * nothing this can correct. What it must never do is fail the verb — the `triaged-no-response` lifecycle
 * event has already been appended by the time this runs, and turning a settled reaction into a non-zero
 * exit would report the JUDGEMENT as failed when only its chrome was.
 *
 * @param channel the ask's channel
 * @param ending which judged ending to settle to — see {@link triagedAskIndicatorPlan}
 * @param home the resolved state home
 * @param messageTs the addressing message's own ts
 * @param reason the turn's own rationale for its judgement
 * @param report where an indicator that could not be settled is named, one line each
 * @param env the environment to resolve the bot token from — a test asserting "no bot token configured"
 *   injects `{}` here instead of relying on the ambient shell (defaults to `process.env`)
 */
export async function settleTriagedAskIndicators({
  channel,
  ending,
  home,
  messageTs,
  reason,
  report,
  env,
}: {
  channel: string;
  ending: JudgedEnding;
  home: string;
  messageTs: string;
  reason: string;
  report: (input: { failure: string }) => void;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  const entry = capturedAskFor({ channel, home, messageTs });
  const plan = triagedAskIndicatorPlan({ ending, entry, messageTs, reason });
  if (plan.kind === "nothing-raised" || entry === undefined) {
    return;
  }
  const botToken = slackBotToken({ home, ...(env !== undefined ? { env } : {}) });
  if (botToken === undefined) {
    report({ failure: "could not settle its indicators — no Slack bot token is configured" });
    return;
  }
  // `explicit` rather than a model host, exactly as `./ignoreIndicators.ts` reasons: the routing decision
  // was recorded by a session, but stamping a model that never composed anything would put a false
  // provenance line on the very indicators being corrected.
  const supervisor = { host: "explicit" as const, id: "turn dispatch no-response" };
  const finalisation = await finaliseIndicators({
    seams: liveIndicatorSeams({
      askIdentity: entry,
      doorLedger: doorLedgerPort(),
      home,
      provenance: { modelId: supervisorModelLabel({ session: supervisor }), supervisor },
      steps: plan.steps,
      task: "answering",
      transport: makeSlackWriteTransport({ home, token: botToken }),
      turnChrome: turnChromeFrom({ chrome: chromeFromProfile({ home }) }),
      turnId: plan.turnId,
    }),
    state: plan.state,
  });
  for (const failure of finalisation.failures) {
    report({ failure });
  }
}
