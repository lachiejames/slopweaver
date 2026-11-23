/**
 * Pure parser + checker for the fleet-briefing artifact's react-now block
 * (`skills/supervisor/reference/fleet-briefing-shape.md`).
 *
 * A react-now card's required shape is stated there in prose — a one-sentence question, a `what` with at
 * least two sentences of background, `why you`, `options` where every option is a full sentence with no
 * undefined label, `lean`, `if silent` — and prose is ignorable. This module is that shape as a gate: it
 * parses every card between `<h2>react now</h2>` and the next `<h2>` and reports every field a card is
 * missing, so a publish step can refuse the file instead of trusting the prose. Zero I/O — the CLI edge
 * reads the file; this only ever sees the HTML as a string.
 *
 * ## Presence is not the defect that matters
 *
 * A gate that only checks that a field EXISTS passes a card clean whose `what` runs to 496 words — a
 * wall of text that is difficult to react to, which happens often enough that mechanical enforcement is the
 * right answer. So every field also carries a hard word and sentence cap from `./caps.ts`, measured above the fold, plus the
 * same packing and voice rules `../outbound/voice/aboveFold.ts` already applies at every other outbound
 * door. Length and packing are what make a card unreactable; presence never was.
 *
 * ## Readiness is READ off the page, and the order is a rule of its own
 *
 * A card declares whether it is the owner's to answer now, and `../outbound/briefing/render.ts` puts every ready card
 * above every waiting one. This module reads that declaration back off the rendered bytes and refuses two
 * things: a waiting card ranked above a ready one, and a card
 * claiming to be ready while its own `what` says a session is still working. `./cardReadiness.ts` carries
 * the criterion, the measurement behind it and why it is narrow.
 *
 * ## The voice half is `./cardVoice.ts`
 *
 * Which of a card's regions are authored PROSE, what the shared voice rules find in them, and the five
 * `dl.f` labels that name them all live there — this module widens that module's {@link DlField} into its
 * own {@link CardField} and pushes what {@link pushVoiceDefects} finds, so the edge runs one way only.
 */
import type { ExactVoiceRule } from "../outbound/voice/exactRules.js";
import { adminMergeOffer, adminMergeRefusal } from "./adminMergeOffer.js";
import {
  CARD_ABOVE_FOLD_MAX_WORDS,
  QUESTION_MAX_WORDS,
  SHORT_FIELD_MAX_SENTENCES,
  SHORT_FIELD_MAX_WORDS,
  WHAT_MAX_SENTENCES,
  WHAT_MAX_WORDS,
  WHY_YOU_MAX_SENTENCES,
} from "./caps.js";
import { checkOptions } from "./cardOptions.js";
import { premiseRefusal, unusablePremiseInstant } from "./cardPremise.js";
import { readinessRefusal, sessionStillWorking, waitingAboveReadyRefusal } from "./cardReadiness.js";
import { reactNowCardSpans } from "./cardSpans.js";
import {
  briefingTargetOfSubjectUrl,
  isAbsoluteSubjectUrl,
  isNoPageSubjectText,
  isPlainSubjectUrl,
  NO_PAGE_PREFIX,
  renderedCardSubject,
  subjectEncodedLinkRefusal,
  subjectRelativeLinkRefusal,
  subjectSelfLinkRefusal,
} from "./cardSubject.js";
import { DL_FIELD_LABELS, type DlField, pushVoiceDefects } from "./cardVoice.js";
import { commandAboveFoldRefusal, hiddenCommand } from "./commandAboveFold.js";
import {
  doctrineSettled,
  doctrineSettledRefusal,
  mechanismFramed,
  mechanismFramedRefusal,
  missingWarrant,
  WARRANT_ADVICE,
} from "./doctrineSettled.js";
import { fleetJargonRefusal, ungloss } from "./fleetJargon.js";
import { isMarkdownSubjectUrl, markdownSubjectRefusal } from "./markdownSubject.js";
import { ownHandAction, ownHandRefusal } from "./ownHandAction.js";
import { misroutedReplyChannel, replyChannelRefusal } from "./replyChannel.js";
import { aboveFoldText, plainText, sentenceCount, wordCount } from "./text.js";

