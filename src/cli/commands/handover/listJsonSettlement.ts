/**
 * What a published board row says about how its ask ENDED — the settle, its witness, when it was written, and the
 * ruling that took the ask off the owner's Queue first when they made one. Split out of `./listJson.ts` (the file-size
 * ratchet) along that seam, as `./listJsonWait.ts` holds the owner-wait half.
 *
 * Published so the console voice can still find an ask after it leaves the owner's Queue, and say when and why: an
 * ask removed from the Queue stays visible to the voice.
 */

import type { BoardModel } from "../../../handover/boardTypes.js";
import type { RulingIdentity } from "../../../handover/ruling.js";

/** The settlement fields one published row carries. */
export interface PublishedSettlement {
  /**
   * How a settled ask ended, its witness, and when `handover settle` wrote it. `settledIso` is absent on a row
   * settled before the field was written; nothing infers it.
   */
  readonly settlement: string | undefined;
  readonly settlementWitness: string | undefined;
  readonly settledIso: string | undefined;
  /**
   * On a settled ask the owner RULED on first, when they decided and in what words — the instant it really left the
   * owner's Queue, since a ruled ask is off it before a session settles it ({@link ruledBeforeSettleOf}).
   */
  readonly ruledBeforeSettleIso: string | undefined;
  readonly ruledBeforeSettleWords: string | undefined;
}

/**
 * The rulings that could have answered the ask, and the instant it was asked: the ones journalled since a
 * correction, reshape or offer last restated the question when one did (`../../../handover/ownerWait.ts`
 * `answeringRuling` says why) — read off the journal once the question is no longer held, since a settled run carries
 * no waiting disposition, by the waiting arm's own test applied to its latest question, against THAT question's
 * instant — else every dated ruling, against the registered ask's own `askedIso` when no
 * run ever asked one.
 *
 * @param model the composed row
 * @returns the candidates and the ask instant, or `undefined` when nothing says when it was asked
 */
function answerCandidates({
  model,
}: {
  model: BoardModel;
}): { readonly askedIso: string; readonly rulings: readonly RulingIdentity[] } | undefined {
  if (model.run.kind === "waiting-on-owner") {
    const { askedIso, ruledAfterRestatement } = model.run;
    if (ruledAfterRestatement !== undefined) {
      return { askedIso, rulings: ruledAfterRestatement };
    }
    return { askedIso, rulings: model.derived.datedRulings };
  }
  if (model.doc.askedIso === undefined) {
    return undefined;
  }
  const { latestAsk } = model.derived;
  if (latestAsk !== undefined) {
    return latestAsk;
  }
  return { askedIso: model.doc.askedIso, rulings: model.derived.datedRulings };
}

/**
 * The ruling that took a settled ask off the owner's Queue BEFORE its settle: the EARLIEST one answering the ask, decided at
 * or after it was asked and no later than `settledIso`. A ruled ask reads `already-ruled`, and leaves the owner's Queue,
 * before a session executes and settles it, so the settle instant alone would date that removal hours late and
 * name the wrong cause; and a ruling correcting an earlier
 * one does not take it off, the first does. An unparseable ruling or ask instant answers no ruling, never a
 * guess; an unparseable settle instant bounds nothing, so the ruling still dates the removal.
 *
 * @param model the composed row
 * @returns the ruling, or `undefined` on an unsettled row, an undated settle or one no ruling preceded
 */
export function ruledBeforeSettleOf({ model }: { model: BoardModel }): RulingIdentity | undefined {
  const { settledIso } = model.doc;
  const candidates = answerCandidates({ model });
  if (settledIso === undefined || model.derived.settlement === undefined || candidates === undefined) {
    return undefined;
  }
  const asked = Date.parse(candidates.askedIso);
  // A settle instant that does not parse bounds nothing, so it never displaces a ruling that does.
  const settled = Date.parse(settledIso);
  const bound = Number.isNaN(settled) ? Number.POSITIVE_INFINITY : settled;
  let first: RulingIdentity | undefined;
  for (const ruling of candidates.rulings) {
    const decided = Date.parse(ruling.decidedIso);
    const answers = decided >= asked && decided <= bound;
    if (answers && (first === undefined || decided < Date.parse(first.decidedIso))) {
      first = ruling;
    }
  }
  return first;
}

/**
 * The settlement fields a board row publishes.
 *
 * @param model the composed row
 * @returns how its ask ended, when, and the ruling that took it off first
 */
export function publishedSettlementOf({ model }: { model: BoardModel }): PublishedSettlement {
  const ruledFirst = ruledBeforeSettleOf({ model });
  return {
    ruledBeforeSettleIso: ruledFirst?.decidedIso,
    ruledBeforeSettleWords: ruledFirst?.words,
    settledIso: model.doc.settledIso,
    settlement: model.derived.settlement,
    settlementWitness: model.derived.settlementWitness,
  };
}
