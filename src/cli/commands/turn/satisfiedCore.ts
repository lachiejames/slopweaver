/**
 * The PURE half of `slopweaver turn satisfied` — what settling one already-answered ask must do, decided
 * from the ask's own folded lifecycle and its own durable cards, before anything is written anywhere.
 *
 * The terminal this verb writes is the one the vocabulary was missing. MEASURED on
 * one thread: an ask had its content answered by the turn for a DIFFERENT
 * ask in the same thread, while its own working card had stood for over four hours. Every terminal available to
 * it posted something, so it posted a fourth bot message into a thread that was finished to
 * every person reading it. `../../../live/ask/lifecycle.ts`'s `SatisfiedElsewhereEvent` carries the rest.
 *
 * ## The two refusals, and why the second is the load-bearing one
 *
 * `--answered-by-ts` is a POINTER, and a pointer that can name anything proves nothing. Naming the ask's own
 * message is the cheap mistake. Naming one of the ask's OWN cards — its working checklist, or the failure
 * notice a broken turn posted — is the one that would otherwise pass review: it looks like a timestamp in
 * the right thread, and it would let an ask be pointed at its own half-ticked card and called satisfied.
 * Both are refused here, off {@link satisfiedElsewherePlan}'s inputs, so neither reaches a Slack call.
 *
 * Pure on purpose, in the shape `./ignoreIndicators.ts` and `./triagedIndicators.ts` already hold: every
 * judgement is a total function of records in, and `./satisfied.ts` is the thin shell that reads those
 * records, performs the effects and reports.
 */
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import type { AskLifecycle } from "../../../live/ask/lifecycle.js";
import { PENDING_ROUTE_STEPS, turnStepsForTier } from "../../../live/turn/answer.js";
import type { TurnTerminalState } from "../../../live/turn/indicators.js";
import type { PostedRef } from "../../../live/turn/runContract.js";

/**
 * What settling one satisfied ask must do.
 *
 * Four arms rather than a `Result`, because three of them are not failures of FACT and the caller renders
 * each differently: two are refusals the operator must correct, one is a no-op that exits "expected empty",
 * and only `settle` does anything. `../../../.claude/rules/error-handling.md`'s threshold is what keeps this
 * a local union rather than a domain error — nothing outside this module branches on it.
 */
export type SatisfiedAskPlan =
  /** The listener never captured this ask, so it raised no indicator and posted no card — nothing to settle. */
  | { readonly kind: "nothing-raised" }
  /** A terminal `satisfied-elsewhere` is already folded in. A second pass writes nothing. */
  | { readonly kind: "already-satisfied"; readonly answeredByTs: string }
  /** The pointer does not name an answer — it names this ask, or a card this ask itself posted. */
  | { readonly kind: "not-an-answer"; readonly why: string }
  | {
      readonly kind: "settle";
      /**
       * The ask's own full identity, carried OUT of the plan rather than rebuilt by the caller.
       *
       * `threadTs` exists only on the fold, and the shell has no honest way to supply it — reconstructing
       * one from `messageTs` is exactly the guess `../../../live/ask/identity.ts` exists to forbid.
       */
      readonly askIdentity: AskIdentity;
      /** Every card this ask published that is not a real answer — reaped, oldest first, before the terminal. */
      readonly cards: readonly PostedRef[];
      readonly state: TurnTerminalState;
      readonly steps: readonly { readonly id: string; readonly title: string }[];
      readonly turnId: string;
    };

/** The four values this verb cannot run without, once every one of them is present. */
export interface SatisfiedAskArgs {
  readonly answeredByTs: string;
  readonly channel: string;
  readonly messageTs: string;
  readonly reason: string;
}

/** The one arm of {@link SatisfiedAskPlan} that performs anything — named so the shell can take only it. */
export type SatisfiedSettlePlan = Extract<SatisfiedAskPlan, { kind: "settle" }>;

/** Every arm that performs nothing, so the reporting half cannot be handed one that does. */
export type SatisfiedRefusedPlan = Exclude<SatisfiedAskPlan, { kind: "settle" }>;

/**
 * Every required flag, or the names of the ones absent. Pure, and the reason it is a function rather than four
 * `undefined` checks at the call site: the refusal has to name EVERY missing flag in one pass, so an operator
 * who forgot two is told about two. The compound guard that did this inline read every value twice — once to
 * build the list and once to convince the compiler — and was the single largest contributor to the verb
 * shell's branch count.
 *
 * @param answeredByTs the `--answered-by-ts` pointer, unvalidated here — {@link satisfiedElsewherePlan} judges it
 * @returns the four values when all are present, else the flag names to report
 */