/**
 * Which required field a defect is about. `question` is the bolded `.q` line; the rest are `dl.f` labels.
 *
 * @internal — the declared shape {@link checkReactNowCards} and its renderer share; no caller outside this
 * module names it directly.
 */
export type CardField = DlField | "question" | "subject" | "readiness" | "premise";

/**
 * One field a react-now card failed to carry, or carried in a shape the contract refuses.
 *
 * @internal — the row shape {@link checkReactNowCards} returns; no caller names it directly.
 */
export interface CardDefect {
  /** 1-based position of the card within the react-now block. */
  readonly card: number;
  /** The card's own question (or, lacking one, its opening text), for identifying it in output. */
  readonly question: string;
  readonly field: CardField;
  readonly reason: string;
}

/**
 * What checking a fleet-briefing artifact's react-now block found.
 *
 * @internal — the return shape {@link checkReactNowCards} and its renderer share; no caller names it
 * directly.
 */
export interface ReactNowCheck {
  readonly cardsChecked: number;
  readonly defects: readonly CardDefect[];
  /** Structural problems that stopped a card (or the whole block) from being read at all. */
  readonly parseProblems: readonly string[];
}

/**
 * A briefing page split at its react-now heading.
 *
 * @internal — the shape {@link reactNowRegion} returns for `./pageBudget.ts`; no other caller names it.
 */
export interface ReactNowRegion {
  /** The markup between `<h2>react now</h2>` and the next `<h2>`, absent when there is no such heading. */
  readonly block: string | undefined;
  /** Everything else on the page, react-now block removed, so a page rule cannot count a card twice. */
  readonly outside: string;
}

/**
 * The heading that opens the block, attributes and all.
 *
 * `[^>]*` rather than a bare `<h2>` because the rendered page carries an `id` on every section heading, so a
 * react-now card can anchor down into a section further along the same page — see
 * `../outbound/briefing/types.ts`'s anchor run. Matching the attribute list keeps this reader working over a
 * page rendered before ids existed as well as one rendered after.
 */
const REACT_NOW_HEADING = /<h2[^>]*>\s*react now\s*<\/h2>/i;
const ANY_H2_OPEN = /<h2[ >]/i;
const QUESTION_DIV = /<div class="q">([\s\S]*?)<\/div>/;
/**
 * The mark `../outbound/briefing/render.ts` puts on a card that waits on a session.
 *
 * An ATTRIBUTE rather than a second class, which is why `./cardSpans.ts`'s card pattern still matches every card
 * — see that renderer's `renderWaitLine` for the reason. A card carrying no mark declares itself ready, which
 * is also how every page rendered before this field existed reads, and correctly so: those cards WERE all
 * being offered to the owner as answerable.
 */
const WAITING_MARK = /<div class="need"[^>]*\bdata-readiness="waiting"/;
/**
 * The line a waiting card puts under its question, naming the session and the event.
 *
 * Matched by its OPENING rather than by its whole shape: a lazy `[\s\S]*?` reaching for the closing tag is
 * polynomial backtracking, which `redos-check` refuses, and nothing here reads the captured text — the gate
 * asks whether the line is present, and the form is what bounds what it says.
 */
const WAIT_LINE = /<div class="wait">\s*waiting on\s/;
/**
 * The renderer's own age line, with the premise instant it was computed from.
 *
 * An attribute rather than a parsed stamp, because the words are for the owner and the instant is for this gate —
 * a reader that had to date "10 days old" against a page it did not render would be re-deriving what the
 * renderer already knew.
 */
const AGE_DIV = /<div class="age"[^>]*\bdata-premise-iso="([^"]*)"[^>]*>[\s\S]*?<\/div>/;
/**
 * The same element, for REMOVAL before the composer's caps are measured.
 *
 * The age line is renderer-owned provenance: a composer can neither write it nor shorten it, so charging its
 * words against a cap the composer has to meet would refuse a card for the renderer's sentence. That is the
 * one thing that separates it from the wait line, whose `session` and `event` the composer does write and
 * which therefore does count.
 */
