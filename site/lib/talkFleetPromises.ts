/**
 * The voice promising fleet work as its own: "I'll get you that briefing", when a seat writes the briefing and the voice
 * only helps the owner work through it. The page feeds every FINAL voice sentence through {@link fleetPromiseClaimsOf} by way
 * of the spoken-claims fold (`./talkSpokenClaims.ts`); one it finds is kept as a closed `fleet-promise` shape and the
 * call says one fixed reattribution aloud (`./talkPlanCompletionCorrection.ts`).
 *
 * The failure: the thinking model writes "The fleet will produce that separate briefing: what the rules enforce, how
 * exceptions get through, and what you authorised", and the voice — which says every handed answer in its own words —
 * says "I'll get you that briefing on what the rules actually enforce, how exceptions get through, and who approved
 * them." The voice is not the fleet: the fleet produces briefings, the voice does not. The prompt half is `src/talk/fleetAuthorshipLines.ts`; audio and transcript stream
 * together, so a sentence the realtime model composes is heard before anything can check it, and this is the soonest
 * the call can act.
 *
 * Narrow on purpose, because a wrong correction is a line the owner did not ask for. A
 * sentence counts only when, outside quotation marks and not as a question, a first-person future ("I'll", "I will",
 * "I'm going to", "I'm gonna") opens a clause whose verb, or a verb an "and" or "then" joins to it, is one that makes
 * or carries something — never a read, so "I'll check the briefing" is a look the call takes now, while "I'll check
 * the config and come back with a briefing" promises one — and that either names a fleet deliverable or says "take it
 * from there" / "come back with". The same words are sometimes both: "I'll pull that together." can promise a map
 * and can be the ack before a reflect-back the owner asked for, so a sentence naming no deliverable is never read,
 * and "I'll fold that in", "I'll work that in" and "I'll get that sorted" are missed on purpose — the prompt carries
 * those. Measured over 425 distinct FINAL voice segments `slopweaver talk calls` printed over two days: eleven
 * sentences found, every one a fleet promise. Re-measured with the joined verbs over 396 distinct
 * FINAL voice segments in later call files, a real-app call included: twelve, those eleven
 * and its "I'll check the repo config and come back with a tight two-sentence briefing"; the replay is
 * `site/__tests__/unit/talkFleetPromises.test.ts`.
 */
import { maskQuotes } from "./spokenQuotes";

/** One sentence of the voice's that promised fleet work as its own. `start` is where its first-person future opens. */
export interface FleetPromiseClaim {
  readonly kind: "fleet-promise";
  readonly words: string;
  readonly start: number;
}

