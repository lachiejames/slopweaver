/**
 * What a hand step's `ask:` link joins off the board: the shaped decision its card draws, the message the ask offers,
 * where that message stands while the board holding it is not in hand, and every draft the step or its ask names.
 * Split from `./queueRows.ts`, which folds every register into one list, so that file stays under the 300-line cap.
 */

import type { Board, BoardRow, HandStep } from "../components/live/read";
import type { BoardRowActionRead } from "../components/live/readAction";
import type { LiveState } from "../components/live/useLive";
import { askedOptions } from "./askOffered";
import type { HandDecisionRecord } from "./handCard";
import { askTexts, askThreadUrl } from "./queueAskRow";
import { saidText } from "./queueCard";
import { opensOwnHandStep, queueLinkTarget } from "./queueLink";
import { hint } from "./queueRowFields";
import { type DraftRegister, type NamedDraft, namedDrafts, slackDraftIdsIn } from "./slackDraftIds";

/**
 * The shaped ask a decision hand step opens, joined off the board, with what the panel draws beside it.
 *
 * A decision step must point somewhere for more context and show a draft Slack message attached. So the join carries the ask row itself (its pull requests, its anchor, its
 * doc) and the Slack thread it names. The drafts it names ride the hand ROW ({@link handDrafts}), so a step that
 * names a draft draws it whether or not it opens a shaped ask.
 */
export interface LinkedHandDecision {
  readonly ask: BoardRow;
  /** The ask's shape as the card reads it — its problem, lean and options known present. */
  readonly shape: HandDecisionRecord;
  readonly threadUrl: string | undefined;
}

/**
 * The shaped ask a hand step opens, or `undefined` when it opens none, the board does not hold it, or the ask
 * is not shaped — a problem, a lean and at least two readable options, a blank value counting as none.
 *
 * Deliberately NOT through `ownerAsksOf`: a step can open an ask parked on nobody, which
 * is exactly why the queue listed no row for it and the Open link landed on nothing.
 *
 * @param step the hand step
 * @param rows every board row, unfiltered
 * @returns the join, or `undefined`
 */
export function linkedHandDecision({
  step,
  rows,
}: {
  step: HandStep;
  rows: readonly BoardRow[];
}): LinkedHandDecision | undefined {
  const target = queueLinkTarget({ url: step.url });
  if (target?.kind !== "ask") {
    return undefined;
  }
  const ask = rows.find((row) => row.slug === target.id);
  const problem = saidText({ text: ask?.problem });
  const lean = saidText({ text: ask?.lean });
  if (ask === undefined || problem === undefined || lean === undefined) {
    return undefined;
  }
  const options = askedOptions({ action: ask.action, options: ask.options });
  if (options.length < 2) {
    return undefined;
  }
  return {
    ask,
    shape: {
      blastRadius: saidText({ text: ask.blastRadius }),
      lean,
      options,
      problem,
      risk: saidText({ text: ask.risk }),
      slug: ask.slug,
      stillReal: saidText({ text: ask.stillReal }),
      stillRealIso: ask.stillRealIso,
      summary: ask.summary,
    },
    threadUrl: askThreadUrl({ question: hint({ value: ask.question }), row: ask }),
  };
}

/**
 * Whether a step links nowhere, or only to its own queue card — the one link a carried decision may sit beside.
 *
 * @param step the hand register's row
 * @returns true when no other record could hold the step's choice
 */
function linksOnlyItself({ step }: { step: HandStep }): boolean {
  if (step.url === undefined) {
    return true;
  }
  // Any console origin, as the posting gate reads it: a monitor's self-link carries whatever base it was minted on.
  return opensOwnHandStep({ id: step.id, url: step.url });
}