const AGE_DIV_GLOBAL = /<div class="age"[^>]*>[\s\S]*?<\/div>/g;
const FIELD_DL = /<dl class="f">([\s\S]*?)<\/dl>/;
const DT_DD_PAIR = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;

/** Every field a defect can name, by its `CardField` key, for a renderer and for a voice-cell path. */
export const CARD_FIELD_LABELS: Readonly<Record<CardField, string>> = {
  ...DL_FIELD_LABELS,
  premise: "premise",
  question: "question",
  readiness: "readiness",
  subject: "subject",
};

/** Every `dl.f` field, in card order — a literal so a missing-`dl` card can report all five without a cast. */
const ALL_DL_FIELDS: readonly DlField[] = ["what", "whyYou", "options", "lean", "ifSilent"];

/** The three fields that carry one claim rather than background, and share one pair of caps. */
const SHORT_FIELDS: readonly Exclude<DlField, "what" | "options">[] = ["whyYou", "lean", "ifSilent"];

/**
 * Split a briefing page at its react-now heading.
 *
 * @param html the whole artifact file
 * @returns the react-now block and everything outside it
 */
export function reactNowRegion({ html }: { html: string }): ReactNowRegion {
  const headingMatch = REACT_NOW_HEADING.exec(html);
  if (headingMatch === null) {
    return { block: undefined, outside: html };
  }
  const blockStart = headingMatch.index + headingMatch[0].length;
  const afterHeading = html.slice(blockStart);
  const nextHeading = ANY_H2_OPEN.exec(afterHeading);
  const blockLength = nextHeading === null ? afterHeading.length : nextHeading.index;
  return {
    block: afterHeading.slice(0, blockLength),
    outside: html.slice(0, blockStart) + afterHeading.slice(blockLength),
  };
}

/**
 * Check one fleet-briefing artifact's react-now block against its required card shape and its hard caps.
 *
 * @param html the whole artifact file
 * @param rules the operator's private exact voice rules, empty when none are configured
 * @param applyVoice whether the packing and voice pass runs, lifted by the shared break-glass at the door
 * @returns every card checked, every defect found, and any structural parse problem
 */
export function checkReactNowCards({
  html,
  rules,
  applyVoice,
  applyFraming,
  nowIso,
}: {
  html: string;
  rules: readonly ExactVoiceRule[];
  applyVoice: boolean;
  /** Whether the four card-framing rules run, lifted by `CARD_FRAMING_OVERRIDE_ENV` at the door. */
  applyFraming: boolean;
  nowIso: string;
}): ReactNowCheck {
  const { block } = reactNowRegion({ html });
  if (block === undefined) {
    return { cardsChecked: 0, defects: [], parseProblems: ["no `<h2>react now</h2>` heading found"] };
  }
  const cards = reactNowCardSpans({ block });
  const defects = [
    ...cards.flatMap((card, i) =>
      checkCard({
        applyFraming,
        applyVoice,
        cardHtml: card.cardHtml,
        index: i + 1,
        nowIso,
        ownHand: card.ownHand,
        rules,
      }),
    ),
    ...checkReadinessOrder({ cards: cards.map((card) => card.cardHtml) }),
  ];
  return { cardsChecked: cards.length, defects, parseProblems: [] };
}

/**
 * Every waiting card that ranks above one the owner can answer now.
 *
 * The whole block in page order, not either grouping on its own, because the order the owner reads is the order the
 * page renders and a waiting team-facing card sits above every me-facing one. `../outbound/briefing/render.ts`
 * partitions so this can never fire on a page it produced; what it catches is a hand-written page, and a
 * renderer that stopped partitioning.
 *
 * Reported once per offending card rather than once per pair — a waiting card above five ready ones is one
 * thing to move, and five identical lines are the wall of text the gate above already refuses.
 *
 * @param cards each card's own markup, in page order
 * @returns one defect per waiting card that outranks a ready one
 */