export function satisfiedArgsFrom({
  answeredByTs,
  channel,
  messageTs,
  reason,
}: {
  answeredByTs: string | undefined;
  channel: string | undefined;
  messageTs: string | undefined;
  reason: string | undefined;
}): { readonly kind: "missing"; readonly flags: readonly string[] } | ({ readonly kind: "ready" } & SatisfiedAskArgs) {
  const flags = [
    channel === undefined ? "--channel" : undefined,
    messageTs === undefined ? "--message-ts" : undefined,
    answeredByTs === undefined ? "--answered-by-ts" : undefined,
    reason === undefined ? "--reason" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  if (channel === undefined || messageTs === undefined || answeredByTs === undefined || reason === undefined) {
    return { flags, kind: "missing" };
  }
  return { answeredByTs, channel, kind: "ready", messageTs, reason };
}

/**
 * The card-facing sentence a satisfied ask's own indicators carry.
 *
 * One clause on both `reason` and `readerReason`, exactly as `./ignoreIndicators.ts` and
 * `./triagedIndicators.ts` reason about theirs: the operator composed it knowing where it lands, and there
 * is no internal machinery in "already answered above" to keep off a colleague's screen. In practice the
 * card is deleted before the settle runs, so this is what survives only when a delete could not be confirmed
 * — which is precisely the case a reader must still be able to act on.
 *
 * @param answeredByTs the message already answering this ask
 * @param reason why that answer satisfies this ask, in the deciding session's own words
 * @returns the clause both terminal fields carry
 */
export function satisfiedReasonFor({ answeredByTs, reason }: { answeredByTs: string; reason: string }): string {
  return `${reason} (the answer is at ts ${answeredByTs})`;
}

/**
 * What a `satisfied-elsewhere` terminal must settle, from the ask's fold and its own cards. Pure and total.
 *
 * The step list matters even though the cards are normally deleted before anything renders one: a delete
 * Slack declined leaves a card standing, and settling against the wrong list writes the reason onto a step
 * index the card does not have — the off-by-a-step `terminalChecklistProgress` documents, reappearing one
 * caller up. A DISPATCHED ask's card was re-rendered with its tier's own steps; anything earlier still wears
 * the capture-time `PENDING_ROUTE_STEPS`.
 *
 * @param answeredByTs the message claimed to already answer this ask
 * @param cards every card this ask published, from `../../../live/turn/earlierCards.ts` — the pointer is
 *   refused when it names one of them
 * @param entry the folded ask, or `undefined` when it was never captured
 * @param reason why that answer satisfies this ask, in the deciding session's own words
 * @returns what to settle, or which of the three non-settling answers applies
 */
export function satisfiedElsewherePlan({
  answeredByTs,
  cards,
  entry,
  reason,
}: {
  answeredByTs: string;
  cards: readonly PostedRef[];
  entry: AskLifecycle | undefined;
  reason: string;
}): SatisfiedAskPlan {
  if (entry === undefined) {
    return { kind: "nothing-raised" };
  }
  if (entry.lastEvent.kind === "satisfied-elsewhere") {
    return { answeredByTs: entry.lastEvent.answeredByTs, kind: "already-satisfied" };
  }
  if (answeredByTs === entry.messageTs) {
    return {
      kind: "not-an-answer",
      why: "it names the ask's own message — an ask cannot be the answer to itself",
    };
  }
  if (cards.some((card) => card.ts === answeredByTs)) {
    return {
      kind: "not-an-answer",
      why: "it names a card this ask itself posted — a working checklist or a failure notice is not an answer",
    };
  }
  const clause = satisfiedReasonFor({ answeredByTs, reason });
  const started = entry.started;
  // Spelled as an `if`-shaped conditional rather than `??`: `no-silent-fallback` refuses the coalesce, and
  // the substitution is worth saying out loud anyway — an ask with no capture checklist has no turn id, so
  // the correlation id the door ledger carries is minted from the ask itself.
  const turnId = started === undefined ? `satisfied-${entry.messageTs}` : started.turnId;
  return {
    askIdentity: askIdentityOf({ source: entry }),
    cards,
    kind: "settle",
    state: { kind: "satisfied", readerReason: clause, reason: clause },
    steps:
      entry.lastEvent.kind === "dispatched" ? turnStepsForTier({ tier: entry.lastEvent.tier }) : PENDING_ROUTE_STEPS,
    turnId,
  };
}
