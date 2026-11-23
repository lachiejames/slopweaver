/**
 * The voice saying it put a draft on the owner's running list: "I've put a revision on your running list". The page feeds every
 * FINAL voice sentence through {@link runningListClaimsOf} by way of the spoken-claims fold (`./talkSpokenClaims.ts`).
 * Only an offer that landed and that the owner has not moved on from grounds one; nothing grounding it, the call says one fixed
 * correction aloud (`./talkPlanCompletionCorrection.ts`).
 *
 * The failure: offers land, the owner begins sentences, and the voice then begins "I've put a revision on your running
 * list that quotes lines and responds to them one at a time." with no offer run, so the owner has to say nothing of
 * the kind is on their running list. The prompt already tells the voice never to claim the list on its own
 * (`src/talk/copyToolSchemas.ts`); audio and transcript stream together, so a correction is the soonest the call can
 * act.
 *
 * The same words are usually TRUE: the voice paraphrases the console's own line after a real landing, so its "I've put a
 * draft on your running list" and "I've put a new draft on your running list" begun after landings are right.
 * Measured over every call file on disk: three first-person claims, two true and one false. So
 * a claim is read only with its landing beside it (`groundedAt`, `./talkSpokenClaimsFold.ts`), and the three replay in
 * `site/__tests__/unit/talkSpokenClaimsRunningList.test.ts`. Repro:
 *   grep -h '"final":true.*"who":"voice"' ~/.slopweaver/talk/calls/*.jsonl | grep -ioE "[^.?!\"]{0,50}running list"
 *
 * Narrow on purpose, because a wrong correction is a line the owner did not ask for. A
 * sentence counts only when it OPENS on the first person, past or perfect, so "When I put…", "You said I put…" and "Did
 * I put…" are never read; its verb is one of a few that place a thing; what it places is a short noun phrase out of a
 * closed vocabulary; "your running list" follows straight after; and the sentence runs on
 * from there unbroken. Never a question, a negation, an afterthought, a future or a quotation. The console's "It's on your running list" is impersonal and never
 * read, which also leaves the voice saying exactly that with no offer unread: the stated residue, with a placing verb
 * nobody listed.
 */
import { sentencesOf, type Token } from "./talkSpokenClaimsWords";

/** One sentence of the voice's saying it put a draft on the owner's running list. `start` is where its first person opens. */
export interface RunningListClaim {
  readonly kind: "running-list";
  readonly words: string;
  readonly start: number;
}

/** What may stand before the first person with the sentence still opening on it: "Okay, I've put…". */
const OPENERS = new Set(["okay", "ok", "right", "sure", "yes", "yeah", "alright", "done", "so", "and", "now", "good"]);

/** Words between the first person and the verb that change nothing: "I've just put", "I've gone and put". */
const ADVERBS = new Set(["just", "also", "already", "now", "gone", "and"]);

/** The verbs that place a thing on a list. */
const PLACING_VERBS = new Set([
  "added",
  "appended",
  "dropped",
  "left",
  "parked",
  "pinned",
  "placed",
  "popped",
  "put",
  "queued",
  "saved",
  "stored",
  "stuck",
  "wrote",
  "written",
]);

/** The text between two sentences' tokens ends on something other than a sentence's end, so the next opens on that. */
const SOMETHING_BEFORE = /[^\s.!?;]\s*$/u;

/**
 * The only words the thing placed may be made of, so "on your running list" can only attach to the placing verb. A
 * word search found a new false reading every Codex pass: "nothing but", "put off adding that to", "wrote that you need
 * to add it to", "wrote a note about what's on". A closed noun phrase ends the class rather than the next instance;
 * a placing said of anything else is unread, the recall this module trades for never being wrong.
 */
const OBJECT_VOCABULARY = new Set([
  "a",
  "an",
  "another",
  "answer",
  "both",
  "copy",
  "corrected",
  "draft",
  "drafts",
  "fresh",
  "it",
  "line",
  "lines",
  "message",
  "messages",
  "new",
  "one",
  "reply",
  "replies",
  "response",
  "revised",
  "revision",
  "second",
  "short",
  "that",
  "the",
  "them",
  "these",
  "this",
  "those",
  "two",
  "updated",
  "version",
  "your",
]);