function checkReadinessOrder({ cards }: { cards: readonly string[] }): readonly CardDefect[] {
  const waiting = cards.map((cardHtml) => WAITING_MARK.test(cardHtml));
  const defects: CardDefect[] = [];
  cards.forEach((cardHtml, index) => {
    if (!waiting[index]) {
      return;
    }
    const below = waiting.indexOf(false, index + 1);
    if (below < 0) {
      return;
    }
    defects.push({
      card: index + 1,
      field: "readiness",
      question: cardQuestionLabel({ cardHtml }),
      reason: waitingAboveReadyRefusal({ card: index + 1, ready: below + 1 }),
    });
  });
  return defects;
}

/**
 * The one callback every per-field checker below reports a defect through.
 *
 * @internal — the declared shape {@link checkCard} builds and its field-checkers accept; no caller outside
 * this module names it directly.
 */
type PushDefect = (args: { field: CardField; reason: string }) => void;

/** Every defect found in one card, naming the card and the missing, over-long or badly-packed field. */
function checkCard({
  applyFraming,
  applyVoice,
  cardHtml,
  index,
  nowIso,
  ownHand,
  rules,
}: {
  applyFraming: boolean;
  applyVoice: boolean;
  cardHtml: string;
  index: number;
  nowIso: string;
  ownHand: boolean;
  rules: readonly ExactVoiceRule[];
}): readonly CardDefect[] {
  const defects: CardDefect[] = [];
  const questionRaw = QUESTION_DIV.exec(cardHtml)?.[1];
  const label = cardQuestionLabel({ cardHtml });
  const push: PushDefect = ({ field, reason }) => {
    defects.push({ card: index, field, question: label, reason });
  };

  checkQuestion({ push, questionRaw });
  // Before the `dl.f` early return: the subject line sits OUTSIDE that block, so a card missing its fields
  // entirely still has its subject judged rather than silently skipped.
  checkSubject({ cardHtml, push });
  const dl = FIELD_DL.exec(cardHtml)?.[1];
  if (dl === undefined) {
    for (const field of ALL_DL_FIELDS) {
      push({ field, reason: "missing" });
    }
    return defects;
  }

  const fields = fieldMap({ dl });
  checkWhat({ fields, push });
  for (const field of SHORT_FIELDS) {
    checkShortField({ field, fields, push });
  }
  checkOptions({ applyFraming, cardHtml, fields, ownHand, push, questionRaw });
  checkIfSilentRouting({ fields, push });
  checkReadiness({ cardHtml, fields, push });
  checkAdminMergeOffers({ fields, push });
  if (applyFraming) {
    checkPremise({ cardHtml, index, nowIso, push });
    checkFleetJargon({ fields, push, questionRaw });
    checkDecidability({ fields, push, questionRaw });
  }
  if (ownHand) {
    checkOwnHandWhat({ fields, push });
    checkCommandAboveFold({ cardHtml, push });
  }
  checkCardBudget({ cardHtml, push });
  if (applyVoice) {
    pushVoiceDefects({ fields, push, questionRaw, rules });
  }
  return defects;
}

/**
 * The card's subject line: never a link back into this page, and `no page` when it carries no link at all.
 *
 * The reader half of `../outbound/briefing/schema.ts`'s own subject rules, over the rendered bytes rather
 * than the form — so a page another tool produced, or one a session hand-wrote, fails on exactly what the
 * form refuses. A card with no subject line at all is not this check's business: the form already decides
 * whether a card owes one.
 *
 * @param cardHtml the card's own markup
 * @param push where a defect is recorded
 */