/** A first-person future, as speech-to-text writes it, either apostrophe. */
const FIRST_PERSON_FUTURE = /\bI(?:['’]ll| will| am going to|['’]m going to|['’]m gonna)\b/gu;

/**
 * The things a fleet seat produces or carries, as the voice names them: "that briefing", "the briefing request", "a firm
 * requirement", "a rule for all future changes" (each said as the voice's own).
 */
const DELIVERABLES = new Set([
  "briefing",
  "briefings",
  "report",
  "reports",
  "proposal",
  "proposals",
  "write-up",
  "writeup",
  "map",
  "revision",
  "requirement",
  "requirements",
  "rule",
  "rules",
  "pr",
  "prs",
  "investigation",
  "sweep",
]);

/** Fleet idioms with no deliverable word: "I'll take it from there", "I'll come back with…", "the next cut". */
const FLEET_IDIOMS: readonly RegExp[] = [/\btake it from there\b/u, /\bcome back with\b/u, /\bnext cut\b/u];

/** Words between the future and its verb that change nothing: "I'll just check", "I'll go and read". */
const FILLERS = new Set(["just", "also", "quickly", "now", "then", "go", "and", "first", "still"]);

/**
 * The verbs that make or carry fleet work, each said as the voice's own: "I'll get you that briefing",
 * "I'll bring that briefing back", "I'll come back with a clear briefing", "I'll fold that into the briefing request",
 * "I'll make sure that goes in as a firm requirement", "I'll treat that as a rule", "I'll ask for that to be enforced",
 * "I'll write that … into the revised briefing", "I'll include that in … the general proposal", "I'll carry that into
 * the briefing", "I'll take it from there". An ALLOWLIST, not a list of reads to exclude: a read the list did not name
 * ("I'll inspect the report") would be a correction out of nowhere, and a verb this does not know is silence.
 */
const PRODUCING_VERBS = new Set([
  "get",
  "bring",
  "come",
  "fold",
  "make",
  "treat",
  "ask",
  "write",
  "include",
  "carry",
  "take",
  "produce",
  "prepare",
  "draft",
  "put",
  "add",
  "raise",
  "file",
  "deliver",
  "send",
  "build",
  "compile",
  "work",
  "feed",
]);

/**
 * A look said with a producing verb, which is still the call's own read: "take a look", "get a look", and putting a
 * thing on screen, "bring up the report", "put that report up" or "put the report on screen". Tested
 * against the clause from the verb on.
 */
const READ_PHRASES: readonly RegExp[] = [
  // "take a look", "take a closer look", "get another quick look": up to three words before the look, so a later
  // "look" in "get you that briefing and look at it" never hides the promise.
  /^(?:take|get|have)(?: [\p{L}\p{M}\p{N}'’-]+){0,3}? looks?\b/u,
  /^bring(?: [\p{L}\p{M}\p{N}'’-]+)*? up\b/u,
  // "put up a PR" raises one; only "put that report up", the object first and however long, is a display.
  /^put(?: [\p{L}\p{M}\p{N}'’-]+)+? up\b/u,
  // Walking a PERSON through it is the call's own part: "take you through the report", "take you carefully through"
  // Only a person: "take the briefing through review" is a seat's work.
  /^(?:take|get|bring) (?:you|him|her|them|us)(?: [\p{L}\p{M}\p{N}'’-]+){0,2}? through\b/u,
  // "on screen", "onscreen", "on this screen", "on the big screen": up to two words between.
  /\bon-?screen\b|\bon(?: [\p{L}\p{M}\p{N}'’-]+){0,2}? screens?\b/u,
];

/** Asking the fleet or a seat is the voice naming who does the work, never promising it: "I'll ask the fleet for it". */
const ASKS_THE_FLEET = /^ask (?:the |a )?(?:fleet|seat|supervisor)\b/u;

/** One sentence of the masked text: where it starts, its words as said, and whether it asks. */
interface Sentence {
  readonly start: number;
  readonly words: string;
  readonly question: boolean;
}

/**
 * The text's sentences, cut on `.`, `!`, `?` and `;` in the masked text, so a mark inside a quotation cuts nothing.
 *
 * @param masked the text with its quotations blanked, offsets kept
 * @param text the text as said, which each sentence's words are taken from
 * @returns the sentences holding a letter, in order
 */
function sentencesOf({ masked, text }: { masked: string; text: string }): readonly Sentence[] {
  return [...masked.matchAll(/[^.!?;]+[.!?;]*/gu)]
    .filter((match) => /\p{L}/u.test(match[0]))
    .map((match) => {
      const lead = match[0].length - match[0].trimStart().length;
      const start = match.index + lead;
      const end = match.index + match[0].trimEnd().length;
      return { question: match[0].trimEnd().endsWith("?"), start, words: text.slice(start, end) };
    });
}

/** The words that join a second verb to the same first-person future: "I'll check the config and come back with…". */
const COORDINATORS = new Set(["and", "then"]);

/**
 * The index of the first word from `from` on that is not a filler, `-1` when there is none.
 *
 * @param words the clause's words
 * @param from where to start looking
 * @returns the verb's index
 */
function verbFrom({ words, from }: { words: readonly string[]; from: number }): number {
  const at = words.slice(from).findIndex((word) => !FILLERS.has(word));
  return at === -1 ? -1 : from + at;
}

/**
 * Whether the verb at `verbAt` makes or carries fleet work: one of the producing verbs, not a look or an ask of the
 * fleet, and naming a deliverable after it or a fleet idiom from it on.
 *
 * @param words the clause's words
 * @param verbAt the verb's index
 * @returns true when it promises fleet work
 */
function verbPromises({ words, verbAt }: { words: readonly string[]; verbAt: number }): boolean {
  if (!PRODUCING_VERBS.has(words[verbAt])) {
    return false;
  }
  const fromVerb = words.slice(verbAt).join(" ");
  if (READ_PHRASES.some((phrase) => phrase.test(fromVerb)) || ASKS_THE_FLEET.test(fromVerb)) {
    return false;
  }
  // The verb itself is never the deliverable: "I'll map that out" and "I'll report back" name no seat's work.
  const deliverable = words.slice(verbAt + 1).some((word) => DELIVERABLES.has(word));
  return deliverable || FLEET_IDIOMS.some((idiom) => idiom.test(fromVerb));
}

/**
 * Whether the clause a first-person future opens promises fleet work: its verb, or any verb an "and" or "then" joins
 * to the same future, one that makes or carries something, not a look, and naming a deliverable or a fleet idiom.
 * On the real app: "On it—I'll check the repo config and come back with a tight
 * two-sentence briefing." opened on a read, so testing the first verb alone let the promise after the "and" through.
 *
 * @param clause the masked text from just after the future to the sentence's end, lowercased
 * @returns true when it promises fleet work as the voice's own
 */
function promisesFleetWork({ clause }: { clause: string }): boolean {
  // A combining mark is part of its word: a decomposed "bríef" is one word, never two.
  const words = [...clause.matchAll(/[\p{L}\p{M}\p{N}]+(?:[-'’][\p{L}\p{M}\p{N}]+)*/gu)].map((match) => match[0]);
  const first = verbFrom({ from: 0, words });
  if (first === -1) {
    return false;
  }
  if (verbPromises({ verbAt: first, words })) {
    return true;
  }
  // "and" and "then" are fillers before the first verb ("I'll go and write"), so a joined verb is sought after it;
  // "and then write" finds `write` twice, so each verb is judged once.
  const joined = new Set(
    words
      .map((word, at) => (at > first && COORDINATORS.has(word) ? verbFrom({ from: at + 1, words }) : -1))
      .filter((at) => at !== -1),
  );
  return [...joined].some((verbAt) => joinedVerbPromises({ verbAt, words }));
}

/** How far after a joined verb its deliverable may sit and still be what that verb makes. */
const JOINED_OBJECT_WORDS = 5;

/**
 * Joined phrases that are the call's own check or its own part, never a seat's work: "make sure it matches the report",
 * "make really sure" alike, and any joined "work" — "work through the briefing with you",
 * "work carefully through", "work this draft briefing through" — which is the voice's role.
 */
const JOINED_OWN_WORK: readonly RegExp[] = [/^make(?: [\p{L}\p{M}\p{N}'’-]+){0,2}? sure\b/u, /^work\b/u];

/**
 * Whether a verb an "and" or "then" joined promises fleet work. Narrower than the first verb's test, because a
 * sentence that opened on a read is usually still checking: a {@link JOINED_OWN_WORK} phrase is never a promise, and
 * the deliverable must sit within {@link JOINED_OBJECT_WORDS} words of the verb, so a later clause's noun is never its
 * object.
 *
 * @param words the clause's words
 * @param verbAt the joined verb's index
 * @returns true when it promises fleet work
 */
function joinedVerbPromises({ words, verbAt }: { words: readonly string[]; verbAt: number }): boolean {
  const fromVerb = words.slice(verbAt).join(" ");
  if (JOINED_OWN_WORK.some((phrase) => phrase.test(fromVerb))) {
    return false;
  }
  return verbPromises({ verbAt, words: words.slice(0, verbAt + 1 + JOINED_OBJECT_WORDS) });
}

/**
 * Every sentence of the voice's that promises fleet work as its own, one claim per sentence.
 *
 * @param text one of the voice's FINAL segments, as transcribed
 * @returns the claims, in the order said, each at its first offending first-person future
 */
export function fleetPromiseClaimsOf({ text }: { text: string }): readonly FleetPromiseClaim[] {
  const masked = maskQuotes({ text });
  const claims: FleetPromiseClaim[] = [];
  for (const sentence of sentencesOf({ masked, text })) {
    if (sentence.question) {
      continue;
    }
    const own = masked.slice(sentence.start, sentence.start + sentence.words.length);
    const promise = [...own.matchAll(FIRST_PERSON_FUTURE)].find((match) =>
      promisesFleetWork({ clause: own.slice(match.index + match[0].length).toLowerCase() }),
    );
    if (promise !== undefined) {
      claims.push({ kind: "fleet-promise", start: sentence.start + promise.index, words: sentence.words });
    }
  }
  return claims;
}
