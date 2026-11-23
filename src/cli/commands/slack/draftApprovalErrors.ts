/**
 * Why a yes at an anchor does not bind to a draft, though the words there are whole: the record holding them
 * contradicts it (`./draftApprovalGate.ts`). Its own union rather than the draft register's, because these are facts
 * about the evidence behind a yes, never about the register. Per `.claude/rules/error-handling.md` it stands alone.
 */
import type { CardDistance } from "../../../talk/approvalRelayRead.js";
import type { TriageVerdict } from "../../../talk/triageVocabulary.js";

/**
 * The owner's words at the anchor are whole, but the relay that carried them recorded a triage verdict other than
 * `send-it` — or predates storing one, so nobody can say. A yes that answers a "needs more info" question is not a
 * send-it, so it must not be approved and sent.
 */
export interface DraftApprovalVerdictError {
  readonly code: "DRAFT_APPROVAL_VERDICT";
  readonly message: string;
  readonly claimed: string;
  /** The verdict the relay recorded, or `undefined` when the record predates storing one. */
  readonly verdict: TriageVerdict | undefined;
}

/**
 * The owner's words at the anchor were about no card, or a card that is not this draft's: a yes binds only the draft
 * it was said over, never a relay about no card at all.
 */
export interface DraftApprovalCardMismatchError {
  readonly code: "DRAFT_APPROVAL_CARD_MISMATCH";
  readonly message: string;
  readonly claimed: string;
  /** The card the anchor was about, or empty for none. */
  readonly about: string;
  /** The draft ids a yes may bind here: the row and every cut the register records it re-cut. */
  readonly expectedDraftIds: readonly string[];
}

/**
 * A relay the owner made after the yes, on the same call, while its card or one of the next two was up, took it back
 * or ruled otherwise and names no card of its own. The voice opens the next card 1.1s after relaying an answer, so
 * "oh wait, no, not that one" is relayed about the NEXT card and never reaches the one it takes back.
 */
export interface DraftApprovalLaterRelayError {
  readonly code: "DRAFT_APPROVAL_LATER_RELAY";
  readonly message: string;
  readonly claimed: string;
  /** The later relay, `talk:<turnId>`. */
  readonly laterAnchor: string;
  /** What the owner said on it. */
  readonly heard: string;
  /** The card it was about, or empty for none. */
  readonly about: string;
  /** How many cards had opened since the yes: 0 is the yes's own card. */
  readonly cardDistance: CardDistance;
  /** The verdict it carried, or `null` for none. */
  readonly verdict: TriageVerdict | null;
}

/**
 * The owner's words at the anchor are whole and were said over this draft's card, but nothing in the record is an
 * affirmative act: a relay that carried no ruling, or a card landing, whose words carry no yes from the closed list —
 * or carry one beside a take-back. An open card at the anchor alone is not a yes: a remark said while the draft's card
 * was open must not bind.
 */
export interface DraftApprovalNoAffirmativeError {
  readonly code: "DRAFT_APPROVAL_NO_AFFIRMATIVE";
  readonly message: string;
  readonly claimed: string;
  /** What the owner said at the anchor. */
  readonly heard: string;
  /** Why the words are not an affirmative act. */
  readonly why: string;
}

/** The call the yes was said on cannot say what the owner said after it, so whether they took it back is unknown. */
export interface DraftApprovalCallUnreadableError {
  readonly code: "DRAFT_APPROVAL_CALL_UNREADABLE";
  readonly message: string;
  readonly claimed: string;
  readonly why: string;
}

/** Why a yes at an anchor does not bind to this draft. */
export type DraftApprovalAnchorError =
  | DraftApprovalVerdictError
  | DraftApprovalNoAffirmativeError
  | DraftApprovalCardMismatchError
  | DraftApprovalLaterRelayError
  | DraftApprovalCallUnreadableError;

/** The most characters of a later relay's words a refusal quotes. */
const QUOTED_CHARS = 200;

/** How a refusal says when a later relay was made. */
const DISTANCE_WORDS: Readonly<Record<CardDistance, string>> = {
  0: "on the same card",
  1: "one card later",
  2: "two cards later",
};

