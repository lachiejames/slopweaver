/**
 * What `read_card` and `open_card` answer with, assembled: the card, every address it links, every briefing it links
 * already read (`./cardBriefingRead.ts`), and which openings were refused. Pure, and its own file so `./openCardRun.ts`
 * keeps only the effects under the line cap.
 */
import {
  CARD_ANSWER_MAX_BYTES,
  type ReadCardBriefing,
  type WithBriefings,
  withFittedBriefings,
} from "../../lib/cardBriefings";
import type { CardLinks } from "../../lib/openCard";
import type { CardRemoval } from "../../lib/recentQueueDepartures";
import { cutMarked } from "../../lib/talkOffer";
import { UNREAD_MAX_BYTES } from "../../lib/unreadFit";
import type { VoicePartialFailure } from "../../lib/voiceFailureToast";
import { TOOL_OUTPUT_MAX } from "../live/talkSession";

/** What one opening came to, as the model is told it. */
export interface Opening {
  readonly outcome: "opened" | "refused" | "skipped" | "none";
  readonly why?: string;
}

/**
 * The most characters of one refused opening's reason an answer carries. The reason is a seam's own words (a verb's
 * stderr, a thrown message) and nothing else bounds it, so three of them at the full width of UTF-8 stay near 7 KiB,
 * leaving the card key, the refusal sentence and the unread list well under the tool output cap.
 */
export const OPENING_WHY_MAX = 600;

/**
 * A refused opening, its reason held to {@link OPENING_WHY_MAX} characters and marked where it was cut.
 *
 * @param why the seam's reason, whole
 * @returns the opening
 */
export function refusedOpening({ why }: { why: string }): Opening {
  return { outcome: "refused", why: cutMarked({ max: OPENING_WHY_MAX, text: why }) };
}

/**
 * A skipped opening, its reason held to {@link OPENING_WHY_MAX} characters like a refused one's: a skip's reason can
 * be a seam's own words too (a screen ask's thrown message, a verb's answer), so it is bounded the same way.
 *
 * @param why the reason it was skipped, whole
 * @returns the opening
 */
export function skippedOpening({ why }: { why: string }): Opening {
  return { outcome: "skipped", why: cutMarked({ max: OPENING_WHY_MAX, text: why }) };
}

/**
 * Every address a card links, as the model is told them: pages with their file paths, the thread, the rest, and the
 * local files its words name — disclosed for `file_read`, never opened.
 *
 * @param links the card's resolved links
 * @returns the answer's `links`
 */
export function linksForVoice({ links }: { links: CardLinks }): unknown {
  return {
    addresses: links.addresses,
    files: links.files,
    pages: links.pages.map(({ slug, file }) => ({ file, slug })),
    threadUrl: links.threadUrl,
  };
}

/**
 * What an answer says of a card that left the owner's Queue: that it left, when and why — nothing on a card still on it.
 *
 * @param removed the plan's removal
 * @returns the fields to spread into the answer
 */
export function removedFields({ removed }: { removed: CardRemoval | undefined }): {
  readonly removed?: CardRemoval & { readonly onQueue: false };
} {
  if (removed === undefined) {
    return {};
  }
  return { removed: { ...removed, onQueue: false } };
}

/**
 * The bytes `triage_next` adds around an open_card answer (`./triageRun.ts`, its `triage` pass) besides the card's key:
 * the field names, the longer of its clock notes and the switch note came to about 430 bytes, so a kilobyte leaves room
 * for six-digit counts and a note to grow. The widest pass rides a cap-forced card in `triageRun.test.ts`, which fails
 * should the wrapper outgrow this: `yarn vitest run --config config/vitest/unit.ts site/__tests__/unit/triageRun.test.ts
 * -t "past the budget"`.
 */
const TRIAGE_WRAPPER_BYTES = 1024;

/**
 * The cap a card's briefings are fitted under: the page's own, less what `triage_next` wraps the answer in, so a card
 * a pass walks to is never refused whole for the wrapper, and less the `unread` list the tool adds once
 * it knows every source its reads missed, which `fitUnread` holds to exactly this reserve. The
 * key is counted at its own length, since the pass names it again.
 *
 * @param cardKey the resolved card's own key
 * @returns the UTF-8 bytes the fitted answer stays under
 */
function cardAnswerCap({ cardKey }: { cardKey: string }): number {
  const keyBytes = new TextEncoder().encode(JSON.stringify(cardKey)).length;
  return TOOL_OUTPUT_MAX - TRIAGE_WRAPPER_BYTES - UNREAD_MAX_BYTES - keyBytes;
}

/**
 * A card's answer with its briefings attached and fitted under the page's tool cap, less room for the wrapper
 * `triage_next` adds, and one partial failure for every briefing that was not read whole — so the console window says
 * so as well as the voice (`../../lib/voiceFailureToast.ts`).
 *
 * @param answer the card's answer before its briefings
 * @param briefings every briefing the card links, as read
 * @param cardKey the resolved card's own key
 * @returns the fitted answer and the briefing failures
 */
export function withBriefings<Answer extends Readonly<Record<string, unknown>>>({
  answer,
  briefings,
  cardKey,
}: {
  answer: Answer;
  briefings: readonly ReadCardBriefing[];
  cardKey: string;
}): {
  readonly answer: WithBriefings<Answer>;
  readonly failures: readonly VoicePartialFailure[];
} {
  const capBytes = cardAnswerCap({ cardKey });
  const maxBytes = Math.min(CARD_ANSWER_MAX_BYTES, capBytes);
  const fitted = withFittedBriefings({ answer, briefings, capBytes, maxBytes });
  const failures = fitted.briefings.flatMap((briefing): VoicePartialFailure[] => {
    if (briefing.read === true) {
      return [];
    }
    if (briefing.read === false) {
      return [{ cardKey, part: "briefing", why: `${briefing.slug}: ${briefing.why}` }];
    }
    // A failed read the voice was handed to read itself (`../../lib/cardBriefings.ts` `cardBriefingOf`) carries nothing.
    const how = briefing.text === "" ? "not read here, handed to file_read" : "read in part";
    return [{ cardKey, part: "briefing", why: `${briefing.slug}: ${how}` }];
  });
  if (fitted.briefingsLeftOut !== undefined) {
    const { count } = fitted.briefingsLeftOut;
    failures.push({ cardKey, part: "briefing", why: `${count} more past the answer's size, not read` });
  }
  return { answer: fitted, failures };
}

/**
 * The openings that were attempted and refused, in the order they ran — a skip and an absent address are not failures.
 *
 * @param openings what each opening came to
 * @param cardKey the resolved card's own key, which the failure toast offers to open in the owner's browser
 * @returns one entry per refused opening
 */
export function refusedOpenings({
  openings,
  cardKey,
}: {
  openings: { readonly card: Opening; readonly page: Opening; readonly thread: Opening };
  cardKey: string;
}): readonly VoicePartialFailure[] {
  const ran = [
    { opening: openings.card, part: "card" },
    { opening: openings.page, part: "page" },
    { opening: openings.thread, part: "thread" },
  ];
  return ran
    .filter(({ opening }) => opening.outcome === "refused")
    .map(({ opening, part }) => ({ cardKey, part, why: refusedWhy({ why: opening.why }) }));
}

/**
 * A refused opening's reason, or the bare word when the refusal named none.
 *
 * @returns the reason the toast's detail shows
 */
function refusedWhy({ why }: { why: string | undefined }): string {
  if (why === undefined) {
    return "refused";
  }
  return why;
}