/** The most words the thing placed may run to: "a new corrected draft" is four. */
const OBJECT_WORDS = 5;

/**
 * Where the verb sits when the words open on the first person, past or perfect: "I put", "I've put", "I have put", "I
 * had put". Never "I'd put", which is as often "I would put", a future.
 *
 * @param words the sentence's words, openers skipped
 * @returns the verb's index, or -1 when it opens on anything else
 */
function placingVerbAt({ words }: { words: readonly string[] }): number {
  const first = words[0];
  let at: number;
  if (first === "i've") {
    at = 1;
  } else if (first === "i") {
    at = words[1] === "have" || words[1] === "had" ? 2 : 1;
  } else {
    return -1;
  }
  while (at < words.length && ADVERBS.has(words[at])) {
    at += 1;
  }
  return at < words.length && PLACING_VERBS.has(words[at]) ? at : -1;
}

/**
 * Whether the words after the verb are a thing placed and then "on", "onto" or "to your running list": a short noun
 * phrase out of {@link OBJECT_VOCABULARY}, and the list straight after it.
 *
 * @param after the words after the verb
 * @returns the index in `after` of "list" when they name the owner's running list as where the thing went, else -1
 */
function ownerListAt({ after }: { after: readonly string[] }): number {
  const place = after.findIndex((word) => !OBJECT_VOCABULARY.has(word));
  const preposition = after[place];
  const reaches =
    place >= 1 &&
    place <= OBJECT_WORDS &&
    (preposition === "on" || preposition === "onto" || preposition === "to") &&
    after[place + 1] === "your" &&
    after[place + 2] === "running" &&
    after[place + 3] === "list";
  return reaches ? place + 3 : -1;
}

/** The only gap a claim's tail may hold between two of its tokens: spaces. */
const UNBROKEN_GAP = /^\s*$/u;

/**
 * Whether the sentence runs on from "list" to its end with no clause break: no comma, dash or bracket. The voice
 * takes a placing back as an afterthought ("…on your running list, actually, scratch that"), an open class of words,
 * so the break is what is read. And what follows must describe the thing placed, opening on "that" or
 * "with" as all the real claims do ("…on your running list that quotes lines and responds to them one at a time"), so
 * a habit ("…on your running list every time you ask") is unread too.
 *
 * @param list the token "list" is
 * @param tokens the whole sentence's tokens, which hold it
 * @param text the segment both index into
 * @returns true when nothing but spaces and words follows it
 */
function runsOnUnbroken({ list, tokens, text }: { list: Token; tokens: readonly Token[]; text: string }): boolean {
  const tail = tokens.slice(tokens.indexOf(list));
  const next = tail.at(1);
  if (next !== undefined && next.lower !== "that" && next.lower !== "with") {
    return false;
  }
  return tail.every(
    (token, index) =>
      token.kind !== "stop" && (index === 0 || UNBROKEN_GAP.test(text.slice(tail[index - 1].end, token.start))),
  );
}

/**
 * One sentence's word tokens from where its first person may open, the openers and their commas before it skipped. A
 * number there is the sentence opening on something else, so "123, I put…" opens on nothing.
 *
 * @param tokens the sentence's tokens
 * @returns the tokens from there on, words only, or none when a word does not open it
 */
function fromFirstPerson({ tokens }: { tokens: readonly Token[] }): readonly Token[] {
  const opensAt = tokens.findIndex((token) => token.kind !== "stop" && !OPENERS.has(token.lower));
  if (opensAt === -1 || tokens[opensAt].kind !== "word") {
    return [];
  }
  return tokens.slice(opensAt).filter((token) => token.kind === "word");
}

/** The negating words that are not a contraction. */
const NEGATING_WORDS = new Set(["no", "not", "never", "nothing", "none", "nobody", "neither", "nor", "cannot", "zero"]);

