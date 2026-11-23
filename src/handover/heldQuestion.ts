/**
 * The question a run's current cycle holds, and the one journal line that may give an UNSHAPED one its shape.
 *
 * Its own module rather than `./ledger.ts` because that file is the event vocabulary and the phase fold, and this is
 * the CARD fold's entry point, read by the board, `handover ask`'s reshape path and the row write guard alike —
 * whose reshape refusal lives here too, beside the fold it reads.
 */

import type { AskOption, AskStakes } from "./askShape.js";
import { currentCycle, type RunEvent, type RunState } from "./ledger.js";
import {
  inheritedOpen,
  inheritedQuestion,
  type OpenQuestion,
  openQuestionAfter,
  type QuestionRestatingEvent,
  reshapeBinds,
} from "./openQuestion.js";
import { type RowWriteError, RowWriteErrors } from "./rowEventErrors.js";
import { type RulingIdentity, rulingDecisionOrder, rulingIdentityOf } from "./ruling.js";

/**
 * A SHAPE given to a question that was recorded without one — `handover ask` on a run already waiting on an
 * unshaped question.
 *
 * Its own kind rather than a second `question` for the reason `question-offered` is: re-asking would reset the
 * asked instant, and a question waiting since before the shape was required is exactly as old as it was. It
 * replaces the TEXT and the SHAPE together, because a shape describes a decision and the free-text question it
 * replaces rarely states one, and it binds to the held text it names in `replaces`. It applies ONLY to a held
 * question carrying no shape and no draft: a shaped ask is changed with `handover correct` or `handover offer`,
 * never replaced, and every fold holds that rule for a line no verb wrote (`./openQuestion.ts`, `reshapeBinds`).
 */
export interface QuestionShapedEvent {
  readonly kind: "question-shaped";
  readonly atIso: string;
  readonly question: string;
  readonly replaces: string;
  readonly problem: string;
  readonly options: readonly AskOption[];
  readonly lean: string;
  readonly stakes: AskStakes;
  /** The re-cut question's concrete scenes, written on this line with it — see `question`'s own field. */
  readonly examples?: readonly string[];
  readonly exampleGap?: string;
}

/**
 * The question the current cycle holds, with everything a card reads about it — the ONE fold over a journal that
 * the board, `handover ask`'s reshape path and the row write guard all read, so none of them re-derives it.
 *
 * A question the previous cycle closed still holding — reaped, or started over — is still open, the same carry
 * `runStateOf` reads. It carries its ORIGINAL `atIso`: a reap or a re-start never asks the question again. This does
 * not ask whether the cycle has since CLOSED; a caller wanting a waiting run asks the phase first.
 *
 * @param events the journal's events, in order
 * @returns the held question, or `undefined` when the current cycle holds none
 */
export function heldQuestion({ events }: { events: readonly RunEvent[] }): OpenQuestion | undefined {
  const inherited = inheritedQuestion({ events });
  let open = inherited === undefined ? undefined : inheritedOpen({ inherited });
  for (const event of currentCycle({ events })) {
    open = openQuestionAfter({ event, open });
  }
  return open;
}

/**
 * The rulings journalled AFTER the line that last restated the question — a correction, a reshape or an offer —
 * the only ones that can answer what is asked now, since every ruling before it was what the question was restated
 * FROM (`./ownerWait.ts`, `answeringRuling`).
 *
 * By journal POSITION, never by stamp: a writer stamps its line before it appends it, and a console landing scans
 * the whole board in between, so a ruling appended after a restatement can carry the earlier instant. The
 * line is found by identity in the same `events` it was folded from; a line that is not there yields none, which
 * keeps the row the owner's — the direction `ownerWait.ts`'s unparseable instant already takes.
 *
 * @param events the journal's events, in order — the array {@link heldQuestion} folded `restatement` out of
 * @param restatement the latest line that restated the held question
 * @returns the identities of the rulings journalled after it, in journal order
 */
export function rulingsAfterRestatement({
  events,
  restatement,
}: {
  events: readonly RunEvent[];
  restatement: QuestionRestatingEvent;
}): readonly RulingIdentity[] {
  return rulingsAfterLine({ events, line: restatement });
}

/**
 * The journal's LATEST question, whether or not it is still held, and the rulings that could have answered it —
 * what dates a SETTLED ask's departure from the owner's Queue (`../cli/commands/handover/listJsonSettlement.ts`), which
 * reads no waiting disposition once the question is answered. It applies the waiting arm's own test
 * (`./ownerWait.ts`, `answeringRuling`), so the two agree on which rulings can answer: decided at or after that
 * question's instant, which a restatement never moves, and journalled after its latest correction, reshape or offer
 * when one restated it. Without it, a ruling a restatement folded would be published as the one that took the restated
 * card off, and so would a ruling that answered an EARLIER question on the same row.
 *
 * The same fold {@link heldQuestion} runs, over the whole journal: a fresh `question` starts over, and each binding
 * restatement of the question it holds moves the line; an answer clears the held question but not the line.
 *
 * @param events the journal's events, in order
 * @returns when the latest question was asked and the rulings that could answer it in journal order, or
 * `undefined` when the journal never asked a question
 */
export function rulingsSinceLatestAsk({
  events,
}: {
  events: readonly RunEvent[];
}): { readonly askedIso: string; readonly rulings: readonly RulingIdentity[] } | undefined {
  let open: OpenQuestion | undefined;
  let asked: RunEvent | undefined;
  let restated: RunEvent | undefined;
  for (const event of events) {
    open = openQuestionAfter({ event, open });
    if (event.kind === "question") {
      asked = event;
      restated = undefined;
    }
    if (open?.restatedBy !== undefined) {
      restated = open.restatedBy;
    }
  }
  if (asked === undefined) {
    return undefined;
  }
  if (restated === undefined) {
    return { askedIso: asked.atIso, rulings: rulingsIn({ events }) };
  }
  return { askedIso: asked.atIso, rulings: rulingsAfterLine({ events, line: restated }) };
}

