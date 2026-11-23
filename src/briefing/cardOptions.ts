/**
 * The OPTIONS cell of a react-now card, read off the rendered page: its letters, and every rule about what one
 * option may say.
 *
 * Split out of `./reactNowCard.ts` so the four card-framing rules stay under the size ratchet. The seam is real
 * rather than convenient: everything here reads ONE option's own body, while
 * what stays behind reads a card's fields and the relations between them. `checkOptions` is the one function
 * that crosses, and it crosses because an option's undefined-label check needs the rest of the card's
 * vocabulary.
 *
 * Every criterion lives in its own module and is imported here — `./adminMergeOffer.ts`, `./ownHandAction.ts`,
 * `./replyChannel.ts`, `./optionPickability.ts`. This file is the parser and the orchestration; it holds one
 * criterion of its own, the undefined Title-Case label, because that one is a relation between the option and
 * the card rather than a property of either.
 */
import { adminMergeOffer, adminMergeRefusal } from "./adminMergeOffer.js";
import { MAX_OPTIONS, OPTION_MAX_WORDS } from "./caps.js";
import { changesWhatShips, scopeChangeRefusal, sentElsewhere, sentElsewhereRefusal } from "./optionPickability.js";
import { ownHandAction, ownHandRefusal } from "./ownHandAction.js";
import { misroutedReplyChannel, replyChannelRefusal } from "./replyChannel.js";
import { aboveFoldText, plainText, sentenceCount, wordCount } from "./text.js";

/**
 * The one callback every checker below reports a defect through.
 *
 * @internal — the declared shape `./reactNowCard.ts` builds and passes in; no other caller names it.
 */
export type PushOptionDefect = (args: { field: "options"; reason: string }) => void;

/** A word cap's refusal, naming the field, the count and the cap in plain words. */
function overWords({ label, words, cap }: { label: string; words: number; cap: number }): string {
  return (
    `${String(words)} words above the fold, over the cap of ${String(cap)}. ` +
    `Cut ${label} down, or move the rest into a details fold inside the card.`
  );
}

/** Which of the three premise arms the card declared, for the rule that only applies to a pull request. */
const PREMISE_KIND = /<div class="age"[^>]*\bdata-premise-kind="([^"]*)"/;

/**
 * Every defect in one card's `options` cell: the letters, the count, and each option's own rules.
 *
 * @param applyFraming whether the two card-framing option rules run, lifted by the break-glass at the door
 * @param cardHtml the card's own markup, for the premise arm the scope rule keys on
 * @param fields the card's `dl.f` pairs
 * @param ownHand whether this card sits in the me-facing grouping, where a bare imperative is the owner's own hands
 * @param push the defect sink
 * @param questionRaw the card's question block, which counts toward the vocabulary a label may be defined in
 */
export function checkOptions({
  applyFraming,
  cardHtml,
  fields,
  ownHand,
  push,
  questionRaw,
}: {
  applyFraming: boolean;
  cardHtml: string;
  fields: ReadonlyMap<string, string>;
  ownHand: boolean;
  push: PushOptionDefect;
  questionRaw: string | undefined;
}): void {
  const raw = fields.get("options");
  if (raw === undefined) {
    push({ field: "options", reason: "missing" });
    return;
  }
  const options = splitOptions({ text: aboveFoldText({ html: raw }) });
  if (options.length === 0) {
    push({ field: "options", reason: "not shaped as `A: … B: …`" });
    return;
  }
  if (options.length > MAX_OPTIONS) {
    push({
      field: "options",
      reason:
        `${String(options.length)} options, over the cap of ${String(MAX_OPTIONS)}. ` +
        "More choices than that is a design discussion, not a decision you can react to.",
    });
  }
  const vocabulary = cardVocabulary({ fields, questionRaw });
  const aboutPullRequest = PREMISE_KIND.exec(cardHtml)?.[1] === "pull-request";
  for (const option of options) {
    checkOneOption({ aboutPullRequest, applyFraming, option, ownHand, push, vocabulary });
  }
}

/** Every word the card defines anywhere, fold included: a term explained below the fold is still defined. */
function cardVocabulary({
  fields,
  questionRaw,
}: {
  fields: ReadonlyMap<string, string>;
  questionRaw: string | undefined;
}): string {
  return plainText({
    html: [questionRaw, fields.get("what"), fields.get("why you"), fields.get("lean"), fields.get("if silent")]
      .filter((value): value is string => value !== undefined)
      .join(" "),
  });
}

/**
 * Every PHRASE rule over one option's body: a criterion that finds an offending phrase, and the refusal it
 * turns into.
 *
 * A table rather than eight `if` blocks in a row: eight `if` blocks would pass both the length cap and the
 * branch ceiling, and the eight are the same shape as each other, so the table is what the code describes. Each entry's
 * `finds` returns the phrase or nothing; `refusal` says what to do about it.
 */