/** A count of nothing, which negates as "no" does: "I've put 0 drafts on your running list". */
const NOUGHT = /^0+$/u;

/**
 * A word that negates something anywhere in the sentence, so one the voice takes back in the same breath ("I put that
 * on your running list, actually, no, I didn't") is never read. A true claim with a "no" in it goes unread:
 * the recall this module trades.
 *
 * @param word one lowercased word
 * @returns true when it negates
 */
function negates({ word }: { word: string }): boolean {
  return NEGATING_WORDS.has(word) || word.endsWith("n't");
}

/** All that may follow a sentence's last token before the next sentence or the segment's end. */
const ONLY_A_SENTENCE_END = /^[\s.!?;]*$/u;

/** What may stand between an opener and the first person: "Okay, I've put…". */
const OPENER_GAP = /^[\s,]*$/u;

/**
 * Whether nothing the tokenizer skipped stands between the sentence's start and its first person, so `Okay, »I've
 * put…«` (the quotation order German and Danish use, which `./spokenQuotes.ts` leaves visible) opens on the
 * quotation mark rather than on the first person.
 *
 * @param opening the words from the first person on, or none
 * @param tokens the whole sentence's tokens, which hold the opening's
 * @param text the segment both index into
 * @returns true when the opening is non-empty and every gap before it is only spaces and commas
 */
function opensCleanly({
  opening,
  tokens,
  text,
}: {
  opening: readonly Token[];
  tokens: readonly Token[];
  text: string;
}): boolean {
  const first = opening.at(0);
  if (first === undefined) {
    return false;
  }
  const at = tokens.indexOf(first);
  return tokens.slice(1, at + 1).every((token, index) => OPENER_GAP.test(text.slice(tokens[index].end, token.start)));
}

/**
 * Every sentence of the voice's saying it put a draft on the owner's running list, one claim per sentence.
 *
 * @param text one of the voice's FINAL segments, as transcribed
 * @returns the claims, in the order said, each at its first person
 */
export function runningListClaimsOf({ text }: { text: string }): readonly RunningListClaim[] {
  const claims: RunningListClaim[] = [];
  const sentences = sentencesOf({ text });
  let lastEnd = 0;
  for (const [index, sentence] of sentences.entries()) {
    // What the tokenizer never saw, a quotation blanked or a bracket, opens the sentence when it stands right before its
    // first token: `"You said" I put…` opens on the quotation.
    const opensOnOther = SOMETHING_BEFORE.test(text.slice(lastEnd, sentence.tokens[0].start));
    lastEnd = sentence.tokens.at(-1)!.end;
    // And it ends on what it ends on: `…your running list — "actually, scratch that."` has a blanked retraction after its
    // last token, which no token shows.
    const next = sentences.at(index + 1);
    const nextStart = next === undefined ? text.length : next.tokens[0].start;
    const endsCleanly = ONLY_A_SENTENCE_END.test(text.slice(lastEnd, nextStart));
    const fromOpener = opensOnOther ? [] : fromFirstPerson({ tokens: sentence.tokens });
    const opening = opensCleanly({ opening: fromOpener, text, tokens: sentence.tokens }) ? fromOpener : [];
    const words = opening.map((token) => token.lower);
    const verbAt = placingVerbAt({ words });
    const negated = sentence.tokens.some(
      (token) =>
        (token.kind === "word" && negates({ word: token.lower })) ||
        (token.kind === "digits" && NOUGHT.test(token.lower)),
    );
    const listAt = verbAt === -1 ? -1 : ownerListAt({ after: words.slice(verbAt + 1) });
    const list = listAt === -1 ? undefined : opening[verbAt + 1 + listAt];
    const unbroken = list !== undefined && runsOnUnbroken({ list, text, tokens: sentence.tokens });
    if (!sentence.question && !negated && unbroken && endsCleanly) {
      claims.push({ kind: "running-list", start: opening[0].start, words: sentence.words });
    }
  }
  return claims;
}
