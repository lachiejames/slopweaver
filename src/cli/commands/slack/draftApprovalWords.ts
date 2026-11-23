/**
 * The two closed vocabularies a draft approval reads the owner's words against (`./draftApprovalGate.ts`): a take-back, which
 * may undo a yes, and a yes, which an unruled relay or a card landing must carry to bind at all. Both are whole-word
 * runs over one normalisation, so a phrase matches whatever the case and punctuation and never inside a longer word.
 * Pure, and literal on purpose: a refusal quoting either can still be checked by hand.
 */

/**
 * The words of a retraction or a negation, as whole-word runs: one in a relay that rules no card of its own is read as
 * possibly taking the yes back. Deliberately broad, and words rather than sentences — a list of whole sentences let "I
 * take it back" through. The trade is stated: a false refusal costs the owner one "which card?", a miss sends
 * words they took back. Closed and literal, so a refusal can still be checked by hand.
 */
const TAKE_BACK_PHRASES: readonly string[] = [
  "no",
  "nope",
  "nah",
  "not",
  "don't",
  "dont",
  "do not",
  "never",
  "cannot",
  "wont",
  "cant",
  "wait",
  "stop",
  "hold",
  "hang on",
  "cancel",
  "undo",
  "scratch",
  "scrap",
  "strike",
  "ignore",
  "disregard",
  "belay",
  "reconsider",
  "forget",
  "retract",
  "revoke",
  "rescind",
  "withdraw",
  "reverse",
  "unsend",
  "abort",
  "halt",
  "oops",
  "mistake",
  "wrong",
  "actually",
  "take back",
  "take it back",
  "take that back",
  "go back",
  "never mind",
  "nevermind",
  "second thought",
  "second thoughts",
  "changed my mind",
  "change my mind",
  "rather not",
  "flip that",
];

/**
 * The words of a yes, as whole-word runs: an unruled relay or a card landing binds only when the owner's words carry one. A
 * closed list, like {@link TAKE_BACK_PHRASES}, and deliberately PHRASES where a single word is common in a remark —
 * "good" is in "good question", "send" is in "who did we send the last one to" — and no bare filler: "okay, who's
 * Tobias?" and "sure, but who's Tobias?" are the defect again. A false refusal costs the owner one "is that a yes?",
 * while a miss sends a message on words that never agreed to it; a phrase joins this list once it is measured. No bare
 * "approved": "Tobias approved it" reports somebody else's act.
 *
 * THE RESIDUE, stated: this is a heuristic over a closed list, and it cannot read who a yes belongs to. Words that hold
 * a listed phrase while describing somebody else, with no reporting verb, condition or question — "Tobias's happy with
 * it", "Tobias will approve it", or a quoted statement attributed by a verb outside {@link REPORTING_PHRASES} (`"Send
 * it." she wrote`) — still bind on an unruled relay or a card landing. What closes that is a ruling the
 * voice stores at the turn (a `send-it` verdict), never a longer list; a session running `slack draft approve` still
 * reads the quoted words first.
 */
const AFFIRMATIVE_PHRASES: readonly string[] = [
  "yes",
  "yeah",
  "yep",
  "yup",
  "yea",
  "aye",
  "approve it",
  "approve that",
  "lgtm",
  "send it",
  "send that",
  "send this",
  "send them",
  "send it out",
  "ship it",
  "post it",
  "post that",
  "post this",
  "go ahead",
  "go for it",
  "do it",
  "looks good",
  "look good",
  "looks great",
  "looks fine",
  "sounds good",
  "sounds great",
  "good to go",
  "fire away",
  "fire it off",
  "happy with that",
  "happy with it",
  "works for me",
  "fine by me",
  "knock yourself out",
  "have at it",
  "go nuts",
  "green light",
  "greenlight",
  "greenlit",
];

/** Lower-cased words separated by single spaces, so a phrase matches whole words whatever the punctuation. */
function normalisedWords({ text }: { text: string }): string {
  return (
    text
      .toLowerCase()
      // A modifier letter (`ʼ`, U+02BC) is an apostrophe a transcriber may write, so it splits words too.
      .replace(/(?:[^\p{L}\p{N}]|\p{Lm})+/gu, " ")
      .trim()
  );
}

/** {@link TAKE_BACK_PHRASES}, normalised once. */
const TAKE_BACKS: readonly string[] = TAKE_BACK_PHRASES.map((phrase) => normalisedWords({ text: phrase }));

