/**
 * How a source block places and folds the owner's words, and the copy for their further steers on a card. The block itself is
 * `./sourceBlock.ts`.
 */
import type {
  BoardRowPrSteer,
  BoardRowQuote,
  BoardRowSteer,
  HisWordsCut,
  HisWordsWhere,
} from "../components/live/readHisWords";
import { anchorInWords } from "./anchorInWords";
import { foldedText } from "./queueCard";
import { quoteLead } from "./quoteLead";

/**
 * How one quote folds, as {@link wordsFold} answers: the line the summary shows, whether more of the owner's words stand
 * before and after it (the block marks each with its own muted ellipsis), and the whole length.
 */
export type WordsFold =
  | {
      readonly head: string;
      readonly moreBefore: boolean;
      readonly moreAfter: boolean;
      readonly aboutChars: string;
    }
  | undefined;

/** One further steer of the owner's, as the block draws it. */
export interface SteerCopy {
  readonly words: { readonly text: string; readonly cut: HisWordsCut };
  /** Where and when the owner said it, in the same words the card's own quote is placed by. */
  readonly line: string;
  readonly fold: WordsFold;
}

/** The owner's further steers on a card: shut by default under one summary, so a card never grows by a quote list unasked. */
export interface SteersCopy {
  /** The fold's summary: how many, and in which order they open. */
  readonly summary: string;
  /** Each steer whose words read, oldest first. */
  readonly placed: readonly SteerCopy[];
  /** One sentence for each steer whose words did not read — no instant to place it by, so after the placed ones. */
  readonly unplaced: readonly UnplacedSteerCopy[];
}

/**
 * One steer whose words did not read: the console's own sentence, and — where it quotes a read's reason — that reason
 * apart, said plainly beneath it with the raw message folded.
 */
export interface UnplacedSteerCopy {
  readonly line: string;
  readonly why?: string;
}

/**
 * Where the owner said it, in their terms — the words both the block's sentence and the still-real line open on
 * (`./stillRealLead.ts`), so the two never name one event two ways.
 *
 * A card reading "confirmed 2.4 days ago" left it unclear what was confirmed. A sentence that opens on the record ("From a console call; the call
 * transcript recorded it") is a fact the owner has to translate; one that opens on what they did ("You said this on a
 * console call") is the meaning.
 */
export const WHERE_HE_SAID: Readonly<Record<HisWordsWhere, string>> = {
  call: "on a console call",
  "call-landing": "on a console call",
  "console-typed": "to the console voice",
  "console-voice": "to the console voice",
  session: "in a Claude session",
};

/** Where the owner said it and what captured it, around the instant that record carries — opening on what they did. */
const WHERE: Readonly<Record<HisWordsWhere, ({ at }: { at: string }) => string>> = {
  call: ({ at }) => `You said this ${WHERE_HE_SAID.call}; the call transcript recorded it at ${at}.`,
  // A `call:` anchor's words come off the card they landed on, not the call file.
  "call-landing": ({ at }) => `You said this ${WHERE_HE_SAID["call-landing"]} at ${at}; the card landing captured it.`,
  "console-typed": ({ at }) =>
    `You typed this ${WHERE_HE_SAID["console-typed"]}; the console record relayed it at ${at}.`,
  "console-voice": ({ at }) =>
    `You said this ${WHERE_HE_SAID["console-voice"]}; the voice transcript relayed it at ${at}.`,
  session: ({ at }) => `You said this ${WHERE_HE_SAID.session} at ${at}; the session transcript captured it.`,
};

/**
 * An instant as the block prints it, to the minute in UTC.
 *
 * @param iso the instant the record carries
 * @returns the instant as `YYYY-MM-DD HH:MMZ`, or the text as stored when it is not an instant
 */
export function sourceInstant({ iso }: { iso: string }): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return iso;
  }
  return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/**
 * A length as the fold's summary says it: rounded to the nearest hundred characters, never below one hundred, with
 * the thousands separated — `1,400`. A reader weighing whether to open it needs its size, not its exact count.
 *
 * @param chars the words' exact length
 * @returns the rounded length, spelled with separators
 */
export function aboutChars({ chars }: { chars: number }): string {
  return Math.max(100, Math.round(chars / 100) * 100).toLocaleString("en-US");
}

/**
 * How the owner's words fold: shut by default whenever they run past the fold, so a long
 * quote never pushes the card's own question off the screen.
 *
 * The summary leads with the stretch of the owner's turn that names what the card is about, speech noise dropped
 * (`./quoteLead.ts`) — never their opening filler. Where no stretch carries a thought, it shows the
 * opening. Either way the whole quote, verbatim, is what opening the fold shows.
 *
 * @param quote the owner's words and the record they were read off
 * @param subject what the card's row is about, or `undefined` when no row names it
 * @returns the summary's line, its edges and the rounded length, or `undefined` when the words fit above the fold whole
 */
