/**
 * `talk relay`'s repeatable `--also-answers <key>`: the OTHER Queue cards the voice judged the owner's words answer, which the
 * verb lands beside `--about` so Queue cards refresh. Split from `./relayArgs.ts`,
 * which sits at the file-size ratchet. Pure.
 *
 * The page already held each key to what it served the owner this call (`site/lib/alsoAnsweredCards.ts`); this re-checks
 * what argv alone can show, so a hand run cannot name a card the page would have refused by shape.
 */
import { ALSO_ANSWERS_MAX, CARD_KEY, NEVER_ALSO_ANSWERED } from "../../../talk/cardKey.js";
import { prCardKeyParts } from "../../../talk/prCardKey.js";
import { repeatedFlagValues } from "../../parseFlags.js";

/**
 * Every `--also-answers` key, in the order given, or the problems with them: at most {@link ALSO_ANSWERS_MAX},
 * distinct, card keys of a kind the owner's words can answer, none the `--about` card, and none on a typed steer — the list is
 * the voice's judgement, and a typed steer has no voice.
 *
 * @param rest the argv after the verb, read for the repeated flag
 * @param about the relay's `--about` key, or empty
 * @param typed whether the relay is a typed steer
 * @param problems the parse's running list, which each refusal is appended to
 * @returns the keys, empty when absent or refused
 */
export function alsoAnswersArgsOf({
  rest,
  about,
  typed,
  problems,
}: {
  rest: readonly string[];
  about: string;
  typed: boolean;
  problems: string[];
}): readonly string[] {
  const keys = repeatedFlagValues({ name: "also-answers", rest });
  if (keys.length === 0) {
    return [];
  }
  const found: string[] = [];
  if (typed) {
    found.push(
      "talk relay --typed takes no --also-answers: which other cards the owner's words answer is the voice's judgement",
    );
  }
  if (keys.length > ALSO_ANSWERS_MAX) {
    found.push(`--also-answers names at most ${String(ALSO_ANSWERS_MAX)} cards, got ${String(keys.length)}`);
  }
  keys.forEach((key, index) => {
    if (!CARD_KEY.test(key)) {
      found.push(`--also-answers takes a card key such as ask:<slug>, got ${key}`);
    } else if (key.startsWith("pr:") && prCardKeyParts({ key }) === undefined) {
      found.push(`--also-answers ${key} names no repository; a pull request's key is pr:<owner>.<repo>.<n>`);
    } else if (NEVER_ALSO_ANSWERED.some((kind) => key.startsWith(kind))) {
      found.push(`--also-answers ${key} is a kind the owner's words never answer as another card`);
    } else if (key === about) {
      found.push(`--also-answers ${key} is the --about card already`);
    } else if (keys.indexOf(key) !== index) {
      found.push(`--also-answers ${key} is named twice`);
    }
  });
  problems.push(...found);
  if (found.length > 0) {
    return [];
  }
  return keys;
}
