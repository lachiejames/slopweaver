/**
 * THE ONE PLACE A TURN STOPS LYING — the finalisation seam every terminal outcome must pass through.
 *
 * ## The class of defect this exists to end
 *
 * A turn raises several LIVE indicators, each of which says "something is happening right now": the
 * `:eyes:` reaction on the tagged message, the working card and its checklist, Slack's native
 * `assistant.threads.setStatus` thinking indicator (plus the re-assert timer that keeps it from timing out
 * mid-work), and — the one that is invisible in Slack but drives every sweep — the durable ask-lifecycle
 * event. Before this module, each of those was cleared by whichever code path happened to reach its own
 * clear call, and the paths did not agree: the ANSWERED path cleared all of them, and every other terminal
 * path cleared some subset of none.
 *
 * Measured on the tag `D0SYN000001`/`1787485240.339229`. The admit door refused
 * `verb:turn.answer` at 13:07:28.170Z with `ANSWER_UNREVIEWED` — a REAL, intended refusal, working exactly
 * as designed — and `offerAnswer` raised `TurnRefusedError`. Nothing caught it between there and the CLI's
 * top-level handler, so:
 *
 *  - `endStatus` was never called, so the native indicator stood until Slack's own 120-second timeout;
 *  - the re-assert timer was never stopped (measured: it re-fired `setStatus` at +100,005 ms and held the
 *    event loop open past +115,003 ms — it is not `unref`'d, so only the CLI's `process.exit` killed it);
 *  - the checklist was never finalised, so the card sat half-ticked FOREVER;
 *  - the reaction was never swapped, so `:eyes:` stood FOREVER;
 *  - no completion and no lifecycle event were recorded, so `turn dispatch --sweep` still reported that ask
 *    as "1 still working" 33 minutes later, and at its lease edge it would have become a
 *    re-judgement candidate — for a turn whose refusal WAS the intended outcome.
 *
 * The owner sees this daily and has to walk to a session and say "nothing landed in that thread". So the
 * fix is not another clear call on another path: it is ONE function, taking ONE terminal vocabulary, that
 * every path calls and none may skip.
 *
 * ## Pure plan, effectful shell
 *
 * {@link indicatorPlanFor} is a total pure function from a terminal state to what each indicator must
 * become — which is what makes "every terminal state finalises every indicator" a property a test can
 * falsify rather than a convention a reviewer has to spot. {@link finaliseIndicators} runs that plan
 * through injected, never-throwing seams and REPORTS what it could not do, because an indicator that could
 * not be settled is exactly the fact a caller must be able to state rather than assume away.
 *
 * ## Idempotent by construction, not by a flag
 *
 * Every step is a SET-TO-A-VALUE, never a toggle or a delta: clear the status, render this exact terminal
 * frame, ensure this exact reaction stands. The plan is a pure function of the state, so a second call
 * writes the same values a second time and converges on the same end state. That matters because the
 * callers are genuinely plural — a turn's own terminal path, a crash handler above it, and a sweep that
 * finds a dispatched ask whose session never came back — and any of them may be the second to arrive.
 */

import { type Result } from "../../lib/result.js";
import type { TurnProgress } from "./answer.js";