/** The one place a {@link DraftApprovalAnchorError} is constructed, so a test builds what the real code builds. */
export const DraftApprovalAnchorErrors = {
  callUnreadable: ({ claimed, why }: { claimed: string; why: string }): DraftApprovalCallUnreadableError => ({
    claimed,
    code: "DRAFT_APPROVAL_CALL_UNREADABLE",
    message:
      `${claimed}: ${why} — nothing was recorded. Put the card in front of the owner and record the yes they give on it, or ` +
      "name a relay whose call reads whole",
    why,
  }),
  laterRelay: ({
    about,
    cardDistance,
    claimed,
    heard,
    laterAnchor,
    verdict,
  }: {
    about: string;
    cardDistance: CardDistance;
    claimed: string;
    heard: string;
    laterAnchor: string;
    verdict: TriageVerdict | null;
  }): DraftApprovalLaterRelayError => {
    let card = "no card";
    if (about !== "") {
      card = about;
    }
    let quoted = heard.trim();
    if (quoted.length > QUOTED_CHARS) {
      quoted = `${quoted.slice(0, QUOTED_CHARS)}…`;
    }
    let ruled = "";
    if (verdict !== null) {
      ruled = `, ruled ${verdict}`;
    }
    return {
      about,
      cardDistance,
      claimed,
      code: "DRAFT_APPROVAL_LATER_RELAY",
      heard,
      laterAnchor,
      message:
        `${claimed}: ${laterAnchor}, relayed ${DISTANCE_WORDS[cardDistance]} on the same call, said "${quoted}" over ` +
        `${card}${ruled} — a take-back or another verdict that names no card of its own, so it may take this yes ` +
        "back — nothing was recorded. Ask the owner which card they meant and record the ruling they give on it",
      verdict,
    };
  },
  cardMismatch: ({
    about,
    claimed,
    expectedDraftIds,
    why,
  }: {
    about: string;
    claimed: string;
    expectedDraftIds: readonly string[];
    why: string;
  }): DraftApprovalCardMismatchError => {
    let expected =
      "no draft at all — a fresh record --approved binds only through --supersedes <id>, or by carrying the exact " +
      "words of the row whose card the owner spoke on";
    if (expectedDraftIds.length > 0) {
      expected = expectedDraftIds.map((id) => `post:${id}`).join(", ");
    }
    return {
      about,
      claimed,
      code: "DRAFT_APPROVAL_CARD_MISMATCH",
      expectedDraftIds,
      message:
        `${claimed}: ${why}, so it is not the owner's yes to this draft (a yes here binds ${expected}) — nothing was ` +
        "recorded. Put the card in front of the owner and record the yes they give on it",
    };
  },
  noAffirmative: ({
    claimed,
    heard,
    why,
  }: {
    claimed: string;
    heard: string;
    why: string;
  }): DraftApprovalNoAffirmativeError => {
    let quoted = heard.trim();
    if (quoted.length > QUOTED_CHARS) {
      quoted = `${quoted.slice(0, QUOTED_CHARS)}…`;
    }
    return {
      claimed,
      code: "DRAFT_APPROVAL_NO_AFFIRMATIVE",
      heard,
      message:
        `${claimed}: the owner said "${quoted}" with the card open, and ${why}, so an open card is all that ties it to a ` +
        "yes — nothing was recorded. Hold it not-owner-yes, or record the yes they give on its card",
      why,
    };
  },
  verdict: ({
    claimed,
    verdict,
  }: {
    claimed: string;
    verdict: TriageVerdict | undefined;
  }): DraftApprovalVerdictError => {
    let why =
      "the relay predates storing the owner's triage verdict, so whether they ruled send-it there is unknown — its row's " +
      "prose may say otherwise";
    if (verdict !== undefined) {
      why = `the relay recorded the owner's triage verdict as ${verdict}, not send-it`;
    }
    return {
      claimed,
      code: "DRAFT_APPROVAL_VERDICT",
      message: `${claimed}: ${why} — nothing was recorded. Hold it not-owner-yes, or record the yes they give on its card`,
      verdict,
    };
  },
} as const;
