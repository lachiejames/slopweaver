/**
 * One action item flattened to what is worth saying out loud, and the flattening, with the workspace mark and triage
 * pill the page draws on the row. Split out of `./talkActionItems.ts`, which builds the answer from them.
 */

import type { QueueRow } from "./queueRows";
import { markInView } from "./queueStopping";
import { cardRefusal } from "./queueVoice";
import { parksTheCard, triagePillWords } from "./triageWords";
import { TIER_WORDS, type WaitingTier } from "./waitingRank";
import type { WorkspacePlacement } from "./workspacePlacementBasis";

/** One action item, flattened to what is worth saying out loud. */
export interface SpokenItem {
  readonly key: string;
  readonly kind: string;
  readonly pill: string;
  readonly question: string;
  readonly subject: string;
  /** What is actually undecided — `undefined` wherever the register records none. */
  readonly problem: string | undefined;
  /** Why it is the owner's —`undefined` on a card that draws none: a hand step, an ask, a draft. */
  readonly whyYou: string | undefined;
  /** The verb's recommendation — `undefined` wherever no verb makes one. */
  readonly lean: string | undefined;
  /** What happens if the owner does nothing — `undefined` on an ask or a hand step. */
  readonly ifSilent: string | undefined;
  /** What the step unblocks, in its own words — `undefined` on every register but the hands one. */
  readonly unblocks: string | undefined;
  readonly whenIso: string | undefined;
  /** Where it ranks: blocking a colleague, blocking the fleet, or a check-in. */
  readonly tier: WaitingTier;
  /** The tier in words the model can say, so a check-in is never spoken as waiting work. */
  readonly tierWords: string;
  /** Why the panel refused to draw this card, when it did — its decision, unblocks and fields are then absent. */
  readonly refused: string | undefined;
  /**
   * The workspace mark the page draws on this row, and what it rests on: `placed by default: no workspace` or
   * `placed by default: workspace conflict` on a finding, and `stated over a conflict` on a row a stated workspace placed;
   * led by whose card it is on a stopping card this view draws though it is another workspace's. `undefined` on a row
   * of this view its fields place plainly.
   */
  readonly workspaceMark: string | undefined;
  /**
   * The owner's triage ruling on a card they parked, in the words of the pill the Queue draws on it ("Parked, working
   * session · waiting on them"); `undefined` on a card the owner has not parked.
   */
  readonly parked: string | undefined;
}

/**
 * Flatten one projected row to what is worth saying, with the workspace mark the page draws on it — and, on a stopping
 * card this view draws though it is another workspace's, whose card it is, as the row and its open panel say.
 *
 * @param row the projected queue row
 * @param shows the view's own filter over a row's placement, which says whether a stopping card is drawn here only
 *   because it stops the owner's work (`stoppingElsewhere`, `./queueStopping.ts`)
 * @returns the spoken item
 */
export function spokenOf({
  row,
  shows,
}: {
  row: QueueRow;
  shows: (row: { readonly placement: WorkspacePlacement }) => boolean;
}): SpokenItem {
  const mark = markInView({ row, shows });
  let workspaceMark: string | undefined;
  if (mark !== undefined) {
    workspaceMark = `${mark.label} · ${mark.title}`;
  }
  // Only a park is said as one: a recut carrying the owner's `rewrite` is still being worked.
  let parked: string | undefined;
  if (row.triage !== undefined && parksTheCard({ verdict: row.triage.verdict })) {
    parked = triagePillWords({ triage: row.triage });
  }
  return { ...spokenFields({ row }), parked, workspaceMark };
}

/** {@link spokenOf} before its workspace mark: the card's own fields, flattened. */
function spokenFields({ row }: { row: QueueRow }): Omit<SpokenItem, "parked" | "workspaceMark"> {
  const card = row.card;
  if (card.kind === "step") {
    // A refused card is said as its own sentence and nothing else: its decision and rows are what was refused.
    let decision = card.decision;
    let unblocks = card.rows.find((one) => one.label === "unblocks")?.value;
    let ifSilent = card.rows.find((one) => one.label === "if you do nothing")?.value;
    const refused = cardRefusal({ row });
    if (refused !== undefined) {
      decision = undefined;
      unblocks = undefined;
      ifSilent = undefined;
    }
    return {
      ifSilent,
      key: row.key,
      kind: row.kind,
      lean: decision?.lean,
      pill: row.pill,
      problem: decision?.problem,
      question: card.question,
      refused,
      subject: card.subject,
      tier: row.tier,
      tierWords: TIER_WORDS[row.tier].spoken,
      unblocks,
      whenIso: row.whenIso,
      whyYou: undefined,
    };
  }
  const refused = cardRefusal({ row });
  if (refused !== undefined) {
    return {
      ifSilent: undefined,
      key: row.key,
      kind: row.kind,
      lean: undefined,
      pill: row.pill,
      problem: undefined,
      question: card.question,
      refused,
      subject: card.subject,
      tier: row.tier,
      tierWords: TIER_WORDS[row.tier].spoken,
      unblocks: undefined,
      whenIso: row.whenIso,
      whyYou: undefined,
    };
  }
  return {
    ifSilent: card.ifSilent,
    kind: row.kind,
    key: row.key,
    lean: card.lean,
    pill: row.pill,
    problem: card.problem,
    question: card.question,
    refused: undefined,
    subject: card.subject,
    tier: row.tier,
    tierWords: TIER_WORDS[row.tier].spoken,
    unblocks: undefined,
    whenIso: row.whenIso,
    whyYou: card.whyYou,
  };
}