function checkSubject({ cardHtml, push }: { cardHtml: string; push: PushDefect }): void {
  const subject = renderedCardSubject({ cardHtml });
  if (subject === undefined) {
    return;
  }
  if (subject.url === undefined) {
    if (!isNoPageSubjectText({ text: plainText({ html: subject.text }) })) {
      push({
        field: "subject",
        reason:
          `carries no link, so it must begin with \`${NO_PAGE_PREFIX}\` — a bare title with nothing to open ` +
          "reads as a link that failed to render.",
      });
    }
    return;
  }
  // Anything a browser resolves against the CURRENT page — empty, `#`, `#frag`, `/path`, `//host/path` — is
  // this rule again with the evidence removed, and the form's own `z.url()` refuses every one of them. A
  // reader admitting what the form refuses is the two halves disagreeing, which is the one failure the pair
  // cannot afford.
  if (!isAbsoluteSubjectUrl({ url: subject.url })) {
    push({ field: "subject", reason: subjectRelativeLinkRefusal() });
    return;
  }
  // Before the fragment test, not after: a character reference makes the bytes and the resolved link
  // disagree, so judging the bytes would be judging a link nobody follows.
  if (!isPlainSubjectUrl({ url: subject.url })) {
    push({ field: "subject", reason: subjectEncodedLinkRefusal() });
    return;
  }
  const target = briefingTargetOfSubjectUrl({ url: subject.url });
  if (target !== undefined) {
    push({ field: "subject", reason: subjectSelfLinkRefusal({ target }) });
    return;
  }
  // A markdown document is a raw-text tab the owner cannot react to; `./markdownSubject.ts` owns
  // the criterion, and this is the reader's half of the same rule the form runs.
  if (isMarkdownSubjectUrl({ url: subject.url })) {
    push({ field: "subject", reason: markdownSubjectRefusal() });
  }
}

/** The `dl.f` block's `dt`/`dd` pairs, keyed by the trimmed, lower-cased label text. First-wins on a dupe. */
function fieldMap({ dl }: { dl: string }): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const pair of dl.matchAll(DT_DD_PAIR)) {
    const key = plainText({ html: pair[1]! }).toLowerCase();
    if (key.length > 0 && !map.has(key)) {
      map.set(key, pair[2]!);
    }
  }
  return map;
}

/** A word cap's refusal, naming the field, the count and the cap in plain words. */
function overWords({ label, words, cap }: { label: string; words: number; cap: number }): string {
  return (
    `${String(words)} words above the fold, over the cap of ${String(cap)}. ` +
    `Cut ${label} down, or move the rest into a details fold inside the card.`
  );
}

/** A sentence cap's refusal, in the same plain words. */
function overSentences({ words, cap }: { words: number; cap: number }): string {
  return (
    `${String(words)} sentences above the fold, over the cap of ${String(cap)}. ` +
    "Keep the ones the owner has to read to decide, and fold the rest."
  );
}

function checkQuestion({ push, questionRaw }: { push: PushDefect; questionRaw: string | undefined }): void {
  if (questionRaw === undefined) {
    push({ field: "question", reason: "no `.q` question block found" });
    return;
  }
  const text = aboveFoldText({ html: questionRaw }).replace(/^\d+\.\s*/, "");
  if (sentenceCount({ text }) !== 1 || !text.endsWith("?")) {
    push({ field: "question", reason: "must be exactly one sentence, phrased as a question ending in `?`" });
  }
  const words = wordCount({ text });
  if (words > QUESTION_MAX_WORDS) {
    push({ field: "question", reason: overWords({ cap: QUESTION_MAX_WORDS, label: "the question", words }) });
  }
}

function checkWhat({ fields, push }: { fields: ReadonlyMap<string, string>; push: PushDefect }): void {
  const raw = fields.get("what");
  if (raw === undefined) {
    push({ field: "what", reason: "missing" });
    return;
  }
  const text = aboveFoldText({ html: raw });
  const sentences = sentenceCount({ text });
  if (sentences < 2) {
    push({ field: "what", reason: "fewer than two sentences of background" });
  }
  if (sentences > WHAT_MAX_SENTENCES) {
    push({ field: "what", reason: overSentences({ cap: WHAT_MAX_SENTENCES, words: sentences }) });
  }
  const words = wordCount({ text });
  if (words > WHAT_MAX_WORDS) {
    push({ field: "what", reason: overWords({ cap: WHAT_MAX_WORDS, label: "the background", words }) });
  }
}