/**
 * The decision a hand step's card draws: the linked shaped ask when the step opens one, else the decision the
 * step carries in its own record, else none.
 *
 * A carried decision is drawn only on a step that links nowhere but its own card — the posting form's
 * `misplacedDecision` rule (`src/hand/decision.ts`), held here too. A step that also links an ask the board
 * cannot shape would otherwise draw its own choice in place of that ask's.
 *
 * The carried one is a projection, never a synthesis — every field is the register's own, with the step's id as
 * the subject, what it unblocks as the summary and its posting instant as when the stakes were read. No ask
 * alias rides it: there is no ask, so no board row is absorbed.
 *
 * @param linked the shaped ask the step opens, when it opens one
 * @returns the decision, or `undefined` for a step to TAKE — a carried one whose problem or lean is blank included
 */
export function decisionForHand({
  linked,
  step,
}: {
  linked: LinkedHandDecision | undefined;
  step: HandStep;
}): HandDecisionRecord | undefined {
  if (linked !== undefined) {
    return linked.shape;
  }
  const carried = step.decision;
  if (carried === undefined || !linksOnlyItself({ step })) {
    return undefined;
  }
  const problem = saidText({ text: carried.problem });
  const lean = saidText({ text: carried.lean });
  if (problem === undefined || lean === undefined) {
    return undefined;
  }
  return {
    blastRadius: saidText({ text: carried.stakes.blastRadius }),
    lean,
    options: carried.options,
    problem,
    risk: saidText({ text: carried.stakes.risk }),
    slug: step.id,
    stillReal: saidText({ text: carried.stakes.stillReal }),
    stillRealIso: step.postedIso,
    summary: step.unblocks,
  };
}

/**
 * What the ask a hand step opens offers, read off its board row RAW — never through {@link linkedHandDecision}, whose
 * join drops an ask that is not shaped as a decision. `hand post` admits a step talking about a draft as the owner when the
 * ask it opens offers a message, shaped or not (`src/hand/draftAsOwner.ts`), so the card draws that message on the
 * same terms: a join that certified a draft and then drew none would be wrong.
 *
 * @param step the hand step
 * @param rows every board row, unfiltered
 * @returns the ask and its action read, or `undefined` when the step opens no ask or the board holds no such row
 */
export function openedAskAction({
  step,
  rows,
}: {
  step: HandStep;
  rows: readonly BoardRow[];
}): OpenedAskOffer | undefined {
  const target = queueLinkTarget({ url: step.url });
  if (target?.kind !== "ask") {
    return undefined;
  }
  // Two rows may share a slug; the one carrying a message is the one the card draws, so it is preferred.
  const matching = rows.filter((row) => row.slug === target.id);
  const carrying = matching.find((row) => row.action.kind === "action" || row.action.kind === "mail");
  let ask = matching.at(0);
  if (carrying !== undefined) {
    ask = carrying;
  }
  if (ask === undefined) {
    return undefined;
  }
  return { action: ask.action, slug: ask.slug };
}

/**
 * An ISO instant's epoch milliseconds, only when the text is exactly the instant it parses to. `Date.parse` rolls
 * an impossible calendar day over into the next month rather than refusing it, and every producer here stamps with `toISOString`.
 *
 * @param iso the stamped instant
 * @returns the milliseconds, or `undefined` when the text is not an exact instant
 */
function exactInstantMs({ iso }: { iso: string }): number | undefined {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || new Date(ms).toISOString() !== iso) {
    return undefined;
  }
  return ms;
}

/**
 * Where the message a hand step's opened ask offers stands while it is not in hand: being read — a spinner where it
 * goes — or not readable, with why — a staleness mark there. Never a sentence in its place.
 */
export type AskPending = { readonly phase: "reading" } | { readonly phase: "not-measured"; readonly why: string };

/** What a pending ask's spinner or staleness mark names. */
export const ASK_PENDING_SUBJECT = "the message the ask this step opens offers";

/** The board, or a re-read of one that predates the step, is in flight. */
const ASK_READING: AskPending = { phase: "reading" };

