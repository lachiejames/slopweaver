/**
 * The one rule about what an act's PLAIN-WORDS line may contain: nothing the owner has to have read this
 * repository to parse. Pure — one string in, one finding or nothing out. No I/O, no clock, no allowlist.
 *
 * ## The card that cost the rule
 *
 * A queue card's `what` was the ledger's `why`, which is written for the fleet, and the owner could not parse
 * it. A `why` reads like this:
 *
 * ```text
 *   <board-slug> is an unruled fleet finding whose work reaches nobody but the owner, so rule 10 hands it to
 *   this session's judgement. Observed by <session-uuid> …
 * ```
 *
 * Three kinds of token in two clauses, none of which means anything to a reader who has not read
 * `AGENTS.md` and the board: a board slug, a doctrine rule number, and a session id. So `why` keeps its job
 * — it is the fleet's own note and the thing a later session reads — and a second field carries what the OWNER
 * reads. This module is the rule that field is held to.
 *
 * ## Why a criterion and not a review note
 *
 * Measured over the live register (`slopweaver autonomy list --json | jq -r '.action.why'`, hundreds of acts): **about
 * four in five trip at least one class below.** Per class, rule number and turn reference about half each,
 * four-segment slug about a fifth, session id a few percent. A field four in five of whose values would be unparsable is not a
 * field a reviewer catches; it is one the door has to.
 *
 * ## Each sense was measured against the OWNER'S OWN WORDS before it shipped
 *
 * `../briefing/fleetJargon.ts`'s discipline, applied to a different class of token: a criterion that refuses
 * the way the owner actually writes is worse than none. Measured over 714 distinct `owner-turn-*.txt` files, deduped
 * by content digest, the quoted turn taken from each — 48,488 words. Reproduce it with:
 *
 * ```bash
 * cd "$SLOPWEAVER_HOME/supervisor-scratch" && find . -name 'owner-turn-*.txt' -print0 | xargs -0 shasum |
 *   sort -u -k1,1 | awk '{print $2}' |
 *   while read -r f; do awk 'started{print} /^"/{started=1; print}' "$f"; done > /tmp/owner-words.txt
 * ```
 *
 * - A four-or-more-segment hyphen run matched **zero ordinary English**: every hit was a slug, a path
 *   fragment or a session id.
 * - The turn reference matched 234 times and produced **no number range** — "10-15 minutes" never appeared
 *   in 48k words, which is what the lookarounds were written in fear of.
 * - A bare eight-digit run matched unix millisecond timestamps (`1789702388`), which is why
 *   {@link SESSION_ID_SENSE} requires a letter AND a digit rather than eight hex characters.
 *
 * ## Two residues, stated rather than discovered
 *
 * **It refuses one English compound.** `state-of-the-art` is four hyphen-joined lowercase segments, so it is
 * REFUSED. That is accepted rather than patched around: the fix is to write the phrase without hyphens,
 * which loses nothing, and an allowlist of blessed compounds is the move this repository declines everywhere
 * else. A false positive is retired by SHARPENING a sense, never by listing the line that tripped it.
 *
 * **It admits a THREE-segment slug, and that is the floor rather than an oversight.** A board slug such as
 * `search-reindex-review` is three segments, and {@link SLUG_SENSE} does not match it, because `{3,}` counts the repeated
 * `-segment` group and so the shortest token this sense calls a slug is four segments long. The threshold
 * cannot be lowered: `day-to-day`, `end-to-end`, `up-to-date` and `one-to-one` are all three segments of
 * ordinary English, and a sense that refuses the way the owner actually writes is worse than none — the
 * measurement above is what set the number. So read the criterion as what it is, FOUR SEGMENTS AND UP, never
 * as "no slug ever reaches the owner". A three-segment slug in a plain-words line is caught by the session composing it, which
 * is the half of this that was never going to be a regular expression.
 */

import { WHAT_MAX_SENTENCES, WHAT_MAX_WORDS } from "../briefing/caps.js";

/**
 * One class of token the owner cannot parse, the sense that finds it, and what to write instead.
 *
 * @internal — a row of {@link UNPARSABLE_CLASSES}; no caller outside this module names the type.
 */
interface UnparsableClass {
  /** The class a refusal names, lower case and hyphenated. */
  readonly name: string;
  /** Where this repository's private notation appears. Never global here — {@link unparsableIn} copies it. */
  readonly sense: RegExp;
  /** What to write in its place, phrased as an instruction rather than a prohibition. */
  readonly instead: string;
}

/**
 * A doctrine rule or a recorded turn: `rule 10`, `ruling 240`, or a turn id of three digits, a hyphen and an item number.
 *
 * The lookarounds are what keep a date out. In an ISO date the month is preceded by a hyphen, so the
 * lookbehind blocks the match there, and the day cannot open a `NNN-N` because nothing follows it. They keep a
 * ticket key out for the same reason: `ABC-1642` has letters on its left.
 */
const RULE_NUMBER_SENSE = /\b(?:rule|ruling)s?\s+\d+|(?<![\dA-Za-z-])\d{2,3}-\d{1,2}[a-z]?(?![\dA-Za-z-])/iu;

/**
 * A session, run or transcript id: a UUID, or an eight-or-longer hexadecimal run carrying both a letter and
 * a digit.
 *
 * The two lookaheads are the whole criterion. Requiring a DIGIT is what keeps a unix millisecond timestamp
 * from reading as an id, and requiring a LETTER is what keeps an English word out — a word cannot carry a
 * digit, so the pair together admit nothing a person would type as prose.
 *
 * The UUID arm is FIRST, and that order is what the refusal quotes. A UUID opens with eight hex characters
 * followed by a hyphen, which is a word boundary, so the bare-run arm matches that first segment on its own:
 * walked the other way round, a line naming a whole UUID was refused for carrying its first eight characters,
 * and a composer reading that would have gone looking for a token its own line never wrote.
 */