/** A field that carries one claim: it must exist, and stay inside the short-field caps. */
function checkShortField({
  field,
  fields,
  push,
}: {
  field: Exclude<DlField, "what" | "options">;
  fields: ReadonlyMap<string, string>;
  push: PushDefect;
}): void {
  const label = DL_FIELD_LABELS[field];
  const raw = fields.get(label);
  const text = raw === undefined ? "" : aboveFoldText({ html: raw });
  if (text.length === 0) {
    push({ field, reason: "missing" });
    return;
  }
  const cap = field === "whyYou" ? WHY_YOU_MAX_SENTENCES : SHORT_FIELD_MAX_SENTENCES;
  const sentences = sentenceCount({ text });
  if (sentences > cap) {
    push({ field, reason: overSentences({ cap, words: sentences }) });
  }
  const words = wordCount({ text });
  if (words > SHORT_FIELD_MAX_WORDS) {
    push({ field, reason: overWords({ cap: SHORT_FIELD_MAX_WORDS, label: label, words }) });
  }
}

/**
 * A me-facing card's `what`, which reports on work only the owner sees and so may not end by handing them the
 * last step — see `./ownHandAction.ts`. Not `imperative`: a `what` is background, never an instruction addressed
 * to the owner, so a sentence opening on a verb is describing the fleet.
 */
function checkOwnHandWhat({ fields, push }: { fields: ReadonlyMap<string, string>; push: PushDefect }): void {
  const raw = fields.get(DL_FIELD_LABELS.what);
  if (raw === undefined) {
    return;
  }
  const ownHanded = ownHandAction({ imperative: false, text: aboveFoldText({ html: raw }) });
  if (ownHanded !== undefined) {
    push({ field: "what", reason: ownHandRefusal({ cell: "what", phrase: ownHanded }) });
  }
}

/** One `<code>` element's inner markup. `code` never nests, so a non-greedy match is safe here. */
const CODE_ELEMENT = /<code\b[^>]*>([\s\S]*?)<\/code>/gi;

/**
 * A me-facing card may not hide behind its own fold a command the owner has to type — see
 * `./commandAboveFold.ts` for the criterion and the measurement.
 *
 * Every `<code>` in the card is read, not only the ones inside `<details>`, and that is the same check
 * rather than a wider one: a command ABOVE the fold is trivially present in the above-the-fold text, so it
 * satisfies itself and only a folded one can ever be reported. Isolating the fold first would buy the same
 * verdict and one more place for the two surfaces to drift.
 *
 * @param cardHtml the whole card's markup, fold included
 * @param push the defect sink
 */
function checkCommandAboveFold({ cardHtml, push }: { cardHtml: string; push: PushDefect }): void {
  // `match[1]!`: the pattern has exactly one capture group and it is not optional, so a match always has it.
  const commands = [...cardHtml.matchAll(CODE_ELEMENT)].map((match) => plainText({ html: match[1]! }));
  const hidden = hiddenCommand({ aboveFold: aboveFoldText({ html: cardHtml }), commands });
  if (hidden !== undefined) {
    push({ field: "what", reason: commandAboveFoldRefusal({ command: hidden }) });
  }
}

/**
 * `lean` and `if silent` are where an option's substance is repeated back to the owner, so an administrator merge
 * refused in `options` and restated in either of them is the same unanswerable choice wearing another field
 * — see `./adminMergeOffer.ts`. `options` itself is checked per option, beside its own reply-channel and
 * own-hand checks.
 *
 * @param fields the card's `dl.f` pairs
 * @param push the defect sink
 */
function checkAdminMergeOffers({ fields, push }: { fields: ReadonlyMap<string, string>; push: PushDefect }): void {
  for (const field of ["lean", "ifSilent"] as const) {
    const raw = fields.get(DL_FIELD_LABELS[field]);
    if (raw === undefined) {
      continue;
    }
    const offer = adminMergeOffer({ text: aboveFoldText({ html: raw }) });
    if (offer !== undefined) {
      push({ field, reason: adminMergeRefusal({ cell: CARD_FIELD_LABELS[field], phrase: offer }) });
    }
  }
}