/**
 * How a turn ENDED. Eight kinds, and the set is closed on purpose: a path that cannot name its ending in
 * this vocabulary is a path that has not decided whether it ended.
 *
 * - `answered` — the reply is standing in the thread.
 * - `withheld` — the door held the draft; a notice says so and the id names a filed entry.
 * - `refused` — the door refused an outbound write outright (not a withhold), so nothing was sent.
 * - `failed` — the turn broke: the query threw, a seam threw, the session crashed.
 * - `abandoned` — nobody is coming back. A dispatched session died, its lease expired, or it never
 *   reported. The distinction from `failed` is who observed it: `failed` is the turn reporting its own
 *   break, `abandoned` is somebody ELSE finding the turn gone.
 * - `ignored` — the operator put this exact ask on the permanent ignore registry (`slopweaver turn ignore`).
 *   A DECISION rather than a fault, which is why it is its own kind and not `refused`: nothing was refused,
 *   nothing broke, and the reader is owed the operator's reason rather than a door finding. It earns a place
 *   here because ignoring was the one terminal that never reached {@link finaliseIndicators} at all —
 *   measured, two asks ignored after capture kept their capture reaction and their half-ticked
 *   checklist card standing in the owner's own DM indefinitely.
 * - `satisfied` — this ask's CONTENT was already answered, by a reply belonging to a DIFFERENT ask in the
 *   same thread. Not a fault, not a refusal, and not this ask's own answer either: no turn ran for it at all.
 *   It is the only ending besides `answered` that settles to `completion`, because the asker genuinely has
 *   their answer standing in the thread — see `../ask/lifecycle.ts`'s `SatisfiedElsewhereEvent` for the
 *   thread where its absence cost a fourth bot message. Distinct from `triaged`, which settles to
 *   `acknowledged` because nothing was answered.
 * - `triaged` — the turn READ the ask, judged it, and decided nothing was owed in reply. Not a fault, not a
 *   refusal, and emphatically not an answer: the routing decision was `no-response`. It is distinct from
 *   `ignored` in who decided and how far it reaches — `ignored` is the operator putting this ask on a
 *   PERMANENT registry by hand, while `triaged` is the turn's own judgement about this one ask. Measured
 *   twice, across two sessions and two asks, as the last terminal that reached no reaction
 *   at all.
 * - `left-for-a-human` — the turn READ the ask and judged that a reply IS owed but a PERSON should give it,
 *   so the bot stays out. The opposite claim to `triaged` about the asker's message, which is why it settles
 *   to its own `for-a-human` reaction rather than `acknowledged` (the owner's call).
 */
export type TurnTerminalKind =
  | "answered"
  | "withheld"
  | "refused"
  | "failed"
  | "abandoned"
  | "ignored"
  | "triaged"
  | "left-for-a-human"
  | "satisfied";

/**
 * The terminal outcome, and the two clauses it earns — one for each of two audiences that used to share a
 * single field.
 *
 * Measured in the real-world tagging dogfood: a
 * worker's own `turn resume --failed "<reason>"` report — written, by design, in an operator's words for the
 * next session to read — flowed straight through {@link terminalReasonFor} onto the checklist card a
 * colleague was looking at. The channel got an instruction addressed to nobody in the room, naming an
 * internal break-glass environment variable. Splitting the field is the fix: the schema now REQUIRES a
 * caller to state which words are safe to post, rather than relying on every caller (and everything that
 * error message might someday contain) to already be colleague-safe by accident.
 */
export interface TurnTerminalState {
  readonly kind: TurnTerminalKind;
  /**
   * The OPERATOR detail — the door's finding, the error's message, the lease that expired, verbatim. Goes to
   * the durable ask-lifecycle event and the journal, where the next session reads it. Never rendered onto a
   * card or a checklist — see {@link readerReason} for what is.
   */
  readonly reason: string;
  /**
   * What the CARD renders — the sentence a colleague in the thread can read and act on, with no internal
   * machinery in it: no gate name, no break-glass env var, no file path. For most endings this reads the
   * same as {@link reason}, because the door's finding or the sweep's own generated sentence already is
   * colleague-safe; a `failed` ending earns a genuinely different one precisely because its `reason` may be a
   * worker's own operator-facing words, or a thrown error's raw message, neither written with a channel
   * reader in mind. Never empty: a card that says a turn stopped without saying why is the same unactionable
   * message as a card that says nothing.
   */
  readonly readerReason: string;
}

/** How the checklist must be left. `done` ticks every step; `failed` marks the in-flight step with why. */
export type TerminalChecklist =
  { readonly kind: "done"; readonly detail: string } | { readonly kind: "failed"; readonly reason: string };

