/**
 * A bot post to the owner's own DM that ASKS them something is refused, whatever purpose it declares.
 *
 * A card in that DM ending "reply yes and i will switch it on" belongs in the queue: the owner does not check the
 * DMs, so an ask there gets missed.
 *
 * `./dmPurpose.ts` already makes a post there DECLARE what it is for, and states its residue: a declaration is
 * not a content check, so a caller that labels a question `investigation-finding` is admitted. That residue
 * is exactly what shipped the card above. This module is the content half: it reads the words a reader
 * would see and refuses one that asks the owner something or names something waiting on them, pointing the sender
 * at `handover ask` / `handover register` and the console's Queue page, which is where the owner reads what is
 * waiting on them.
 *
 * ## The criterion
 *
 * A cell of AUTHORED prose (`../artifact/aboveFold.ts` already drops link labels, mentions, citation chips and
 * quoted runs — somebody else's words, which may be a question) asks the owner something when it either:
 *
 * - closes a word with a question mark followed by whitespace or the end of the cell — `run it daily?`, not
 *   `x?.y`. A mark after WHITESPACE counts too: a skipped run leaves one space where it stood, so
 *   `ready in <link>?` reaches here as `ready in  ?` once the reference is linkified. A
 *   ternary is a code run, and code runs are skipped before this reads anything; or
 * - carries one of {@link ASK_PHRASES} or {@link PRONOUN_ASKS}, each an ask or a wait addressed to the owner
 *   without needing a `?`: `reply yes and i will switch it on` is the incident, and it carries no question mark at
 *   all; or
 * - names a wait on a PERSON'S act, in any of the three places English puts the person ({@link PERSON_WAITS}):
 *   before the act as a possessive (_"blocked pending the owner’s approval"_), after it with `from` or
 *   `by` (_"waiting on approval from the owner"_), or as the subject of a verb after `until`, `once`,
 *   `when`, `after`, `if` or `before` (_"held until the owner approves"_). ANY named person counts, not only
 *   the owner: `displayName` may be empty on an install, so there is no configured name to narrow to,
 *   and a finding that says "pending Sadie's approval" in the owner's DM is refused and restated ("Sadie has not
 *   approved it yet") at the cost of one rewrite, where the narrower reading lets the ask through.
 *
 * It is a TELL, not a fence, and that is its contract rather than a gap in it: English has no finite list of
 * ways to ask, so a question phrased around all three shapes gets through, and each shape a review finds is
 * added here. The refusal is what makes the rule visible to the session that wrote it. The false-positive side is a finding that states its
 * point as a question, and the fix there is to state it — a finding the owner might share reads better as a claim.
 *
 * ## What it does not read
 *
 * A `automation-prompt` is the bot's own instructions: its question is addressed to the bot, not to the owner,
 * and `./automationPromptChannel.ts` is what puts it in the owner's DM. Anywhere other than the owner's DM is out of scope.
 * A live bot turn's replies and `slack edit` are outside the door this runs in, for the reasons
 * `./dmPurpose.ts` § "Where it is asked" gives.
 *
 * ## No hatch, and the refusal says so
 *
 * `.claude/rules/error-handling.md` § "A `hold` has no hatch, and says so". An override would be a documented
 * way to ask the owner in the DM, which is the whole thing this hold rules out; the queue is always available instead.
 */
import type { AboveFoldCell } from "../voice/aboveFold.js";
import { isAutomationPrompt } from "./automationPromptChannel.js";
import { isOwnerDm } from "./dmPurpose.js";

/**
 * Phrases that ask the owner something, or name something waiting on them, with or without a question mark.
 * Matched case-insensitively on word boundaries. `reply yes` is the incident verbatim; `blocked on you` and
 * `waiting on you` are the cards the rule was first written for. Each is addressed to the OWNER — a bare
 * "approval", "waiting" or "held" is not here, because a finding reports those states about other people and
 * systems. The third-person spellings are {@link PRONOUN_ASKS}.
 */
export const ASK_PHRASES = [
  "reply yes",
  "reply no",
  "reply with",
  "reply in",
  "reply to",
  "let me know",
  "blocked on you",
  "waiting on you",
  "waiting for you",
  "waiting on your",
  "waiting for your",
  "awaiting your",
  "needs your",
  "your approval",
  "your sign-off",
  "your go-ahead",
  "your say-so",
  "your yes",
  "your decision",
  "your call",
  "up to you",
  "should i",
  "shall i",
  "can you",
  "could you",
  "would you",
  "will you",
  "do you want",
  "please approve",
  "please confirm",
  "please decide",
  "please review",
  "please reply",
] as const;

