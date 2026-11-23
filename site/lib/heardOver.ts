/**
 * Which card a relay is about: the one open when the owner began the words it carries, never the one open when the
 * voice got round to relaying them. A relay lands on its `about` card (`src/cli/commands/talk/relayCardLand.ts`'s
 * `landRelayCard`), and the voice calls the relay tool a beat after the owner stops — long enough for them to have
 * opened the next card. Read at relay time, `about` would pull that next card, which the owner never spoke over. The
 * transcript already stamps each stretch with the card it began on (`./transcriptSink.ts`); this is the same stamp
 * for the relay.
 *
 * A relay carries every word the owner said since the last one (`./relayGate.ts`'s `heardSince`), and those can span
 * utterances begun over different cards — "ship A" over one, "separately, inspect B" over the next. No single card
 * is then the one the relay is about, so {@link relayAbout} names none and the relay is placed by no card: the relay
 * still records its row, and the transcript lands each utterance on the card it began over
 * (`src/talk/cardUtterance.ts`), reusing that row. The voice's judgement can still name one: {@link relayJudgeable}
 * is the card it may land on, the card still open that the owner's latest words began over.
 */
import type { WorkContext } from "./workContext";

/**
 * The owner's utterances since the last relay: the latest one's segment id, every card one of them began over, and every
 * console one of them began on.
 */
export interface HeardOver {
  /** The segment id of the owner's latest utterance. */
  readonly segmentId: string;
  /** The card the owner's latest utterance began over, `undefined` for none. */
  readonly lastOpen: string | undefined;
  /** Each distinct card an utterance since the last relay began over, `undefined` for none, first seen first. */
  readonly opens: readonly (string | undefined)[];
  /** Each distinct console an utterance since the last relay began on, `undefined` for unknown, first seen first. */
  readonly contexts: readonly (WorkContext | undefined)[];
}

/**
 * Fold one transcript event into what the owner's words since the last relay were said over. The first sight of a
 * segment stamps it; a later event on the same segment, and anything the voice says, leaves the stamps as they were.
 *
 * @param held what the owner's words since the last relay were said over before this event, or `undefined` if the
 *   owner has said nothing since
 * @param segmentId the event's segment id
 * @param who whose segment it is
 * @param open the card open when this segment began
 * @param context the console the owner was on when this segment began, `undefined` when the page could not say
 * @returns what the owner's words since the last relay are said over after this event
 */
export function heardOverAfter({
  held,
  segmentId,
  who,
  open,
  context,
}: {
  held: HeardOver | undefined;
  segmentId: string;
  who: "owner" | "voice";
  open: string | undefined;
  context: WorkContext | undefined;
}): HeardOver | undefined {
  if (who !== "owner" || held?.segmentId === segmentId) {
    return held;
  }
  if (held === undefined) {
    return { contexts: [context], lastOpen: open, opens: [open], segmentId };
  }
  return {
    contexts: held.contexts.includes(context) ? held.contexts : [...held.contexts, context],
    lastOpen: open,
    opens: held.opens.includes(open) ? held.opens : [...held.opens, open],
    segmentId,
  };
}

/**
 * The console a relay over no card was said on: the one every utterance since the last relay began on, over no card.
 * Read at relay time the console would be whatever the owner switched to after speaking, so the stamp is read instead.
 * Words over a card, over more than one, across two consoles, or on one the page could not name are said on no
 * console a relay may be placed by — and nor is a relay when the owner has said nothing since the last one, which no
 * stamp places: the console at hand-off is not where any words were said.
 *
 * @param held what the owner's words since the last relay were said over, or `undefined` if the owner has said nothing
 *   since
 * @returns the console, or `undefined` when none places the relay
 */
export function relaySpokenIn({ held }: { held: HeardOver | undefined }): WorkContext | undefined {
  if (held?.opens.length !== 1 || held.opens[0] !== undefined || held.contexts.length !== 1) {
    return undefined;
  }
  return held.contexts[0];
}

/**
 * The card a relay is about: the one card any utterance since the last relay began over; none when they began over
 * more than one; or, when the owner has said nothing since — a typed steer — the card open now.
 *
 * Words begun over no card do not compete with the one card. Measured: the owner asked for the first card over none,
 * the voice opened one, and the owner rejected it over that card. Read as two, the relay was about none, and since the
 * transcript lands nothing said over a card the voice opened (`src/talk/cardUtterance.ts`'s
 * `transcriptCardUtterances`), the rejection reached no card at all.
 *
 * @param held what the owner's words since the last relay were said over, or `undefined` if the owner has said nothing
 *   since
 * @param openNow the card open as the relay runs
 * @returns the card key, or `""` for none — the relay wire's own spelling of no card
 */