/**
 * Which reaction must stand on the ORIGINAL tagged message once the turn is over.
 *
 * `stopped` is a distinct emoji rather than "leave the capture one alone", and that IS the fix: `:eyes:`
 * means "seen, working on it", so leaving it over a turn that will never answer is the reaction telling the
 * reader the one thing that is not true. A withheld turn gets `stopped` too — the draft is filed and
 * waiting on a human, which is emphatically not "still working".
 *
 * `acknowledged` is the THIRD ending, and it was added because the two above are not a vocabulary — they
 * are a vocabulary with a hole in it. A turn that judged an ask and correctly owed no reply has no truthful
 * symbol among them: `completion` OVERSTATES, since nothing was answered, and `stopped` understates by
 * rendering as a warning the asker reads as an error to act on. Measured twice, in two
 * different sessions on two different asks; on the second the composing session believed in good faith it
 * had retired its indicators, which is why this had to become a type the code cannot avoid rather than a
 * convention a session is asked to keep. A vocabulary that cannot express an outcome does not prevent that
 * outcome — it just makes every recording of it wrong.
 *
 * `for-a-human` is the FOURTH, for the same reason: `acknowledged` says nothing is owed, so an ask the bot
 * deliberately leaves for a person — a reply IS owed, just not from the bot — had no truthful symbol either.
 * The owner's call, for the whole bot.
 *
 * **These are the TERMINAL vocabulary, and it never says "still working".** The same lesson applies
 * to a state that is not an ending at all: an ask a worker picked up again after a
 * failed dispatch needs the capture emoji put back, and no value here could say so, so the warning stood
 * over a live worker for 43 minutes. That member is `working`, and it lives in
 * `./lifecycleReactions.ts`'s `LifecycleReaction` — a SUPERSET of this type — rather than here. An
 * {@link IndicatorPlan} able to express "still working" would be a turn finalising itself into a claim that
 * it has not finished, which is the whole class this module exists to end.
 */
export type TerminalReaction = "completion" | "stopped" | "acknowledged" | "for-a-human";

/** What each indicator must become for one terminal state. Every field is settled — none is "leave it". */
export interface IndicatorPlan {
  readonly checklist: TerminalChecklist;
  readonly reaction: TerminalReaction;
  /**
   * Always `true`, and typed as the literal rather than `boolean` so the plan cannot express "leave the
   * thinking indicator up". No terminal state does. Clearing also stops the re-assert timer, which is the
   * same call — see `poster.ts`'s `statusLifecycle`.
   */
  readonly clearStatus: true;
}

/**
 * The plan for one terminal state. Pure and total.
 *
 * @param state how the turn ended, and why
 * @returns what every indicator must become
 */
export function indicatorPlanFor({ state }: { state: TurnTerminalState }): IndicatorPlan {
  // `satisfied` shares this branch with `answered` and that IS the decision rather than a convenience: the
  // asker's answer is standing in this thread, so every step this ask needed did happen and `completion` is
  // the only symbol that is true of it. Letting it fall through to the tail below would settle a satisfied
  // ask to `acknowledged` — "noted, nothing owed" — over an ask that was in fact answered.
  if (state.kind === "answered" || state.kind === "satisfied") {
    return {
      checklist: { detail: terminalReaderReasonFor({ state }), kind: "done" },
      clearStatus: true,
      reaction: "completion",
    };
  }
  // `triaged` and `left-for-a-human` split off here and NOWHERE else: the checklist is settled exactly like
  // every other non-answered ending (the steps genuinely did not all run, and the reason belongs on the one
  // that was in flight), while the REACTION is the only thing that differs. Reading either as `stopped` —
  // which is what a two-ending vocabulary forced — puts a warning on an ask that was handled correctly.
  return {
    // READER-facing, never `terminalReasonFor`: the checklist has no fold to hide anything behind — every
    // character on it is immediately visible — so it is the one surface that may only ever carry
    // {@link TurnTerminalState.readerReason}.
    checklist: { kind: "failed", reason: terminalReaderReasonFor({ state }) },
    clearStatus: true,
    reaction: unansweredReaction({ kind: state.kind }),
  };
}

/**
 * The reaction an ending that posted no answer earns: a judged ending its own symbol, anything else the
 * warning. Pure and total.
 *
 * @param kind how the turn ended
 * @returns the terminal reaction to leave standing
 */
function unansweredReaction({ kind }: { kind: TurnTerminalKind }): TerminalReaction {
  if (kind === "triaged") {
    return "acknowledged";
  }
  if (kind === "left-for-a-human") {
    return "for-a-human";
  }
  return "stopped";
}

