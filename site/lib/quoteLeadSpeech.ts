/**
 * Speech cleaning and the cutting of the owner's turn into sentences of clauses, for `./quoteLead.ts`, whose header holds the
 * governing behaviour and why. Pure: strings in, values out.
 */
import type { HisWordsWhere } from "../components/live/readHisWords";

/** The records that are speech, whose transcript carries fillers and pauses; the others are typed. */
export const SPOKEN: ReadonlySet<HisWordsWhere> = new Set<HisWordsWhere>(["call", "call-landing", "console-voice"]);

/** A transcript's own annotation — `[breath]`, `[tongue click]`, `[Image #N]` — or a paste marker's tag. */
const ANNOTATION = /\[[^\]]{0,60}\]?|<\/?pasted_content[^>]*>/giu;

/** A number said aloud, which an `oh` beside is a zero ("four oh four", "two point oh"). */
const SPOKEN_NUMBER =
  "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\p{L}+teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|point|version)";

/**
 * Sounds a transcript writes that carry no word — dropped wherever they stand. Written in lower or sentence case
 * only, so an acronym (`ER`, `AH`) is never one; a hum (`mm`) only where a pause or a stop follows it, so a unit
 * (`the mm wave`) is not; an `oh` never beside a spoken number, where it is a zero; and never half of `uh-oh` or
 * `uh-huh`, which are words.
 */
const FILLER = new RegExp(
  "(?<![\\p{L}\\p{N}'-])(?:[Uu]h+|[Uu]m+|[Uu]hm|[Ee]rm+|[Ee]r+|[Ee]h+|[Hh]m+|[Mm]h*m+(?=\\s*(?:[,.!?]|$))|[Aa]h+|" +
    `(?<!\\b${SPOKEN_NUMBER}[\\s,-]+)[Oo]h+(?![\\s,-]+${SPOKEN_NUMBER}\\b))` +
    "(?![\\p{L}\\p{N}'])(?!-(?:[Oo]h|[Hh]uh|[Uu]h)\\b)-?[,.!?]*",
  "gu",
);

/**
 * A stutter on a word's opening — `o-our`, `a-a-alongside`. Never a prefix a hyphen really joins (`re-record`,
 * `co-owner`, `pre-prepared`), nor a word said whole twice (`no-no`, `so-so`).
 */
const STUTTER =
  /(?<![\p{L}\p{N}'])(?!(?:re|pre|co|de|in|un|non|sub|anti|post|semi|self|ex|mid|multi|over|under|out)-)(\p{L}{1,4})-(?=\1)(?!\1(?![\p{L}\p{N}']))/giu;

/**
 * A false start: a word broken off with a dash before the next word — `dependen- if`, `doin-`. Never a negation or
 * a time word broken off mid-thought (`didn't-`, `not-`, `now-`), which carries the meaning of what follows, nor a
 * whole short word a dash only paused after (`it-`) unless the owner says it again straight after (`if- if`).
 */