/** {@link AFFIRMATIVE_PHRASES}, normalised once. */
const AFFIRMATIVES: readonly string[] = AFFIRMATIVE_PHRASES.map((phrase) => normalisedWords({ text: phrase }));

/**
 * Any negative contraction once normalised — "won't", "can't", "isn't" all become `<word>n t` — so the class is the
 * criterion rather than a list a reviewer can always find one more of ("I won't send that").
 */
const NEGATIVE_CONTRACTION = /(?:^| )\p{L}+n t(?: |$)/u;

/**
 * Whether the owner's words carry a take-back — a retraction or negation from a closed list of whole-word runs ("wait", "not",
 * "scratch", "take it back", …) or any negative contraction, whatever the case and punctuation.
 *
 * @param text what the owner said on one relay
 * @returns whether a take-back is in it
 */
export function carriesTakeBack({ text }: { text: string }): boolean {
  const normalised = normalisedWords({ text });
  const words = ` ${normalised} `;
  return NEGATIVE_CONTRACTION.test(normalised) || TAKE_BACKS.some((phrase) => words.includes(` ${phrase} `));
}

/** The words that open a question: "who's Tobias", "should we send it to Tobias". */
const WH_OPENERS: ReadonlySet<string> = new Set(["who", "what", "why", "how", "when", "where", "which", "whose"]);

/** The auxiliaries that open a question when a subject follows: "can you", "should we", "did they". */
const AUX_OPENERS: ReadonlySet<string> = new Set([
  "am",
  "are",
  "is",
  "was",
  "were",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "shall",
  "will",
  "would",
  "have",
  "has",
  "may",
  "might",
  "must",
  "ought",
]);

/**
 * The opening word pairs that start with an auxiliary and still TELL rather than ask — "do it", "have at it" are a yes
 * — so only these are left out of the auxiliary reading. Every other auxiliary opener asks, whatever its subject: a
 * fixed subject list let "Should Tobias send it" through, and "is it good
 * to go" before it. A false reading costs them one "is that a yes?".
 */
const TELLING_OPENERS: ReadonlySet<string> = new Set(["do it", "do this", "do that", "have at", "will do", "can do"]);

/**
 * The filler a transcript opens a sentence with, skipped before the opener is read: "So, should we send it" asks.
 * The residue, stated: an unpunctuated question whose opener sits
 * after a clause rather than filler — "Tobias, should we send it" — still reads as telling, and binds. A question mark
 * the transcriber writes closes it; only reading the voice's own turn would close the rest.
 */
const FILLERS: ReadonlySet<string> = new Set([
  "so",
  "ok",
  "okay",
  "and",
  "but",
  "well",
  "oh",
  "hm",
  "hmm",
  "um",
  "uh",
  "er",
  "right",
  "anyway",
  "also",
  "then",
]);

/**
 * The owner's words as sentences, each keeping its own closing mark and any closing quote after it, so a question can
 * be told from a statement: `"Send it?" she wondered.` is a quoted question, then an attribution.
 * A question mark ends its sentence whatever follows it, so `"Send it?"—she wondered.` splits too.
 */
function sentencesOf({ text }: { text: string }): readonly string[] {
  return text
    .split(/(?<=[.!?？…]["'”’)\]]*)\s+|(?<=[?？]["'”’)\]]*)(?![?？"'”’)\]\s])|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