/**
 * What a hand card draws in place of the message the ask it opens offers, while the board holding that ask has not
 * been read — arriving, not read at all, or a retained reading still being replaced that does not carry the offer —
 * with the ask's slug, so the step's own `ask:` link reaches the card meanwhile. `undefined` once a current board is
 * read or a retained one already carries the message, and whenever the step opens no ask.
 *
 * A retained reading is `ready` with `refreshing` set, and it may predate the ask: judged as current, it told the owner
 * the draft was missing while the read that holds it was in flight. A reading OBSERVED
 * before the step was posted predates it the same way, and the board is a single read while hands poll, so a
 * step posted with the queue open met that reading forever: it is `stale`, and the page reads the board again
 * (`../components/console/useQueueRows.ts`). "Before" is judged against when the SCAN began, not when the board
 * was stamped: the scan is not atomic, so an ask written during it can be missed by a board stamped after the
 * step. While any doc file did not read, a missing ask is unknown too, never absent: a doc's slug need not be its
 * filename, so which file held it cannot be told.
 *
 * @param step the hand step
 * @param board the board channel, in whatever phase it is in
 * @param offered what the ask offers in the reading in hand, when that reading holds it
 * @returns where the message stands and the ask's slug, or `undefined`
 */
export function askPendingOf({
  step,
  board,
  offered,
}: {
  step: HandStep;
  board: LiveState<Board>;
  offered: OpenedAskOffer | undefined;
}): { pending: AskPending; slug: string; stale: boolean } | undefined {
  const target = queueLinkTarget({ url: step.url });
  if (target?.kind !== "ask") {
    return undefined;
  }
  if (board.phase === "ready") {
    const carries = offered?.action.kind === "action" || offered?.action.kind === "mail";
    if (carries) {
      return undefined;
    }
    if (board.refreshing === true) {
      return { pending: ASK_READING, slug: target.id, stale: false };
    }
    // ANY unreadable file, not only `<slug>.md`: a doc may declare a slug its filename does not carry.
    if (board.value.unreadable.length > 0) {
      const files = board.value.unreadable.join(", ");
      return {
        pending: { phase: "not-measured", why: `the board could not read ${files}, and the message may be in one` },
        slug: target.id,
        stale: false,
      };
    }
    // A board cut before `scanStartedIso` existed bounds what it saw only by its end stamp, the looser claim.
    let seenFrom = board.observedAtIso;
    if (board.value.scanStartedIso !== undefined) {
      seenFrom = board.value.scanStartedIso;
    }
    // Current only when the scan began STRICTLY after the step: a tie in the same millisecond cannot say which came
    // first, and an instant that is not exact proves nothing, so both stay pending.
    const scanMs = exactInstantMs({ iso: seenFrom });
    const stepMs = exactInstantMs({ iso: step.postedIso });
    const scanFollowsStep = scanMs !== undefined && stepMs !== undefined && scanMs > stepMs;
    if (!scanFollowsStep) {
      return { pending: ASK_READING, slug: target.id, stale: true };
    }
    return undefined;
  }
  if (board.phase === "loading") {
    return { pending: ASK_READING, slug: target.id, stale: false };
  }
  return {
    pending: { phase: "not-measured", why: `the board did not read: ${board.why}` },
    slug: target.id,
    stale: false,
  };
}

/** The ask a hand step opens, and what it offers — the slug a mail preview presses with, the action it draws. */
export interface OpenedAskOffer {
  readonly slug: string;
  readonly action: BoardRowActionRead;
}

/**
 * Every draft a hand row names — in the step's own fields, and in the ask it opens when it opens one — resolved.
 *
 * A card asking the owner to react to a Slack draft always shows it. A plain step reading "post
 * draft sd-… when you are happy" is such a card as much as a decision step is, so this does not wait on the join.
 *
 * @param step the hand step
 * @param decision the shaped ask it opens, when it opens one
 * @param posts the parked-draft register, in whatever phase it is in
 * @returns one resolution per id, first named first
 */
export function handDrafts({
  step,
  decision,
  posts,
}: {
  step: HandStep;
  decision: LinkedHandDecision | undefined;
  posts: DraftRegister;
}): readonly NamedDraft[] {
  const texts: (string | undefined)[] = [step.what, step.where, step.unblocks, step.ifIgnored, step.witness];
  if (decision !== undefined) {
    texts.push(...askTexts({ options: decision.shape.options, row: decision.ask }));
  }
  return namedDrafts({ ids: slackDraftIdsIn({ texts }), posts });
}