const FALSE_START =
  /(?<![\p{L}\p{N}'])(?!(?:[\p{L}]*n't|not|no|never|now|nor)-)(?:[\p{L}']{3,}|([\p{L}']{1,2})(?=-\s+\1(?![\p{L}\p{N}'])))-(?=\s|$)(?!\s+(?:and|or|to)\s+[\p{L}']+-\p{L})/giu;

/**
 * "you know" as a filler — kept when it opens a clause of its own ("you know how …", "you know what") or is the verb
 * of a question or an aside ("do you know", "as you know").
 */
const YOU_KNOW =
  /(?<!\b(?:do|did|does|don't|didn't|as|if|would|wouldn't|could|might|will|won't|so)\s+)\byou know\b(?!\s+(?:what|how|why|when|where|who|whether|if|that|the)\b),?/giu;

/** "like" standing alone between pauses or commas, a filler rather than a verb or a comparison. */
const LONE_LIKE = /(^|,)\s*like\s*(?=,|$)/giu;

/**
 * A word said twice or more in a row — `it's, it's, it's` — kept once. The repeat must be the whole word in the same
 * case, so `it, it's` and `Will will` are two different words — and never `had had`, `done done`, `is is`,
 * `in, in` or `win win`, which mean something, nor a number word or its `oh`, since "one three eight eight" is PR
 * 1388 and "seventeen oh oh nine" is 17009, nor a pair a noun is made of (`a no no`, `the so so one`).
 */
const DOUBLED = new RegExp(
  `(?<![\\p{L}\\p{N}'])(?!(?:had|done|is|in|win|oh|${SPOKEN_NUMBER})\\b)(?!(?<=\\b(?:a|an|the)\\s+)(?:no|so)\\b)([\\p{L}'][\\p{L}\\p{N}']*)(?:[\\s,]+\\1(?![\\p{L}\\p{N}']))+`,
  "gu",
);

/**
 * The discourse openers a lead never starts on. "I guess" and "but" stay: they carry the owner's hedge and turn. Never
 * the first half of a hyphenated word (`So-called`, `Right-click`, `Well-tested`).
 */
export const OPENER =
  /^(?:(?:and|so|then|yeah|yes|yep|okay|ok|right|well|anyway|alright|cool|sorry|basically|i mean)\b(?!-\p{L})[\s,.!?-]*)+/iu;

/** The words a lead never ends on — a conjunction left hanging, a filler "like". */
export const DANGLING =
  /(?:[\s,]+(?:and|so|but|or|cause|'cause|because|like|then|that|where|which|who|with|to|the|a|an|of|if|when|by|for|from|basically))+[\s,.]*$/iu;

/** Phrasing that states what the owner wants or decided, as opposed to what they are musing over. */
export const DECISION =
  /\b(?:i want|i'd like|i would like|i'd love|i'm keen|i am keen|keen to|let's|we should|you should|we need|i need|i'm declaring|i am declaring|i'd rather|i would rather|my (?:call|pick|vote)|go ahead|please)\b/iu;

/** A clause that turns the one before it. */
export const TURN =
  /^(?:but|though|although|however|unless|except|not|no|never|wouldn't|won't|don't|doesn't|isn't|can't|rather|instead|actually|that's)\b/iu;

/**
 * A clause opening a condition — everything it governs is not stated as fact, so no stretch leaves it behind, before
 * or after ("If the auditor signs off. Merge it tonight.", "Merge it tonight... once CI is green").
 */
export const ANTECEDENT =
  /^(?:if|when|whenever|once|assuming|should|depending on|in case|given that|unless|until|provided|as long as|so long as|as soon as|only if|only after|only once|only when|only until|not until|not unless)\b/iu;

/**
 * A clause or sentence opening on a condition or a turn — what comes before it is not the whole thought, so no stretch
 * before it in the same sentence, nor in the sentence before, is ever a lead ("… once CI is green", "Merge it
 * tonight. Unless the auditor objects.", "… That's pretty dumb though.", "Not tonight though.").
 */
export const CONDITION =
  /^(?:but|though|although|however|unless|except|if|when|once|assuming|until|only if|only after|only once|only when|only until|not until|not unless|not yet|not tonight|not today|not now|as long as|so long as|as soon as|provided|otherwise|that's (?:pretty |really |a bit |kind of |sort of )?(?:dumb|stupid|silly|wrong|bad|a bad idea))\b/iu;

/**
 * A clause where the owner starts reading or quoting someone else's words — it, and everything after it until the
 * owner speaks as themselves again, is not the owner's.
 */
const READING =
  /\b(?:(?:it|that|this|which|card|page|draft|ticket|issue|message|summary|bot|agent|queue|supervisor|doc|email|note|comment|thread|pr) (?:says|said|reads|asks|asked)|(?:it's|it is|they're|he's|she's|bot's) asking|(?:he|she|they) says|(?:someone|somebody) (?:says|said))\b|["“”]/iu;

/**
 * A turn in which the owner reads something aloud, anywhere: "let me have a look at another one", "continuing reading", "then
 * it says", "you say", a bare "says,", quote marks, a typed `>` quote line. Read-back and the owner's reactions then
 * interleave with no cue between them, so in such a turn only a stretch opening on the owner's own stance may lead.
 */
export const READING_TURN =
  /\b(?:reading|read through|let me see|let me (?:have a )?look at|having a look at|(?:it|then it|and it|this|that|card|which|draft) (?:says|asks|goes)|says,|you say|you said|(?:you're|you are|they're|he's|she's|it's|it is|is it) saying|it's asking)\b|["“”]|^\s*>/imu;

/** Someone named as the speaker of what follows — `Auditco said`. Case-sensitive, so it is a name, never "I said". */
const NAMED_SPEAKER = /(?<![\p{L}'])(?!I\b)\p{Lu}\p{Ll}+ (?:said|says)\b/u;

/**
 * A sentence opening on the owner's own stance, which ends a read-back. Only a stance — "I think", "I want", "I'm not sure" —
 * and never a bare "I'll", "I'd" or "we should", which a card's own text says just as often.
 */
export const OWN_STANCE =
  /^(?:i think|i want|i'd (?:like|rather|love|prefer|say)|i don't|i do not|(?:i'm|i am) (?:not|keen|happy|worried|thinking|unsure|fine|okay|wondering|curious|torn|leaning|glad|sure)|i reckon|i guess|i feel|i mean|i wonder|i like|i hate|i love|my|let's|honestly|personally)\b/iu;

/** A later sentence taking an earlier one back — "nah" the commonest, "wait, hang on" or "I haven't looked" mid-call. */
export const REVERSAL =
  /\b(?:nah|nope|wait,? (?:hang on|hold on|actually)|actually,? sorry|no,? sorry|i haven't (?:looked|read|checked|seen)|let's leave it|leave it for now|(?:i've |i )?changed my mind|on reflection|actually,? no|actually,? let's not|actually,? don't|let's not|no,? wait|wait,? no|or wait|or not|wait,? keep|keep it|hold off|maybe not|probably not|not yet|don't do (?:that|it|this)|hmm,? no|scratch that|scrap that|ignore that|never ?mind|on second thought|forget that|i take that back)\b/iu;

/**
 * A later sentence correcting an earlier one — opening on "sorry" behind only filler ("Uh, sorry, I'm more talking
 * about policies"), never an apology "sorry about", or carrying "sorry, not" anywhere ("Sorry, not bothered about
 * clerk, they're bothered that …").
 */
export const CORRECTION =
  /^[^\p{L}]*(?:(?:uh|um|oh|well|yeah|okay|so|and|right)[^\p{L}]+)*sorry\b(?!\s+about)|\bsorry,? (?:not|no)\b/iu;

/**
 * A sentence after the stretch's that narrows or conditions it without opening on a full condition — "After the
 * auditor signs off though.", "Only the nightly one.", "Before we merge the docs."
 */
export const NARROWING = /^(?:after|before|only)\b/iu;

/** A condition answered in place — `If so...`, `If not` — which governs what follows rather than being a restart. */
export const ANSWERED_CONDITION = /^(?:if|unless) (?:so|not|yes|no)$/iu;

/** The leading conjunction a condition may open behind — "But if the auditor signs off." */
export const LEADING_CONJUNCTION = /^(?:but|and|or)\s+/iu;

/** The words a clause the owner broke off ends on — a conjunction, a preposition or a bare pronoun. */
export const HANGING =
  /(?:^|\s)(?:and|so|but|or|because|cause|like|then|that|where|which|who|with|to|the|a|an|of|if|when|by|for|from|we|i|you|they|it)$/iu;

/**
 * Words too common to say what a card is about, whole. Content words are what is left. A pattern rather than a word
 * set, because it names words anyone says — every pronoun among them — and never the owner.
 */
const STOPWORD = new RegExp(
  `^(?:${(
    "about after again all also and any are around back basically be because been before being both but by can " +
    "cause could did does doing done don't each even every for from get gets getting go goes going gonna got guess " +
    "had has have having here hers him his how i'd i'll i'm i've if into is isn't it it's its just kind know let let's " +
    "like look lot made make many may maybe me mean might more most much must my need new not now off okay one only " +
    "onto other our out over pretty probably put quite rather really right said same say says see seems should since " +
    "so some something sort still stuff such sure take than that that's the their them then there there's these they " +
    "thing things think this those though thought through too try two under until upon very want wanna was way we " +
    "we'd we'll we're well were what what's when where whether which while who why will with would yeah yes yet you " +
    "you'd you'll you're your actually anyway alright cool hang wait"
  )
    .split(" ")
    .join("|")})$`,
  "u",
);

/** One clause of a sentence: its cleaned text, its word count, and whether it may stand in a lead. */
export interface Clause {
  readonly text: string;
  readonly words: number;
  /** `false` for a clause the owner is reading aloud or quoting, and everything after it until they speak as themselves again. */
  readonly ownVoice: boolean;
}

/**
 * A clause with its annotations dropped and, when it was spoken, every filler, stutter, false start and doubled word
 * too — spacing and stray punctuation tidied. What is left is the owner's words, in their order, letters untouched.
 *
 * @param text one clause of the owner's turn, between two pauses
 * @param spoken whether the record is speech, whose disfluencies are noise rather than the owner's writing
 * @returns the cleaned clause, possibly empty
 */
export function withoutDisfluencies({ text, spoken }: { text: string; spoken: boolean }): string {
  let out = text.replace(ANNOTATION, " ");
  if (spoken) {
    out = out.replace(FILLER, " ");
    // Repeated, so `a-a-alongside` loses both stutters rather than one.
    for (let pass = 0; pass < 3; pass += 1) {
      out = out.replace(STUTTER, "");
    }
    out = out.replace(FALSE_START, " ").replace(YOU_KNOW, " ").replace(DOUBLED, "$1");
  }
  out = out
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.!?;:])/gu, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/gu, "$1");
  if (spoken) {
    out = out.replace(LONE_LIKE, "$1");
  }
  return out
    .replace(/^[\s,.;:!?-]+/u, "")
    .replace(/[\s,;:-]+$/u, "")
    .trim();
}

/**
 * The words of a text, lower-cased, as the scorer counts them.
 *
 * @returns the words, lower-cased, in source order
 */
export function tokens({ text }: { text: string }): readonly string[] {
  const found = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu);
  if (found === null) {
    return [];
  }
  return found;
}

/**
 * A word's stem as overlap compares it: a plural or possessive dropped, then its first five letters, so
 * "dependencies" meets "dependency" and "removed" meets "remove".
 */
function stemOf({ word }: { word: string }): string {
  return word
    .replace(/'s$/u, "")
    .replace(/(?<=\p{L}{3})s$/u, "")
    .slice(0, 5);
}

/**
 * The distinct content stems of a text — every word of three letters or more that is not a stopword.
 *
 * @returns the stems
 */
export function contentStems({ text }: { text: string }): ReadonlySet<string> {
  const stems = new Set<string>();
  for (const word of tokens({ text })) {
    if (word.length >= 3 && !STOPWORD.test(word)) {
      stems.add(stemOf({ word }));
    }
  }
  return stems;
}

/**
 * The owner's turn as sentences of clauses: a sentence ends only at a single `.`, `?` or `!` followed by a space, and a
 * clause at every pause (`...`, `…`) inside one.
 *
 * @param text the owner's words, verbatim
 * @param spoken whether the record is speech
 * @returns each sentence's cleaned, non-empty clauses
 */
export function speechSentences({ text, spoken }: { text: string; spoken: boolean }): readonly (readonly Clause[])[] {
  const paused = text.replace(/\s*(?:\.{2,}|…)\s*/gu, " \u0000 ");
  const out: Clause[][] = [];
  // A read-back runs on across sentences — a card's text is several — until a sentence opens on the owner's own stance.
  let reading = false;
  for (const sentence of paused.split(/(?<=[^.\s][.!?])\s+/u)) {
    const clauses: Clause[] = [];
    for (const piece of sentence.split("\u0000")) {
      const cleaned = withoutDisfluencies({ spoken, text: piece });
      if (cleaned.length === 0) {
        continue;
      }
      const quoting = READING.test(cleaned) || NAMED_SPEAKER.test(cleaned);
      if (clauses.length === 0 && OWN_STANCE.test(cleaned.replace(OPENER, "")) && !quoting) {
        reading = false;
      }
      reading = reading || quoting;
      clauses.push({ ownVoice: !reading, text: cleaned, words: tokens({ text: cleaned }).length });
    }
    if (clauses.length > 0) {
      out.push(clauses);
    }
  }
  return out;
}