/**
 * `if silent` describes what happens when the owner says nothing, so a channel word in it is the same misrouting
 * an option carries — "if you don't react by morning" tells the owner to react, in the sentence about not answering.
 */
function checkIfSilentRouting({ fields, push }: { fields: ReadonlyMap<string, string>; push: PushDefect }): void {
  const raw = fields.get(DL_FIELD_LABELS.ifSilent);
  if (raw === undefined) {
    return;
  }
  const misrouted = misroutedReplyChannel({ text: aboveFoldText({ html: raw }) });
  if (misrouted !== undefined) {
    push({ field: "ifSilent", reason: replyChannelRefusal({ cell: "if silent", phrase: misrouted }) });
  }
}

/**
 * The two things a card's declared readiness owes: a wait line when it waits, and a `what` that agrees.
 *
 * A card carrying the waiting mark and no wait line announces it is not answerable while telling the owner nothing
 * they could act on — which session, and what has to happen. A card carrying NO mark is claiming to be ready,
 * and `./cardReadiness.ts` is what refuses that claim when the card's own `what` says otherwise.
 */
function checkReadiness({
  cardHtml,
  fields,
  push,
}: {
  cardHtml: string;
  fields: ReadonlyMap<string, string>;
  push: PushDefect;
}): void {
  if (WAITING_MARK.test(cardHtml)) {
    if (!WAIT_LINE.test(cardHtml)) {
      push({
        field: "readiness",
        reason:
          "the card is marked as waiting and carries no `waiting on <session> · <event>` line, so it says " +
          "the owner cannot answer it yet and never says what would change that.",
      });
    }
    return;
  }
  const raw = fields.get(DL_FIELD_LABELS.what);
  if (raw === undefined) {
    return;
  }
  const working = sessionStillWorking({ text: aboveFoldText({ html: raw }) });
  if (working !== undefined) {
    push({ field: "what", reason: readinessRefusal({ cell: "what", phrase: working }) });
  }
}

/**
 * The card's premise instant: present, parseable, and not in the future.
 *
 * A card with no premise is a card the owner has to date by opening the thing it is about, which is the read
 * the age line exists to save. There is deliberately NO age CAP here — whether an old but un-overtaken card is
 * dropped, re-graded or merely stamped is the owner's call about their own attention.
 */
function checkPremise({
  cardHtml,
  index,
  nowIso,
  push,
}: {
  cardHtml: string;
  index: number;
  nowIso: string;
  push: PushDefect;
}): void {
  const instant = AGE_DIV.exec(cardHtml)?.[1];
  if (instant === undefined) {
    push({ field: "premise", reason: premiseRefusal({ card: index, reason: "the card carries no age line." }) });
    return;
  }
  const unusable = unusablePremiseInstant({ instant, nowIso });
  if (unusable !== undefined) {
    push({ field: "premise", reason: premiseRefusal({ card: index, reason: unusable }) });
  }
}

/**
 * Every fleet word the card used above the fold without saying what it means, there.
 *
 * The SUBJECT line is deliberately not read: it is the subject's own title, and a rule about the fleet's
 * vocabulary has no business refusing a card because somebody named their branch `settled-ask-row`. That is
 * the same call the voice pass already makes about the same run.
 */
function checkFleetJargon({
  fields,
  push,
  questionRaw,
}: {
  fields: ReadonlyMap<string, string>;
  push: PushDefect;
  questionRaw: string | undefined;
}): void {
  const found = ungloss({ aboveFold: cardAboveFoldProse({ fields, questionRaw }) });
  if (found !== undefined) {
    push({ field: "what", reason: fleetJargonRefusal({ cell: "the card", found }) });
  }
}

/**
 * Every AUTHORED word the card puts above the fold, options included and the subject line excluded.
 *
 * Deliberately not {@link cardVocabulary}, which reads folded text on purpose — a Title-Case label explained
 * in a fold IS defined, while a fleet word explained only in a fold is one the owner meets unexplained in the
 * sentence they are being asked to act on. Two rules, two readings, and the difference is the whole of rule 1.
 */