const PHRASE_RULES: readonly {
  readonly finds: (args: { text: string; vocabulary: string }) => string | undefined;
  readonly refusal: (args: { cell: string; phrase: string }) => string;
  /** Which cards the rule applies to. Absent means every card. */
  readonly when?: "framing" | "framing-on-a-pull-request" | "me-facing";
}[] = [
  // The card's own vocabulary reaches every entry's criterion, and five of the six ignore it. One shared
  // signature rather than a mutable module-level hold: the label rule is the only one whose criterion needs
  // anything beyond the option's own text, and a field five entries never read costs nothing but a name.
  { finds: undefinedLabelIn, refusal: ({ cell, phrase }) => `${cell} uses an undefined label: "${phrase}"` },
  { finds: ({ text }) => misroutedReplyChannel({ text }), refusal: replyChannelRefusal },
  { finds: ({ text }) => adminMergeOffer({ text }), refusal: adminMergeRefusal },
  { finds: ({ text }) => sentElsewhere({ text }), refusal: sentElsewhereRefusal, when: "framing" },
  {
    finds: ({ text }) => changesWhatShips({ text }),
    refusal: scopeChangeRefusal,
    when: "framing-on-a-pull-request",
  },
  {
    finds: ({ text }) => ownHandAction({ imperative: true, text }),
    refusal: ownHandRefusal,
    when: "me-facing",
  },
];

/** Whether one table entry applies to the card in hand. */
function applies({
  when,
  aboutPullRequest,
  applyFraming,
  ownHand,
}: {
  when: "framing" | "framing-on-a-pull-request" | "me-facing" | undefined;
  aboutPullRequest: boolean;
  applyFraming: boolean;
  ownHand: boolean;
}): boolean {
  if (when === undefined) {
    return true;
  }
  if (when === "me-facing") {
    return ownHand;
  }
  if (when === "framing-on-a-pull-request") {
    return applyFraming && aboutPullRequest;
  }
  return applyFraming;
}

/** The three SHAPE rules, which measure the option rather than searching it for a phrase. */
function checkOptionShape({ option, push }: { option: ParsedOption; push: PushOptionDefect }): void {
  if (!isFullSentence({ text: option.body })) {
    push({ field: "options", reason: `option ${option.letter} is not a full sentence: "${option.body}"` });
  }
  const sentences = sentenceCount({ text: option.body });
  if (sentences > 1) {
    push({
      field: "options",
      reason: `option ${option.letter} is ${String(sentences)} sentences, over the cap of 1. One option, one sentence.`,
    });
  }
  const words = wordCount({ text: option.body });
  if (words > OPTION_MAX_WORDS) {
    push({ field: "options", reason: overWords({ cap: OPTION_MAX_WORDS, label: `option ${option.letter}`, words }) });
  }
}

/** Every defect in one option: its shape, then every phrase rule that applies to the card it sits on. */
function checkOneOption({
  aboutPullRequest,
  applyFraming,
  option,
  ownHand,
  push,
  vocabulary,
}: {
  aboutPullRequest: boolean;
  applyFraming: boolean;
  option: ParsedOption;
  ownHand: boolean;
  push: PushOptionDefect;
  vocabulary: string;
}): void {
  checkOptionShape({ option, push });
  for (const rule of PHRASE_RULES) {
    if (!applies({ aboutPullRequest, applyFraming, ownHand, when: rule.when })) {
      continue;
    }
    const phrase = rule.finds({ text: option.body, vocabulary });
    if (phrase !== undefined) {
      push({ field: "options", reason: rule.refusal({ cell: `option ${option.letter}`, phrase }) });
    }
  }
}

/** One lettered option, its letter split from the sentence it introduces. */
export interface ParsedOption {
  readonly letter: string;
  readonly body: string;
}

const OPTION_MARKER = /(?:^|\s)([A-Z]):\s*/g;

/**
 * Split an `options` field's plain text into its lettered options (`A: … B: …`). Empty when unshaped.
 *
 * @param text the options cell's plain text, above the fold
 * @returns one entry per lettered option, in the order they were written
 */
export function splitOptions({ text }: { text: string }): readonly ParsedOption[] {
  const markers = [...text.matchAll(OPTION_MARKER)];
  return markers.map((marker, i) => {
    const start = marker.index + marker[0].length;
    const next = markers[i + 1];
    const end = next === undefined ? text.length : next.index;
    return { body: text.slice(start, end).trim(), letter: marker[1]! };
  });
}

/**
 * Whether an option's text reads as a full sentence rather than a bare label: it must end in terminal
 * punctuation and carry at least one word before it. A single-word imperative ("Hold.") is a complete
 * sentence; a bare label ("2-way") is not, because it never terminates.
 */
function isFullSentence({ text }: { text: string }): boolean {
  return /[.!?]$/.test(text) && wordCount({ text }) >= 1;
}

const NUMBER_WORD = /\b\d+-[a-zA-Z]+\b/;
const TITLE_CASE_PHRASE = /\b[A-Z][a-zA-Z']*(?:\s+[A-Z][a-zA-Z']*)+\b/g;

/**
 * The first Title-Case phrase or bare number-word (e.g. `2-way`) in `text` that `vocabulary` never defines,
 * or `undefined` when every such term is defined elsewhere in the card.
 */
function undefinedLabelIn({ text, vocabulary }: { text: string; vocabulary: string }): string | undefined {
  const numberWord = NUMBER_WORD.exec(text)?.[0];
  if (numberWord !== undefined && !vocabulary.includes(numberWord)) {
    return numberWord;
  }
  for (const phrase of text.matchAll(TITLE_CASE_PHRASE)) {
    if (!vocabulary.includes(phrase[0])) {
      return phrase[0];
    }
  }
  return undefined;
}