/** Whether one sentence asks rather than says: it ends in a question mark, or opens as a question does. */
function isQuestion({ sentence }: { sentence: string }): boolean {
  if (/[?？]["'”’)\]]*$/u.test(sentence)) {
    return true;
  }
  const words = normalisedWords({ text: sentence }).split(" ");
  const start = words.findIndex((word) => !FILLERS.has(word));
  const [first, second] = start === -1 ? [] : words.slice(start);
  if (first === undefined) {
    return false;
  }
  if (WH_OPENERS.has(first)) {
    return true;
  }
  if (second === undefined || !AUX_OPENERS.has(first)) {
    return false;
  }
  return !TELLING_OPENERS.has(`${first} ${second}`);
}

/** Whether these words hold a phrase from {@link AFFIRMATIVE_PHRASES} anywhere, question or not. */
function holdsAffirmativePhrase({ text }: { text: string }): boolean {
  const words = ` ${normalisedWords({ text })} `;
  return AFFIRMATIVES.some((phrase) => words.includes(` ${phrase} `));
}

/**
 * The words that make a yes conditional, as whole-word runs: "If Tobias approves, send it" agrees to nothing yet.
 * Broad on purpose, like {@link TAKE_BACK_PHRASES}: "send it when Tobias's back" is refused
 * too, since an approval cannot carry the condition, and a false refusal costs the owner one "is that a yes now?".
 */
const CONDITION_PHRASES: readonly string[] = [
  "if",
  "unless",
  "once",
  "when",
  "whenever",
  "after",
  "before",
  "until",
  "till",
  "provided",
  "providing",
  "assuming",
  "depending",
  "as long as",
  "so long as",
  "otherwise",
];

/**
 * The words that make a yes somebody else's, as whole-word runs: "Tobias said yes" reports an answer and is no act of the owner's.
 * Broad on purpose, so "I said yes earlier" is refused too — a yes the owner gave before is
 * bound at its own anchor, never at the one that recounts it.
 */
const REPORTING_PHRASES: readonly string[] = [
  "said",
  "says",
  "saying",
  "told",
  "tells",
  "asked",
  "asks",
  "reckons",
  "reckoned",
  "according to",
  "apparently",
];

/** {@link CONDITION_PHRASES}, normalised once. */
const CONDITIONS: readonly string[] = CONDITION_PHRASES.map((phrase) => normalisedWords({ text: phrase }));

/** {@link REPORTING_PHRASES}, normalised once. */
const REPORTINGS: readonly string[] = REPORTING_PHRASES.map((phrase) => normalisedWords({ text: phrase }));

/** Whether one sentence holds a whole-word run from a normalised list. */
function holdsAny({ phrases, sentence }: { phrases: readonly string[]; sentence: string }): boolean {
  const words = ` ${normalisedWords({ text: sentence })} `;
  return phrases.some((phrase) => words.includes(` ${phrase} `));
}

/**
 * What makes a sentence that holds a yes phrase something other than the owner's yes, each with the reason a refusal
 * names, read in this order. A closed set: a pass that finds one more is a row here, never a second classifier.
 */
const HEDGES: readonly { readonly why: string; readonly hedges: (sentence: string) => boolean }[] = [
  { hedges: (sentence) => isQuestion({ sentence }), why: "the words carry a yes only inside a question" },
  {
    hedges: (sentence) => holdsAny({ phrases: CONDITIONS, sentence }),
    why: "the words carry a yes only under a condition",
  },
  {
    hedges: (sentence) => holdsAny({ phrases: REPORTINGS, sentence }),
    why: "the words carry a yes only as words reported, not said",
  },
];

/** The reason one sentence that holds a yes phrase is not the owner's yes, or `undefined` when it is one. */
function hedgeOf({ sentence }: { sentence: string }): string | undefined {
  return HEDGES.find(({ hedges }) => hedges(sentence))?.why;
}

/** The sentences of the owner's words that hold a yes phrase. */
function yesSentences({ text }: { text: string }): readonly string[] {
  return sentencesOf({ text }).filter((sentence) => holdsAffirmativePhrase({ text: sentence }));
}

/**
 * Whether the owner's words carry a yes — a whole-word run from a closed list ("yes", "send it", "looks good", …), whatever the
 * case and punctuation, in a sentence no hedge touches: "Should we send it to Tobias?", "If Tobias approves, send it" and
 * "Tobias said yes" each hold one and carry no yes. Carrying one is not yet an affirmative act:
 * {@link affirmativeActWhy} also refuses a take-back.
 *
 * @param text what the owner said at the anchor
 * @returns whether a yes is in it
 */
export function carriesAffirmative({ text }: { text: string }): boolean {
  return yesSentences({ text }).some((sentence) => hedgeOf({ sentence }) === undefined);
}

/**
 * Why the owner's words at an anchor are not an affirmative act, or `undefined` when they are one: a yes from the closed list,
 * said rather than asked, reported or put under a condition, and no take-back beside it.
 *
 * @param text what they said at the anchor
 * @returns the reason, or `undefined`
 */
export function affirmativeActWhy({ text }: { text: string }): string | undefined {
  if (!carriesAffirmative({ text })) {
    const [first] = yesSentences({ text });
    if (first === undefined) {
      return "the words carry no yes";
    }
    return hedgeOf({ sentence: first });
  }
  if (carriesTakeBack({ text })) {
    return "the words carry a yes beside a take-back";
  }
  return undefined;
}