/**
 * The kind-prefixed clause both {@link terminalReasonFor} and {@link terminalReaderReasonFor} build — pure
 * text assembly, factored out so the two only differ in WHICH field of {@link TurnTerminalState} they read.
 *
 * @param kind how the turn ended
 * @param text the clause to prefix — the operator detail or the reader-facing sentence, depending on caller
 * @returns the prefixed clause, or the bare text for an ending that needs no prefix
 */
function prefixedTerminalClause({ kind, text }: { kind: TurnTerminalKind; text: string }): string {
  switch (kind) {
    case "answered":
      return text;
    case "withheld":
      return `held for review, nothing sent — ${text}`;
    case "refused":
      return `refused by the admit door, nothing sent — ${text}`;
    case "failed":
      return `this turn failed — ${text}`;
    case "abandoned":
      return `this turn was abandoned — ${text}`;
    case "ignored":
      return `this ask is being permanently ignored — ${text}`;
    case "triaged":
      return `read and judged, no reply owed — ${text}`;
    case "left-for-a-human":
      return `read and judged, left for a person to answer — ${text}`;
    case "satisfied":
      return `already answered in this thread — ${text}`;
  }
}

/**
 * The OPERATOR-facing clause — {@link TurnTerminalState.reason}, verbatim, PREFIXED with what kind of ending
 * it was. Only ever safe behind a fold nobody sees without choosing to expand it, exactly as
 * `./failureForm.ts`'s `turnFailureForm` documents its own `reason` parameter ("FOLD only") and the owner's own
 * ruling for that card's index: the technical truth is one click away, deliberately left technical.
 *
 * Never call this for anything rendered with no fold — the working checklist has none, which is why
 * {@link indicatorPlanFor} reaches for {@link terminalReaderReasonFor} instead.
 *
 * @param state how the turn ended, and why
 * @returns the prefixed clause, or the bare operator reason for an ending that needs no prefix
 */
export function terminalReasonFor({ state }: { state: TurnTerminalState }): string {
  return prefixedTerminalClause({ kind: state.kind, text: state.reason });
}

/**
 * The READER-facing clause — {@link TurnTerminalState.readerReason}, PREFIXED with what kind of ending it
 * was. The one function safe to render onto ANY surface a colleague sees unconditionally, fold or no fold —
 * see this file's own header for the incident that made the split necessary.
 *
 * The prefix is the difference between a card a reader can act on and one they have to guess at: "held for
 * review" and "refused by the admit door" and "the session never came back" call for three different next
 * moves, and the bare reason alone does not distinguish them.
 *
 * @param state how the turn ended, and why
 * @returns the prefixed clause, or the bare reader-facing reason for an ending that needs no prefix
 */
export function terminalReaderReasonFor({ state }: { state: TurnTerminalState }): string {
  return prefixedTerminalClause({ kind: state.kind, text: state.readerReason });
}

/**
 * The exact checklist progress a terminal state must leave behind. Pure and total.
 *
 * Two rules, and the second is the one that took measuring to get right:
 *
 *  - `done` jumps `completed` to EVERY step and writes the detail on the last one, regardless of how many
 *   `onPhase` calls actually fired — see `run.ts`'s `finishChecklist` for why trusting the phase count to
 *   have landed there leaves a card stuck showing an earlier step as running forever.
 *  - `failed` pins `completed` to at most `stepCount - 1`. `turnChecklist` renders `progress.failure` on the
 *   step AT `completed`, and a turn whose query fired one `onPhase` per step reaches `completed ===
 *   stepCount` — an index no step occupies, so the reason would render NOWHERE and the card would show every
 *   step ticked green over a turn that never answered. That is the failure mode this whole module exists to
 *   remove, reappearing one layer down.
 *
 * @param checklist how the checklist must be left
 * @param completed how many steps the turn actually finished before it ended
 * @param details the per-step detail clauses the turn accumulated
 * @param stepCount how many steps this tier's checklist has
 * @returns the progress to render — never one whose reason or detail lands on no step
 */
