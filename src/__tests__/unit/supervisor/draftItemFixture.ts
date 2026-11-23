/**
 * Folded draft-register rows and card landings for the approved-draft gate's tests, built the way the fold and the
 * card-landing ledger would hand them over.
 */
import type { DraftApproval, DraftHold, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import type { CardLandedRow } from "../../../talk/cardLanding.js";

/** The owner's yes on a call, exactly as a landing carried it. */
export const KNOCK: DraftApproval = {
  anchor: "talk-call:f9e9277d#12",
  atIso: "2026-10-08T00:16:54.000Z",
  heard: "Yes, send it today",
};

/**
 * One folded row: held unless said otherwise, approved, judged or held only when those are given.
 *
 * @param outcome the drop note or release coordinates a spent row carries
 * @param judgedIso when the row's current judgement was recorded
 * @param resolvedIso when a spent row was released or dropped
 * @returns the row
 */
export function draftItem({
  id,
  tsIso,
  approval,
  hold,
  judgedIso,
  meaningChanged,
  outcome,
  resolvedIso,
  state = "held",
}: {
  id: string;
  tsIso: string;
  approval?: DraftApproval;
  hold?: DraftHold;
  judgedIso?: string;
  meaningChanged?: string;
  outcome?: string;
  resolvedIso?: string;
  state?: SlackDraftItem["state"];
}): SlackDraftItem {
  return {
    draft: {
      advisory: [],
      channel: "C0123456789",
      digest: "0123456789abcdef0123456789abcdef",
      form: "{}",
      id,
      mentions: [],
      payload: { form: "plain", text: "sounds good", unfurl_links: false, unfurl_media: false },
      shape: "top-level",
      tsIso,
      why: "reply to Seth",
      ...(approval === undefined ? {} : { approval }),
      ...(meaningChanged === undefined ? {} : { meaningChanged }),
    },
    id,
    state,
    ...(hold === undefined ? {} : { hold }),
    ...(judgedIso === undefined ? {} : { judgedIso }),
    ...(outcome === undefined ? {} : { outcome }),
    ...(resolvedIso === undefined ? {} : { resolvedIso }),
  };
}

/**
 * One landing of the owner's words on a card, decided when they said them.
 *
 * @param cardKey the card the words landed on
 * @param decidedIso when they said them
 * @returns the ledger row
 */
export function landed({ cardKey, decidedIso }: { cardKey: string; decidedIso: string }): CardLandedRow {
  return {
    anchor: KNOCK.anchor,
    atIso: decidedIso,
    cardKey,
    decidedIso,
    kind: "landed",
    source: "transcript",
    words: KNOCK.heard,
    workSlug: "organisation-hunt-2026-10-07",
  };
}