/**
 * The same asks spelled in the third person, as patterns, one per phrase: `blocked on`, `waiting on` and `waiting
 * for` + object pronoun, and `awaiting` and `needs` + possessive. Word-bounded and case-insensitive like
 * {@link ASK_PHRASES}.
 */
const PRONOUN_ASKS = [
  /(?<![\p{L}\p{N}])blocked\p{White_Space}+on\p{White_Space}+him(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])waiting\p{White_Space}+on\p{White_Space}+him(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])waiting\p{White_Space}+for\p{White_Space}+him(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])awaiting\p{White_Space}+his(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])needs\p{White_Space}+his(?![\p{L}\p{N}])/iu,
] as const;

/**
 * A question mark closing a word, or standing where a skipped run closed one: followed by whitespace or the end
 * of the text. Whitespace is Unicode `White_Space` throughout this module, never JavaScript's narrower class,
 * which misses U+0085.
 */
const QUESTION = /[\p{L}\p{M}\p{N})\]"'’\p{White_Space}]\?(?=\p{White_Space}|$)/u;

/**
 * A wait on a person's act, one pattern per place the person can stand. Each REQUIRES a named person, because
 * "pending approval" with no one named is a state a finding reports about a system as often as about the owner. A
 * bare name is a capitalised word, so the two patterns that take one are case-sensitive and spell their own
 * leading capitals.
 *
 * - possessive first: "blocked pending the owner’s approval", "held until the owner's go-ahead";
 * - person after the act: "waiting on approval from the owner", "sign-off by the owner";
 * - person as the subject: "held until the owner approves", "once you sign off".
 */