/**
 * The ruling the owner already gave on a question that has since been asked again in exactly the same words — what
 * `talk restore` writes when it re-asks a landed ask (`../cli/commands/talk/cardRestoreApply.ts`). The later asking
 * moves `askedIso` past the ruling, so nothing after the card's floor answers it, and their Queue ranked it first as
 * never answered: one row was ruled and then restored a day later. Repro, on a row so restored:
 * `grep -o '"kind":"[a-z-]*"' $SLOPWEAVER_HOME/runs/<slug>.jsonl` prints its ruling before its second `question`.
 *
 * A ruling counts only when the question it was given under was held in the same text at that moment — a correction
 * swaps its words in — whatever was asked or restated between that ruling and the re-ask. By journal POSITION, as
 * {@link rulingsAfterRestatement} reads; among several, the latest DECISION wins, a tie going to the later line. A
 * decision instant that will not parse is never one, so an uncertain card stays the owner's. A hand re-ask in the
 * same words reads the same, BY DESIGN: whoever re-asked it, it is the stale card the owner ruled out, and a re-ask
 * that needs them again says what changed, so its words differ. `handover ask` refuses one up front (`./ruledReaskGate.ts`).
 *
 * @param askedIso the later asking's own instant, which the card's floor is measured from
 * @param question the exact question text the card asks
 * @returns the ruling, or `undefined` when no earlier asking of the same words was ruled on
 */
export function rulingBeforeRepeatedQuestion({
  askedIso,
  events,
  question,
}: {
  askedIso: string;
  events: readonly RunEvent[];
  question: string;
}): RulingIdentity | undefined {
  const later = sameWordsAskingIndex({ askedIso, events, question });
  let open: OpenQuestion | undefined;
  let found: { readonly identity: RulingIdentity; readonly orderMs: number } | undefined;
  for (const event of events.slice(0, Math.max(later, 0))) {
    // The text the question is held under NOW: a correction swaps it in, so a ruling on the corrected words
    // counts for a re-ask of those words, and one on any other words never does.
    if (event.kind === "ruling" && open?.question === question) {
      const orderMs = rulingDecisionOrder({ event });
      // A backfilled ruling can be appended under this question while its decision predates the asking: it was
      // given while another question was held, so it never answers this one.
      const decidedWhileHeld = orderMs >= Date.parse(open.askedIso);
      if (Number.isFinite(orderMs) && decidedWhileHeld && (found === undefined || orderMs >= found.orderMs)) {
        found = { identity: rulingIdentityOf({ event }), orderMs };
      }
    }
    // Nothing asked or restated since clears it: a re-ask that needs the owner again says what changed, so its words
    // differ, and the same words after any other question are still the question they ruled on.
    open = openQuestionAfter({ event, open });
  }
  return found?.identity;
}

/**
 * Where the later asking of these exact words sits in the journal: its own `question` line, or a `question-shaped`
 * line in the same words after it — `handover ask`'s reshape path re-asks without moving `askedIso`, so a ruling
 * journalled between that path's last re-read and its append would otherwise sit AFTER the only line found (Codex
 * r3-restore-02, ninth pass). `-1` when no asking at `askedIso` carries these words.
 */
function sameWordsAskingIndex({
  askedIso,
  events,
  question,
}: {
  askedIso: string;
  events: readonly RunEvent[];
  question: string;
}): number {
  const asking = events.findLastIndex((event) => event.kind === "question" && event.atIso === askedIso);
  const asked = events.findLastIndex(
    (event) => event.kind === "question" && event.atIso === askedIso && event.question === question,
  );
  if (asking < 0) {
    return asked;
  }
  const reshaped = events.findLastIndex(
    (event, index) => index > asking && event.kind === "question-shaped" && event.question === question,
  );
  return Math.max(asked, reshaped);
}

/** The rulings journalled after one line, found by identity in the array it came from — none when it is not there. */
function rulingsAfterLine({
  events,
  line,
}: {
  events: readonly RunEvent[];
  line: RunEvent;
}): readonly RulingIdentity[] {
  const at = events.indexOf(line);
  return rulingsIn({ events: at === -1 ? [] : events.slice(at + 1) });
}

/** Every ruling among `events`, in journal order. */
function rulingsIn({ events }: { events: readonly RunEvent[] }): readonly RulingIdentity[] {
  return events.flatMap((event) => (event.kind === "ruling" ? [rulingIdentityOf({ event })] : []));
}

/**
 * The row write guard's refusal of a reshape the folds would ignore — a line claiming a card changed when none did.
 * It binds by the SAME rule they read: the waiting question's exact text, carrying no shape and no draft.
 *
 * @param events the journal's events so far, which the new one would follow
 * @param state the run's derived state over those events
 * @returns the refusal, or `undefined` for any other kind and for a reshape that binds
 */
export function unboundReshape({
  event,
  events,
  state,
}: {
  event: RunEvent;
  events: readonly RunEvent[];
  state: RunState;
}): RowWriteError | undefined {
  if (event.kind !== "question-shaped") {
    return undefined;
  }
  const held = state.phase === "waiting-on-owner" ? heldQuestion({ events }) : undefined;
  if (held !== undefined && reshapeBinds({ event, held })) {
    return undefined;
  }
  return RowWriteErrors.forbiddenTransition({
    kind: event.kind,
    phase: state.phase,
    why: "the question it replaces is not the one waiting, or that one already carries a shape or a draft — `handover correct` restates a shaped ask, `handover offer` replaces its shape",
  });
}