const SESSION_ID_SENSE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?=[0-9a-f]{8,}\b)(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/iu;

/**
 * A board row slug, an action id or a prefixed reference — four or more hyphen-joined lowercase segments, or
 * one of the five `<kind>:` prefixes this repository addresses its own records by.
 *
 * FOUR segments rather than two, because two is ordinary English (`merge-when-ready`, `read-only`) and the
 * measurement found no four-segment compound in 48k words of the owner's own speech. See the file overview for the
 * one compound this still refuses.
 *
 * The prefixed arm stops before trailing sentence punctuation, the same call `site/lib/queueCardActLinks.ts`'s bare
 * URL matcher makes: a reference ending a sentence is the common case, and a refusal quoting
 * `state:ledgers/autonomy.jsonl.` sends a composer looking for a full stop that belongs to the prose.
 */
const SLUG_SENSE = /[a-z0-9]+(?:-[a-z0-9]+){3,}|(?:act|run|state|transcript|workspace):\S*[^\s.,;:!?)]/iu;

/**
 * Every class of token a plain-words line may not carry, in the order a refusal reports them.
 *
 * `session-id` sits ahead of `slug` because a UUID is also four hyphen-joined segments: walked the other way
 * round, a UUID would be reported as a slug and the advice would tell a
 * session to rename something that has no name.
 */
const UNPARSABLE_CLASSES: readonly UnparsableClass[] = [
  {
    instead: "say what the rule made obvious, not which rule it was",
    name: "rule-number",
    sense: RULE_NUMBER_SENSE,
  },
  {
    instead: "the owner does not know a session by its id — name what it was doing, or leave it out",
    name: "session-id",
    sense: SESSION_ID_SENSE,
  },
  {
    instead: "name the thing in words — the pull request, the page, the question — rather than its slug",
    name: "slug",
    sense: SLUG_SENSE,
  },
];

/** One token in a plain-words line that the owner would have to have read this repository to parse. */
export interface UnparsableToken {
  /** Which class it is, as {@link UNPARSABLE_CLASSES} names it. */
  readonly name: string;
  /** The text the line actually wrote, so a composer can find it without re-reading the whole line. */
  readonly used: string;
  /** What to write in its place. */
  readonly instead: string;
}

/**
 * The first token in a plain-words line that the owner could not parse.
 *
 * @param said the line as it was authored
 * @returns the class, the phrase and what to write instead, or `undefined` when the whole line is readable
 */
export function unparsableIn({ said }: { said: string }): UnparsableToken | undefined {
  for (const entry of UNPARSABLE_CLASSES) {
    const found = entry.sense.exec(said);
    if (found === null) {
      continue;
    }
    return { instead: entry.instead, name: entry.name, used: found[0] };
  }
  return undefined;
}

/**
 * What a plain-words line is FOR, worded once so the verb's usage and its refusal cannot drift apart.
 *
 * Three things in this order: what was done, to what, and why it mattered. The last is the one a session is
 * tempted to drop, and it is the only one the owner cannot recover by opening the subject.
 */
export const SAID_ADVICE =
  "Write it as you would say it to the owner: what you did, to what, and why it mattered. " +
  "No rule numbers, no slugs, no session ids — the `why` field is where the fleet's own reasoning goes.";

/**
 * The refusal for one unparsable token.
 *
 * @param found the token {@link unparsableIn} reported
 * @returns one line naming the phrase, its class and what to write instead
 */
export function saidRefusal({ found }: { found: UnparsableToken }): string {
  return `carries "${found.used}", which is a ${found.name} — ${found.instead}. ${SAID_ADVICE}`;
}

/**
 * Which of the card's two above-fold budgets a plain-words line crosses, or `undefined` when it fits.
 *
 * **This is the door standing in for a renderer that cannot refuse.** `site/lib/queueCard.ts`'s `foldedText`
 * takes whole sentences until the next would cross {@link WHAT_MAX_SENTENCES} or {@link WHAT_MAX_WORDS},
 * and `site/components/console/QueueCardBody.tsx` draws ONLY what that returns — the remainder is computed
 * and rendered nowhere. So a said past either budget is one the owner's page silently cuts, with no fold to open and
 * no sign that anything was dropped.
 *
 * Measured: the worst case is a DERIVED line, whose honest half is its LAST sentence. A subject
 * opening out to a 37-word lead builds a 371-character line — inside `AUTONOMY_SAID_MAX`, so the door took
 * it — whose second sentence, "Written from the record afterwards …", falls off the fold. The card would
 * then show a backfilled line as though a session had written it at the time. Reproduce the bound with
 * `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/autonomy/said.test.ts`.
 *
 * The character cap stays beside this rather than being replaced by it: they bound different things, one the
 * row on disk and one the sentence on the page, and a line can cross either alone.
 *
 * @param said the line as it was authored, or as the backfill derived it
 * @returns the budget crossed, what the line measured and the cap — or `undefined` when the card draws it whole
 */
export function pastTheFold({
  said,
}: {
  said: string;
}): { budget: "words" | "sentences"; measured: number; cap: number } | undefined {
  const sentences = said
    .trim()
    .split(/(?<=[.!?])\s+/u)
    .filter((piece) => piece.trim().length > 0);
  if (sentences.length > WHAT_MAX_SENTENCES) {
    return { budget: "sentences", cap: WHAT_MAX_SENTENCES, measured: sentences.length };
  }
  const trimmed = said.trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;
  if (words > WHAT_MAX_WORDS) {
    return { budget: "words", cap: WHAT_MAX_WORDS, measured: words };
  }
  return undefined;
}