export function relayAbout({ held, openNow }: { held: HeardOver | undefined; openNow: string | undefined }): string {
  if (held === undefined) {
    if (openNow === undefined) {
      return "";
    }
    return openNow;
  }
  const cards = held.opens.filter((open): open is string => open !== undefined);
  if (cards.length !== 1) {
    return "";
  }
  return cards[0];
}

/**
 * The card the voice's judgement that the owner's words answer the open card (`relay_steer`'s `answers_open_card`) may
 * land on: {@link relayAbout}'s card when it names one; otherwise, when the owner's words since the last relay began
 * over more than one card, the card their latest utterance began over, only while that card is still the one open.
 *
 * Measured: walking the Queue, the owner said "Next card, please" over one card, the voice opened the next, and the
 * owner answered over it. The relay carried both, {@link relayAbout} named none, and the voice's judgement was dropped:
 * 5 of that call's 8 card answers landed on no card.
 *
 * The residue, stated: "ship A" over A and then "separately, inspect B" over B, judged an answer to B, lands every word
 * on B and none on A. Nothing here can tell that from "Next card, please" over A; only the voice's judgement gates it.
 *
 * @param held what the owner's words since the last relay were said over, or `undefined` if the owner has said nothing
 *   since
 * @param openNow the card open as the relay runs
 * @returns the card key, or `""` for none
 */
export function relayJudgeable({
  held,
  openNow,
}: {
  held: HeardOver | undefined;
  openNow: string | undefined;
}): string {
  const about = relayAbout({ held, openNow });
  if (about !== "") {
    return about;
  }
  if (held?.lastOpen === undefined || held.lastOpen !== openNow) {
    return "";
  }
  return held.lastOpen;
}

/**
 * The card a relay is about once the voice has judged the owner's words: the card they spoke over ({@link relayAbout})
 * only when the voice says they answer it, and never a hand step, which settles when it is done rather than on
 * anything said with it open. Words that are obviously not answers to the open card are not answers. Measured: "Uh,
 * good morning" and a stretch about vulnerability bumps were relayed about an open Twilio hand step, and took it off
 * the owner's Queue.
 *
 * @param spokenOver the card the owner's words began over, `""` for none
 * @param answersOpenCard the voice's judgement, `relay_steer`'s `answers_open_card`
 * @returns the card key, or `""` — the relay is then about no card, and its row still carries every word
 */
export function relayAboutJudged({
  spokenOver,
  answersOpenCard,
}: {
  spokenOver: string;
  answersOpenCard: boolean;
}): string {
  if (!answersOpenCard || spokenOver.startsWith("hand:")) {
    return "";
  }
  return spokenOver;
}

/**
 * One relay's lines and the card each names. Every line goes to the call the relay began in, however long its post
 * takes. The card is the one the owner's words began over, not the one open now: the owner may have moved on before
 * the voice relayed them. Once another call began, what that call heard is not this relay's, so the card read as the
 * relay began stands.
 *
 * @param transcript the call's record: which call is current, and what the owner's words since the last relay began over
 * @param openNow the card open as a line is recorded
 * @param record what records one line against the call it belongs to
 * @returns the card the relay is about now, `""` for none, the card the voice's judgement may land on
 *   ({@link relayJudgeable}), the console it was said on ({@link relaySpokenIn}), and what records one of its lines
 */
export function relayLines<L>({
  transcript,
  openNow,
  record,
}: {
  transcript: { readonly current: () => string | undefined; readonly heardOver: () => HeardOver | undefined };
  openNow: () => string | undefined;
  record: (input: { call: string | undefined; line: L }) => void;
}): {
  readonly about: () => string;
  readonly judgeable: () => string;
  readonly spokenIn: () => WorkContext | undefined;
  readonly record: (input: { line: L }) => void;
} {
  const call = transcript.current();
  const aboutOf = (): string => relayAbout({ held: transcript.heardOver(), openNow: openNow() });
  const judgeableOf = (): string => relayJudgeable({ held: transcript.heardOver(), openNow: openNow() });
  const spokenInOf = (): WorkContext | undefined => relaySpokenIn({ held: transcript.heardOver() });
  const began = aboutOf();
  const beganJudgeable = judgeableOf();
  const beganIn = spokenInOf();
  return {
    about: () => {
      if (call === transcript.current()) {
        return aboutOf();
      }
      return began;
    },
    judgeable: () => {
      if (call === transcript.current()) {
        return judgeableOf();
      }
      return beganJudgeable;
    },
    spokenIn: () => {
      if (call === transcript.current()) {
        return spokenInOf();
      }
      return beganIn;
    },
    record: ({ line }) => {
      record({ call, line });
    },
  };
}