export function terminalChecklistProgress({
  checklist,
  completed,
  details,
  stepCount,
}: {
  checklist: TerminalChecklist;
  completed: number;
  details: readonly (string | undefined)[];
  stepCount: number;
}): TurnProgress {
  if (checklist.kind === "done") {
    const finished = [...details];
    finished[Math.max(0, stepCount - 1)] = checklist.detail;
    return { completed: stepCount, details: finished };
  }
  return {
    completed: Math.max(0, Math.min(completed, stepCount - 1)),
    details,
    failure: checklist.reason,
  };
}

/** A seam's outcome. Never a throw: every indicator is a courtesy the turn's own result must survive. */
export type IndicatorOutcome = Result<void, string>;

/**
 * The live indicators, injected as never-throwing seams.
 *
 * Never-throwing is a CONTRACT here rather than a habit: finalisation runs after the turn has already
 * decided its outcome, so a seam that rejected would turn "the answer posted but its reaction did not" into
 * "the turn failed", which is the class of lie this module exists to end. Each seam reports its own refusal
 * instead, and {@link finaliseIndicators} collects them.
 */
export interface TurnIndicatorSeams {
  /** Clear the native thinking indicator AND stop its re-assert timer. One call does both. */
  readonly endStatus: () => Promise<IndicatorOutcome>;
  /** Render the checklist's terminal frame in place. `false` means the card is genuinely still stuck. */
  readonly settleChecklist: (input: { checklist: TerminalChecklist }) => Promise<boolean>;
  /** Leave exactly this reaction standing on the original tagged message. */
  readonly settleReaction: (input: { reaction: TerminalReaction }) => Promise<IndicatorOutcome>;
}

/** What finalisation actually managed, and every indicator it could not settle. */
export interface IndicatorFinalisation {
  readonly plan: IndicatorPlan;
  /**
   * Whether the working checklist reached its terminal frame. `false` means the card is GENUINELY still
   * stuck showing unfinished steps, with no further attempt made.
   *
   * Reported as its own field rather than folded into {@link IndicatorFinalisation.failures} because the
   * turn's outcome carries it under its own `checklistFailure` — a stuck card is the one indicator failure
   * an operator can go and fix by hand, so it earns a message naming the message to delete rather than a
   * line in a list.
   */
  readonly checklistSettled: boolean;
  /**
   * One line per OTHER indicator that could not be settled, in the order they were attempted. EMPTY means
   * every one of them now tells the truth — which is the only condition under which a caller may say so.
   */
  readonly failures: readonly string[];
}

/**
 * Finalise every live indicator a turn raised, for the way it actually ended.
 *
 * Order is deliberate and is the one thing here worth reading twice: the STATUS goes first, because it is
 * the indicator that costs the reader the most (a thinking indicator over a dead turn is the "it looks like
 * it is working" the owner keeps walking over to report), and because clearing it stops the re-assert timer
 * that would otherwise keep re-raising it. The checklist is next, because it is the durable one. The
 * reaction is last, because it is the cheapest signal and the one the reader consults only when the thread
 * is collapsed.
 *
 * Every seam is attempted regardless of what the ones before it did — a failure to clear the status must
 * never leave the card stuck too, which is precisely what an early return would do.
 *
 * @param seams the live indicators, injected
 * @param state how the turn ended, and why
 * @returns the plan that was applied, and every indicator that could not be settled
 */
export async function finaliseIndicators({
  seams,
  state,
}: {
  seams: TurnIndicatorSeams;
  state: TurnTerminalState;
}): Promise<IndicatorFinalisation> {
  const plan = indicatorPlanFor({ state });
  const failures: string[] = [];
  const status = await seams.endStatus();
  if (status.isErr()) {
    failures.push(`the thinking indicator was not cleared — ${status.error}`);
  }
  const checklistSettled = await seams.settleChecklist({ checklist: plan.checklist });
  const reacted = await seams.settleReaction({ reaction: plan.reaction });
  if (reacted.isErr()) {
    failures.push(`the tag's reaction was not settled to :${plan.reaction}: — ${reacted.error}`);
  }
  return { checklistSettled, failures, plan };
}