function cardAboveFoldProse({
  fields,
  questionRaw,
}: {
  fields: ReadonlyMap<string, string>;
  questionRaw: string | undefined;
}): string {
  const cells = [questionRaw, ...ALL_DL_FIELDS.map((field) => fields.get(DL_FIELD_LABELS[field]))];
  return cells
    .filter((value): value is string => value !== undefined)
    .map((html) => aboveFoldText({ html }))
    .join(" ");
}

/**
 * Whether the card is the owner's to answer at all: the hard half, then the floor.
 *
 * See `./doctrineSettled.ts` for why only the first of the two bites, and say so whenever this rule is
 * quoted — six of the seven cards it was built from already cleared the floor.
 */
function checkDecidability({
  fields,
  push,
  questionRaw,
}: {
  fields: ReadonlyMap<string, string>;
  push: PushDefect;
  questionRaw: string | undefined;
}): void {
  if (questionRaw !== undefined) {
    const question = aboveFoldText({ html: questionRaw }).replace(/^\d+\.\s*/, "");
    const settled = doctrineSettled({ question });
    if (settled !== undefined) {
      push({ field: "question", reason: doctrineSettledRefusal({ found: settled }) });
    }
    const framed = mechanismFramed({ question });
    if (framed !== undefined) {
      push({ field: "question", reason: mechanismFramedRefusal({ phrase: framed }) });
    }
  }
  const raw = fields.get(DL_FIELD_LABELS.whyYou);
  if (raw === undefined) {
    return;
  }
  if (missingWarrant({ whyYou: aboveFoldText({ html: raw }) })) {
    push({ field: "whyYou", reason: `\`why you\` names no reason the decision is the owner's. ${WARRANT_ADVICE}` });
  }
}

/**
 * The whole card's words above the fold — every cell, the question and the subject, with the age line left
 * out because it is the renderer's and not the composer's.
 *
 * @param cardHtml the card's own markup
 * @returns the word count the card budget is judged on
 *
 * @internal — exported for `./openPageRow.ts`, which reports the count `briefing card` just wrote.
 */
export function cardAboveFoldWords({ cardHtml }: { cardHtml: string }): number {
  return wordCount({ text: aboveFoldText({ html: cardHtml.replace(AGE_DIV_GLOBAL, "") }) });
}

/** The whole card's above-the-fold budget: the backstop the six per-field caps cannot see between them. */
function checkCardBudget({ cardHtml, push }: { cardHtml: string; push: PushDefect }): void {
  const words = cardAboveFoldWords({ cardHtml });
  if (words > CARD_ABOVE_FOLD_MAX_WORDS) {
    push({
      field: "question",
      reason:
        `the whole card is ${String(words)} words above the fold, over the cap of ` +
        `${String(CARD_ABOVE_FOLD_MAX_WORDS)}. Every field is short enough on its own and the card still is ` +
        "not. Fold something.",
    });
  }
}

/**
 * A short, tag-free label for a card, for naming it in a defect without repeating its full text.
 *
 * @param text the card's question block, or the whole card when it carries none
 * @returns the label, capped at 80 characters
 *
 * @internal — exported for `./prPremise.ts`, whose defects name a card the same way this module's do.
 */
export function cardLabel({ text }: { text: string }): string {
  const plain = aboveFoldText({ html: text }).replace(/^\d+\.\s*/, "");
  return plain.length > 80 ? `${plain.slice(0, 77)}...` : plain;
}

/**
 * The label a defect names one card by: its question, or the whole card when it carries none.
 *
 * @param cardHtml one card's own markup, from `./cardSpans.ts`'s `extractCards`
 * @returns the label, capped the way {@link cardLabel} caps it
 */
export function cardQuestionLabel({ cardHtml }: { cardHtml: string }): string {
  return cardLabel({ text: QUESTION_DIV.exec(cardHtml)?.[1] ?? cardHtml });
}
