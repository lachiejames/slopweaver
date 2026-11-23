/**
 * The Alignment page's "make it a general ruling?" questions: one per kind of act the owner has steered more than once,
 * with their own words as the provenance.
 *
 * A steer on one draft edits that one only, and becomes a general ruling only
 * when the owner says so; when the fleet is unsure, the page asks "you've given repeat feedback, make it a general
 * ruling?" and shows their quotes. So this never decides that repeat words ARE a ruling. It finds where they repeat
 * and asks.
 *
 * Only the owner's word on an act ITSELF counts (`directSteer`, `../components/live/readAutonomy.ts`): a pattern's word
 * projected onto its earlier acts, or a class rule's words, is one word counted many times. And only a word given
 * once the act was done (`given: "after"`): the `--steer` an act is recorded with cites a rule the owner already
 * confirmed, often as a bare `talk:`/`transcript:` anchor, so quoting it back as their words would be false and asking
 * whether it is a ruling would re-ask one. An act a standing rule already covers asks nothing, because that ruling
 * exists. Pure, so the unit lane holds it alone.
 *
 * The same holds for a card the owner sends back — repeated feedback of one class
 * ("there's no receipts on this") drafts a general ruling for their yes ({@link cardRulingCandidates}).
 */

import type { ParkedDraft } from "../components/live/readSlackDrafts";
import { type AlignmentRulingStakes, actRulingStakesOf, cardRulingStakesOf } from "./alignmentRulingStakes";
import { liveCutOf } from "./slackDraftIds";
import type { TriageFeedback } from "./triageWords";

/** As much of a ledger act as a candidate reads — `AutonomyRow` fits. */
export interface SteeredAct {
  readonly actionId: string;
  /** When the act was done, which dates the Risk row's window. */
  readonly doneIso: string;
  readonly kind: string;
  /** What the act touched, which the Blast radius row counts. */
  readonly subject: string;
  readonly directSteer:
    | {
        readonly words: string;
        readonly atIso: string;
        readonly dateBasis: "steered" | "acted";
        readonly given: "after" | "with-act";
      }
    | undefined;
  /** The standing rule covering the act, which means a general ruling already exists for it. */
  readonly rule: { readonly classId: string } | undefined;
}

/** One distinct wording the owner used, how many acts they said it on, and when they last did. */
export interface RulingQuote {
  readonly words: string;
  readonly acts: number;
  readonly latestIso: string;
  /** Whether `latestIso` is when the owner said it, or only the act's own time because the ledger kept no other. */
  readonly dateBasis: "steered" | "acted";
}

/** One "make it a general ruling?" question. */
export interface RulingCandidate {
  readonly kind: string;
  /** The question's key, `align:rule-<kind>` — what the owner's answer names. */
  readonly key: string;
  /** How many acts of this kind the owner has given a word on. */
  readonly steered: number;
  /** Each distinct wording, most used first. */
  readonly quotes: readonly RulingQuote[];
  /** What making it standing would let the fleet do unasked, off every act of the kind ({@link actRulingStakesOf}). */
  readonly stakes: AlignmentRulingStakes;
}

/** The least number of acts of one kind the owner's word must be on before the page asks. */
export const REPEAT_FLOOR = 2;

/** What a question key's id may hold (`./cardKey.ts`'s `CARD_KEY`): a kind outside it is not asked about. */
const KEY_ID = /^[A-Za-z0-9._-]{1,150}$/u;

/**
 * Every kind of act the owner has given their own later word on at least {@link REPEAT_FLOOR} times, with no standing rule
 * covering it — most steered first, a kind's name breaking a tie.
 *
 * @param acts the ledger, as read
 * @returns the questions
 */
export function rulingCandidates({ acts }: { acts: readonly SteeredAct[] }): readonly RulingCandidate[] {
  const byKind = new Map<string, { ids: Set<string>; quotes: Map<string, RulingQuote> }>();
  for (const act of acts) {
    const steer = act.directSteer;
    if (steer?.given !== "after" || act.rule !== undefined || !KEY_ID.test(act.kind)) {
      continue;
    }
    let group = byKind.get(act.kind);
    if (group === undefined) {
      group = { ids: new Set(), quotes: new Map() };
      byKind.set(act.kind, group);
    }
    if (group.ids.has(act.actionId)) {
      continue;
    }
    group.ids.add(act.actionId);
    const words = steer.words.trim();
    const was = group.quotes.get(words);
    if (was === undefined) {
      group.quotes.set(words, { acts: 1, dateBasis: steer.dateBasis, latestIso: steer.atIso, words });
    } else if (Date.parse(steer.atIso) > Date.parse(was.latestIso)) {
      group.quotes.set(words, { acts: was.acts + 1, dateBasis: steer.dateBasis, latestIso: steer.atIso, words });
    } else {
      group.quotes.set(words, { ...was, acts: was.acts + 1 });
    }
  }
  const out: RulingCandidate[] = [];
  for (const [kind, { ids, quotes }] of byKind) {
    const steered = ids.size;
    if (steered < REPEAT_FLOOR) {
      continue;
    }
    out.push({
      key: `align:rule-${kind}`,
      kind,
      quotes: [...quotes.values()].toSorted(
        (a, b) => b.acts - a.acts || Date.parse(b.latestIso) - Date.parse(a.latestIso),
      ),
      stakes: actRulingStakesOf({ acts, kind }),
      steered,
    });
  }
  return out.toSorted((a, b) => b.steered - a.steered || a.kind.localeCompare(b.kind));
}