export function wordsFold({ quote, subject }: { quote: BoardRowQuote; subject: string | undefined }): WordsFold {
  const folded = foldedText({ text: quote.words });
  if (!folded.folded) {
    return undefined;
  }
  const about = aboutChars({ chars: folded.whole.length });
  const lead = quoteLead({ cut: quote.cut, subject, where: quote.where, words: quote.words });
  if (lead === undefined) {
    return { aboutChars: about, head: folded.aboveFold, moreAfter: true, moreBefore: quote.cut === "start" };
  }
  return { aboutChars: about, head: lead.text, moreAfter: lead.moreAfter, moreBefore: lead.moreBefore };
}

/**
 * The sentence placing one quote of the owner's: where and when, and where the record cut it.
 *
 * @returns the sentence
 */
export function quoteLine({ quote }: { quote: BoardRowQuote }): string {
  const line = WHERE[quote.where]({ at: sourceInstant({ iso: quote.atIso }) });
  if (quote.cut === "start") {
    return `${line} The record kept only the end of what you said.`;
  }
  if (quote.cut === "end") {
    return `${line} It is cut short; the record holds the rest.`;
  }
  return line;
}

/**
 * The owner's further steers as the block draws them: each whose words read, oldest first — the order they said them in, so the
 * card reads as how their view moved — then one sentence for each that did not, which has no instant to be placed by
 * and is said rather than dropped.
 *
 * @param steers the card's further steers
 * @param subject what the card's row is about, which each steer's folded line leads on
 * @returns the copy, or `undefined` when there are none
 */
export function steersCopy({
  steers,
  subject,
}: {
  steers: readonly BoardRowSteer[];
  subject: string | undefined;
}): SteersCopy | undefined {
  if (steers.length === 0) {
    return undefined;
  }
  const held = steers.filter((steer) => steer.kind === "held");
  const placed = held
    .toSorted((one, other) => Date.parse(one.quote.atIso) - Date.parse(other.quote.atIso) || one.index - other.index)
    .map(({ quote }) => ({
      fold: wordsFold({ quote, subject }),
      line: quoteLine({ quote }),
      words: { cut: quote.cut, text: quote.words },
    }));
  // Each reason apart from its line: an unread steer's is the resolver's own message (`src/handover/hisWords.ts`
  // `unreadOwnerWords`), said plainly beneath the console's sentence with the raw message folded (steer 7).
  const unplaced = steers.flatMap((steer): UnplacedSteerCopy[] => {
    if (steer.kind === "unread") {
      return [
        {
          line: `Your words ${anchorInWords({ anchor: steer.anchor })} bear on this too, but did not read`,
          why: steer.why,
        },
      ];
    }
    if (steer.kind === "defect") {
      return [{ line: "One more of your steers is stored on this card but does not read", why: steer.why }];
    }
    return [];
  });
  let summary = `${String(steers.length)} more times you steered this`;
  if (steers.length === 1) {
    summary = "1 more time you steered this";
  }
  if (placed.length > 1) {
    summary = `${summary}, oldest first`;
  }
  return { placed, summary, unplaced };
}

/**
 * The owner's words stored on other cards naming a pull request this card names, as the block draws them: oldest first, each
 * placed by where and when they said it and which pull request it was on, shut under one summary like their own steers —
 * the card about a pull request carries every row of the owner's on it, never only its own.
 *
 * @param steers the card's pull-request words
 * @param subject what the card's row is about, which each quote's folded line leads on
 * @returns the copy, or `undefined` when there are none
 */
export function prSteersCopy({
  steers,
  subject,
}: {
  steers: readonly BoardRowPrSteer[] | undefined;
  subject: string | undefined;
}): SteersCopy | undefined {
  if (steers === undefined || steers.length === 0) {
    return undefined;
  }
  const held = steers.filter((steer) => steer.kind === "held");
  const placed = held
    .toSorted((one, other) => Date.parse(one.quote.atIso) - Date.parse(other.quote.atIso))
    .map(({ identity, quote }) => ({
      fold: wordsFold({ quote, subject }),
      line: `${quoteLine({ quote })} It is stored on another card about ${identity}.`,
      words: { cut: quote.cut, text: quote.words },
    }));
  const unplaced = steers.flatMap((steer): UnplacedSteerCopy[] =>
    steer.kind === "defect"
      ? [{ line: "One more of your words on its pull request does not read", why: steer.why }]
      : [],
  );
  let summary = `${String(steers.length)} more things you said about its pull request, on other cards`;
  if (steers.length === 1) {
    summary = "1 more thing you said about its pull request, on another card";
  }
  if (placed.length > 1) {
    summary = `${summary}, oldest first`;
  }
  return { placed, summary, unplaced };
}
