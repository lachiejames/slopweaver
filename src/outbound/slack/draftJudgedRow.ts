/**
 * How a judgement folds onto a parked row: `slack draft approve` binds the owner's yes to these exact words, and `slack draft
 * hold` records why they are not sent — and how a park that is itself a judgement folds. Pure, and a sibling of the
 * register fold that calls it.
 */
import { comparisonCarried } from "./draftComparison.js";
import type { DraftHold, SlackDraftEvent, SlackDraftItem } from "./draftRegister.js";

/**
 * A fresh row from its park — a new generation under the id, carrying nothing an earlier one was judged with. A park
 * that carries the owner's approval or a declared change of meaning IS a judgement, recorded at the park and bounded by
 * the landing ledger rows it read. An INHERITED approval is not: the re-cut judged no words, so the row stands on the
 * judgement, ledger count and blocking hold the row it came from carried.
 *
 * @param event the park being folded
 * @returns the held row
 */
export function parkedRow({ event }: { event: Extract<SlackDraftEvent, { kind: "parked" }> }): SlackDraftItem {
  const row: SlackDraftItem = { draft: event.draft, id: event.id, state: "held" };
  const { approval } = event.draft;
  if (approval === undefined && event.draft.meaningChanged === undefined) {
    return row;
  }
  if (approval?.inheritedFrom === undefined || approval.judgedIso === undefined) {
    const read = event.landingsRead;
    const counted = read === undefined ? {} : { judgedLandings: read };
    const changed = read === undefined || event.draft.meaningChanged === undefined ? {} : { changedLandings: read };
    return { ...row, judgedIso: event.tsIso, ...counted, ...changed };
  }
  const counted = approval.judgedLandings === undefined ? {} : { judgedLandings: approval.judgedLandings };
  const held = approval.hold === undefined ? {} : { hold: approval.hold };
  return { ...row, judgedIso: approval.judgedIso, ...counted, ...held };
}

/**
 * A held row after a judgement. `approved` is the owner's yes bound to these exact words: it sets any change of meaning and
 * any hold down, because a yes after them is a new judgement and owes a send again. `held` replaces any earlier hold;
 * `not-owner-yes` and `meaning-changed` set an approval down, the other reasons keep it. A `not-owner-yes` hold records
 * the yes it set down (`setDown`), and every later hold carries that record until an approve, so a drop can wait
 * until that reason has been in front of the owner. A spent row is never revived.
 *
 * @param standing the row as folded before this judgement
 * @param event the approve or hold being folded
 * @returns the row after the judgement, or `standing` unchanged when it is no longer held
 */
export function judgedRow({
  standing,
  event,
}: {
  standing: SlackDraftItem;
  event: Extract<SlackDraftEvent, { kind: "approved" | "held" }>;
}): SlackDraftItem {
  if (standing.state !== "held") {
    return standing;
  }
  const { approval: _approval, meaningChanged: _meaningChanged, ...words } = standing.draft;
  const base = {
    ...comparisonCarried({ standing }),
    // The owner's channel steer outlives a judgement: a yes or a hold on the words never takes back where they said
    // the words go.
    ...(standing.steer === undefined ? {} : { steer: standing.steer }),
    // A judgement never takes back a voice edit's history: the card still shows v1 beside the words judged.
    ...(standing.versions === undefined ? {} : { versions: standing.versions }),
    id: standing.id,
    judgedIso: event.tsIso,
    state: standing.state,
    ...landingsOf({ event, standing }),
  };
  if (event.kind === "approved") {
    return { ...base, draft: { ...words, approval: event.approval } };
  }
  const hold: DraftHold = {
    atIso: event.tsIso,
    reason: event.reason,
    why: event.why,
    ...setDownOf({ event, standing }),
  };
  if (event.reason === "not-owner-yes") {
    return { ...base, draft: words, hold };
  }
  if (event.reason === "meaning-changed") {
    const changed = event.landingsRead === undefined ? {} : { changedLandings: event.landingsRead };
    return { ...base, ...changed, draft: { ...words, meaningChanged: event.why }, hold };
  }
  // A blocking hold keeps the change it sits over, and the ledger boundary that change was recorded at. It judges none
  // of the owner's words, so it keeps the instant of the judgement that did too: re-dated to the hold, an uncounted row
  // would read words decided before it, but written after, as answered.
  const kept = standing.changedLandings === undefined ? {} : { changedLandings: standing.changedLandings };
  const judged = standing.judgedIso === undefined ? {} : { judgedIso: standing.judgedIso };
  return { ...base, ...judged, ...kept, draft: standing.draft, hold };
}

/**
 * How many landing ledger rows the row's judgement has read: this one's count, else the count it already carried, so a
 * hold a refused release recorded never widens what a session judged.
 */
function landingsOf({
  event,
  standing,
}: {
  event: Extract<SlackDraftEvent, { kind: "approved" | "held" }>;
  standing: SlackDraftItem;
}): Pick<SlackDraftItem, "judgedLandings"> {
  if (event.landingsRead !== undefined) {
    return { judgedLandings: event.landingsRead };
  }
  if (standing.judgedLandings !== undefined) {
    return { judgedLandings: standing.judgedLandings };
  }
  return {};
}

/**
 * What a hold sets down: under `not-owner-yes`, the row's own approval and any change of meaning waiting on the owner's word;
 * else whatever an earlier hold already set down.
 */
function setDownOf({
  event,
  standing,
}: {
  event: Extract<SlackDraftEvent, { kind: "held" }>;
  standing: SlackDraftItem;
}): Pick<DraftHold, "setDown"> {
  const { approval, meaningChanged } = standing.draft;
  if (event.reason === "not-owner-yes" && (approval !== undefined || meaningChanged !== undefined)) {
    const change = meaningChanged === undefined ? {} : { change: meaningChanged };
    const kept = { ...(approval === undefined ? {} : { approval }), ...change };
    const counted = event.landingsRead === undefined ? {} : { landingsRead: event.landingsRead };
    return { setDown: { ...kept, ...counted, atIso: event.tsIso, why: event.why } };
  }
  if (standing.hold?.setDown !== undefined) {
    return { setDown: standing.hold.setDown };
  }
  return {};
}