/** The owner's feedback on one card they sent back: the card it was about, the class they named, and their words. */
export interface CardFeedback {
  /** The card's key, `post:<sd-id>`. */
  readonly about: string;
  readonly feedback: TriageFeedback;
  readonly words: string;
  readonly atIso: string;
}

/** The owner's words on one draft chain, the latest they gave on it. */
export interface CardQuote {
  readonly words: string;
  readonly atIso: string;
  /** The draft that stands for the chain, the one the Queue shows. */
  readonly draftId: string;
}

/** One "make what you keep sending back a general ruling?" question about a class of card defect. */
export interface CardRulingCandidate {
  readonly feedback: TriageFeedback;
  /** The question's key, `align:rule-card-<feedback>` — what the owner's answer names. */
  readonly key: string;
  /** One quote per distinct draft chain the owner sent back for it, newest first. */
  readonly quotes: readonly CardQuote[];
  /** What holding every card to the class would do unasked, off those chains ({@link cardRulingStakesOf}). */
  readonly stakes: AlignmentRulingStakes;
}

/** What a class of feedback means, as the question names it. */
export const FEEDBACK_SUBJECT: Readonly<Record<TriageFeedback, string>> = {
  "no-receipts": "a card that makes a claim with no receipt to check it",
  "not-at-a-glance": "a card you could not take in at a glance",
};

/** The draft id a `post:` card key names, or `undefined` for any other key. */
const POST_KEY = /^post:(sd-[0-9a-f]{8})$/u;

/**
 * Every class of card defect the owner has sent back on at least {@link REPEAT_FLOOR} distinct draft chains: each re-cut
 * of one draft counts once, at the cut that stands, keeping their latest words on it. Only their structured feedback
 * counts (`talk relay --feedback`), never words mined for a class, so a relay recorded before feedback was stored
 * counts nothing. A question, never a ruling: nothing here lands as one until the owner answers.
 *
 * @param drafts the draft register, so a re-cut chain resolves to one draft
 * @param feedback the owner's feedback relays, as read
 * @returns the questions, most chains first, a class breaking a tie
 */
export function cardRulingCandidates({
  drafts,
  feedback,
}: {
  drafts: readonly ParkedDraft[];
  feedback: readonly CardFeedback[];
}): readonly CardRulingCandidate[] {
  const byClass = new Map<TriageFeedback, Map<string, CardQuote>>();
  for (const one of feedback) {
    const id = POST_KEY.exec(one.about)?.[1];
    if (id === undefined) {
      continue;
    }
    const cut = liveCutOf({ id, items: drafts });
    const draftId = cut === undefined ? id : cut.live.id;
    let chains = byClass.get(one.feedback);
    if (chains === undefined) {
      chains = new Map();
      byClass.set(one.feedback, chains);
    }
    const was = chains.get(draftId);
    if (was === undefined || Date.parse(one.atIso) > Date.parse(was.atIso)) {
      chains.set(draftId, { atIso: one.atIso, draftId, words: one.words.trim() });
    }
  }
  const out: CardRulingCandidate[] = [];
  for (const [feedbackClass, chains] of byClass) {
    if (chains.size < REPEAT_FLOOR) {
      continue;
    }
    const quotes = [...chains.values()].toSorted((a, b) => Date.parse(b.atIso) - Date.parse(a.atIso));
    out.push({
      feedback: feedbackClass,
      key: `align:rule-card-${feedbackClass}`,
      quotes,
      stakes: cardRulingStakesOf({ drafts: quotes, subject: FEEDBACK_SUBJECT[feedbackClass] }),
    });
  }
  return out.toSorted((a, b) => b.quotes.length - a.quotes.length || a.feedback.localeCompare(b.feedback));
}