const PERSON_WAITS = [
  /(?<![\p{L}\p{N}])(?:pending|awaiting|waiting\p{White_Space}+(?:on|for)|needs|blocked\p{White_Space}+(?:on|by|until)|held\p{White_Space}+(?:for|until)|until)\p{White_Space}+(?:his|your|(?:the\p{White_Space}+)?[\p{L}\p{N}-]+['’]s?)\p{White_Space}+(?:approval|sign-?off|go-?ahead|say-?so|decision|answer|reply|yes|ok|okay)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:[Aa]pproval|[Ss]ign-?off|[Gg]o-?ahead|[Ss]ay-?so|[Dd]ecision|[Aa]nswer)\p{White_Space}+(?:from|by)\p{White_Space}+(?:him|you|the\p{White_Space}+owner|\p{Lu}\p{Ll}+)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:[Uu]ntil|[Oo]nce|[Ww]hen|[Aa]fter|[Ii]f|[Bb]efore)\p{White_Space}+(?:he|you|the\p{White_Space}+owner|\p{Lu}\p{Ll}+)\p{White_Space}+(?:approves?|signs?\p{White_Space}+off|decides?|says?\p{White_Space}+yes|OKs?)(?![\p{L}\p{N}])/u,
] as const;

/**
 * The words that make a following `reply` a NOUN — "a reply in JSON", "the reply to the ticket" — which a
 * finding reports, rather than the imperative "reply in the thread" that asks the owner.
 */
const NOUN_REPLY =
  /(?<!(?<![\p{L}\p{N}])(?:a|an|the|his|her|their|its|our|my|your|this|that|these|those|whose|some|each|no|any|every|one|\p{L}+['’]s)\p{White_Space}+)/u
    .source;

/**
 * Each phrase as a word-bounded, case-insensitive pattern, spaces matching any run of whitespace. A `reply …`
 * phrase does not match where `reply` is a noun, per {@link NOUN_REPLY}.
 */
const ASK_PATTERNS: readonly RegExp[] = [
  ...ASK_PHRASES.map((phrase) => {
    const noun = phrase.startsWith("reply ") ? NOUN_REPLY : "";
    const words = phrase.replaceAll(" ", "\\p{White_Space}+");
    return new RegExp(`${noun}(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, "iu");
  }),
  ...PRONOUN_ASKS,
];

/** Where one cell asks the owner something, and the words that did it. */
export interface OwnerDmAsk {
  /** The form field a sender goes and fixes, as the voice rules name it — `lead`, `trailing[0]`, `tldr`. */
  readonly path: string;
  /** The words that asked: the question's closing word and mark, or the phrase as written. */
  readonly matched: string;
}

/**
 * The first place in one cell's text that asks the owner something, or `undefined` when it asks nothing.
 *
 * @param text one cell of authored prose
 * @returns the words that asked, as written once NFC-normalised, or `undefined`
 */
function askIn({ text }: { text: string }): string | undefined {
  // NFC first: a decomposed "cafe\u0301?" and a composed "café?" are one word to a reader.
  const prose = text.normalize("NFC");
  for (const pattern of ASK_PATTERNS) {
    const found = pattern.exec(prose);
    if (found !== null) {
      return found[0];
    }
  }
  for (const pattern of PERSON_WAITS) {
    const found = pattern.exec(prose);
    if (found !== null) {
      return found[0];
    }
  }
  return questionWord({ prose });
}

/**
 * The first place in a text that asks its reader something — an ask phrase or a closing question mark — or
 * `undefined` when it asks nothing. This is the module's tell WITHOUT {@link PERSON_WAITS}: a wait on a person's
 * act describes something held in the owner's DM, while this half is what any message asking a question carries, so
 * `./priorAsk.ts` reads a draft with it.
 *
 * @param text authored prose, never a link label, code or a quote
 * @returns the words that asked, as written once NFC-normalised, or `undefined`
 */
export function askedWords({ text }: { text: string }): string | undefined {
  const prose = text.normalize("NFC");
  for (const pattern of ASK_PATTERNS) {
    const found = pattern.exec(prose);
    if (found !== null) {
      return found[0];
    }
  }
  return questionWord({ prose });
}

/**
 * The word a question mark closes, with its mark, or `undefined` when no mark closes one.
 *
 * @param prose NFC-normalised authored prose
 * @returns the closing word and mark, `?` alone when nothing precedes it
 */
function questionWord({ prose }: { prose: string }): string | undefined {
  const question = QUESTION.exec(prose);
  if (question === null) {
    return undefined;
  }
  const word = prose
    .slice(0, question.index + 1)
    .split(/\p{White_Space}+/u)
    .findLast((part) => part.length > 0);
  if (word === undefined) {
    return "?";
  }
  if (/\p{White_Space}/u.test(question[0].charAt(0))) {
    return `${word} ?`;
  }
  return `${word}?`;
}

/**
 * Every cell of authored prose that asks the owner something, in the order a reader meets them.
 *
 * @param cells the post's authored prose, one cell per addressable field
 * @returns one entry per asking cell, empty when none asks
 */
export function ownerDmAsks({ cells }: { cells: readonly AboveFoldCell[] }): readonly OwnerDmAsk[] {
  return cells.flatMap((cell) => {
    const matched = askIn({ text: cell.text });
    return matched === undefined ? [] : [{ matched, path: cell.path }];
  });
}

/**
 * Refuse a bot post to the owner's DM whose own words ask the owner something or name something waiting on them.
 *
 * Returns an EMPTY list for every send that may proceed — any destination that is not the owner's DM, an automation
 * prompt, and a post there that asks nothing — so a caller asks unconditionally.
 *
 * @param cells the post's authored prose, one cell per addressable field
 * @param channel where the send is aimed
 * @param formKind the `BOT_FORM_KINDS` entry that parsed the payload
 * @param ownerUserId `slackBot.ownerUserId`, absent when unset
 * @param promptChannel `slackBot.promptChannel`, absent when unset
 * @returns the hold's lines, or nothing when the send may proceed
 */
export function ownerDmAskRefusal({
  cells,
  channel,
  formKind,
  ownerUserId,
  promptChannel,
}: {
  cells: readonly AboveFoldCell[];
  channel: string;
  formKind: string;
  ownerUserId: string | null | undefined;
  promptChannel: string | undefined;
}): readonly string[] {
  if (isAutomationPrompt({ formKind }) || !isOwnerDm({ channel, ownerUserId, promptChannel })) {
    return [];
  }
  const asks = ownerDmAsks({ cells });
  if (asks.length === 0) {
    return [];
  }
  const where = asks.map((ask) => `${ask.path} ("${ask.matched}")`).join(", ");
  return [
    `this post is aimed at ${channel}, the owner's own bot DM, and it asks the owner something: ${where}. A ` +
      "question to the owner, or anything waiting on them, never goes in that DM: they do not " +
      "check it, so an ask there gets missed.",
    "Put the question on the owner's Queue page instead — `slopweaver handover ask <slug>` on a run of yours, or " +
      "`slopweaver handover register --ask …` for a new row — and send this post without the ask, or not at all.",
    "There is deliberately NO escape hatch here, and that is not an omission: an override would be a " +
      "documented way to ask the owner in the DM, which is the thing this hold exists to prevent.",
  ];
}
